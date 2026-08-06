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
		return &Photo{AlbumID: albumID, StorageKey: "photos/ab/abc", SHA256: "abc", ByteSize: 123, Width: &w, Height: &w}
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

	photos, err := ListPhotosByAlbum(db, albumID)
	if err != nil {
		t.Fatal(err)
	}
	if len(photos) != 1 {
		t.Fatalf("去重后应 1 行, got %d", len(photos))
	}
}

func TestSetAlbumCoverOnlyWhenEmpty(t *testing.T) {
	db := testDB(t)
	albumID, err := CreateAlbum(db, "旅行", nil)
	if err != nil {
		t.Fatal(err)
	}

	p1, _, _ := CreatePhoto(db, &Photo{AlbumID: albumID, StorageKey: "photos/ab/a", SHA256: "a", ByteSize: 1})
	if err := SetAlbumCover(db, albumID, p1.ID); err != nil {
		t.Fatal(err)
	}
	p2, _, _ := CreatePhoto(db, &Photo{AlbumID: albumID, StorageKey: "photos/ab/b", SHA256: "b", ByteSize: 2})
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
