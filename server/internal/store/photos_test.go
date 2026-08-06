package store

import (
	"testing"
)

func TestCreatePhotoDedup(t *testing.T) {
	db := testDB(t)
	albumID, err := CreateAlbum(db, "旅行", nil)
	if err != nil {
		t.Fatal(err)
	}

	w := 800
	mk := func() *Photo {
		return &Photo{StorageKey: "photos/ab/abc", SHA256: "abc", ByteSize: 123, Width: &w, Height: &w}
	}

	p1, isNew, err := CreatePhoto(db, mk())
	if err != nil {
		t.Fatal(err)
	}
	if !isNew {
		t.Fatal("首次创建应标记 isNew")
	}

	// 相同 sha256：应返回既有行且不重复
	p2, isNew, err := CreatePhoto(db, mk())
	if err != nil {
		t.Fatal(err)
	}
	if isNew || p1.ID != p2.ID {
		t.Fatalf("去重失败: isNew=%v, id1=%d id2=%d", isNew, p1.ID, p2.ID)
	}

	// 挂到相册后能查到
	if err := AddPhotosToAlbum(db, albumID, []int64{p1.ID}); err != nil {
		t.Fatal(err)
	}
	photos, err := ListAlbumPhotos(db, albumID)
	if err != nil {
		t.Fatal(err)
	}
	if len(photos) != 1 {
		t.Fatalf("去重后应 1 行, got %d", len(photos))
	}
}

func TestAlbumCoverSHAFromPool(t *testing.T) {
	db := testDB(t)
	albumID, _ := CreateAlbum(db, "旅行", nil)

	p1, _, _ := CreatePhoto(db, &Photo{StorageKey: "photos/ab/a", SHA256: "a", ByteSize: 1})
	p2, _, _ := CreatePhoto(db, &Photo{StorageKey: "photos/ab/b", SHA256: "b", ByteSize: 2})
	if err := AddPhotosToAlbum(db, albumID, []int64{p1.ID, p2.ID}); err != nil {
		t.Fatal(err)
	}

	// 未设封面：走 album_photos 兜底，返回相册里最早一张（回归：曾引用已删的 photos.album_id 导致恒报错）
	sha, err := AlbumCoverSHA(db, albumID)
	if err != nil {
		t.Fatalf("AlbumCoverSHA: %v", err)
	}
	if sha != p1.SHA256 {
		t.Fatalf("兜底封面应取第一张 %q, got %q", p1.SHA256, sha)
	}

	// 手动设封面后返回设置的封面
	if err := SetAlbumCoverForce(db, albumID, p2.ID); err != nil {
		t.Fatal(err)
	}
	sha, err = AlbumCoverSHA(db, albumID)
	if err != nil {
		t.Fatalf("AlbumCoverSHA after cover: %v", err)
	}
	if sha != p2.SHA256 {
		t.Fatalf("应返回已设封面 %q, got %q", p2.SHA256, sha)
	}

	// 无照片相册返回空串
	emptyID, _ := CreateAlbum(db, "空", nil)
	sha, err = AlbumCoverSHA(db, emptyID)
	if err != nil {
		t.Fatalf("AlbumCoverSHA empty: %v", err)
	}
	if sha != "" {
		t.Fatalf("空相册封面应为空, got %q", sha)
	}
}

func TestAlbumPhotoMultiMembership(t *testing.T) {
	db := testDB(t)
	a1, _ := CreateAlbum(db, "甲", nil)
	a2, _ := CreateAlbum(db, "乙", nil)

	p, _, err := CreatePhoto(db, &Photo{StorageKey: "photos/ab/x", SHA256: "x", ByteSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	if err := AddPhotosToAlbum(db, a1, []int64{p.ID}); err != nil {
		t.Fatal(err)
	}
	if err := AddPhotosToAlbum(db, a2, []int64{p.ID}); err != nil {
		t.Fatal(err)
	}

	ids, err := AlbumIDsForPhoto(db, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 2 {
		t.Fatalf("一张照片应属 2 个相册, got %v", ids)
	}

	// 从相册移除只是解引用，照片仍在池里
	if err := RemovePhotoFromAlbum(db, a1, p.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := GetPhoto(db, p.ID); err != nil {
		t.Fatalf("移除相册后照片应仍在池: %v", err)
	}
	ids, _ = AlbumIDsForPhoto(db, p.ID)
	if len(ids) != 1 || ids[0] != a2 {
		t.Fatalf("移除后应只剩一个相册, got %v", ids)
	}
}

func TestSetAlbumCoverOnlyWhenEmpty(t *testing.T) {
	db := testDB(t)
	albumID, err := CreateAlbum(db, "旅行", nil)
	if err != nil {
		t.Fatal(err)
	}

	p1, _, _ := CreatePhoto(db, &Photo{StorageKey: "photos/ab/a", SHA256: "a", ByteSize: 1})
	if err := AddPhotosToAlbum(db, albumID, []int64{p1.ID}); err != nil {
		t.Fatal(err)
	}
	if err := SetAlbumCover(db, albumID, p1.ID); err != nil {
		t.Fatal(err)
	}
	p2, _, _ := CreatePhoto(db, &Photo{StorageKey: "photos/ab/b", SHA256: "b", ByteSize: 2})
	if err := AddPhotosToAlbum(db, albumID, []int64{p2.ID}); err != nil {
		t.Fatal(err)
	}
	if err := SetAlbumCover(db, albumID, p2.ID); err != nil {
		t.Fatal(err)
	}

	album, err := GetAlbum(db, albumID)
	if err != nil {
		t.Fatal(err)
	}
	if album.CoverPhotoID == nil || *album.CoverPhotoID != p1.ID {
		t.Fatalf("封面应保留首张, got %+v", album.CoverPhotoID)
	}
}
