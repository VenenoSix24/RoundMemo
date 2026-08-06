package store

import (
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
)

func testDB(t *testing.T) *sql.DB {
	t.Helper()
	dir := t.TempDir()
	db, err := Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := Migrate(db); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestMigrateIdempotent(t *testing.T) {
	db := testDB(t)
	if err := Migrate(db); err != nil {
		t.Fatalf("二次迁移应幂等: %v", err)
	}
}

func TestAlbumCRUD(t *testing.T) {
	db := testDB(t)

	id, err := CreateAlbum(db, "毕业旅行", nil)
	if err != nil {
		t.Fatal(err)
	}
	a, err := GetAlbum(db, id)
	if err != nil {
		t.Fatal(err)
	}
	if a.Title != "毕业旅行" || a.SortKey != "shot_at" {
		t.Fatalf("相册字段不符: %+v", a)
	}

	desc := "云南七天"
	if err := UpdateAlbum(db, id, nil, &desc); err != nil {
		t.Fatal(err)
	}
	a, _ = GetAlbum(db, id)
	if a.Description == nil || *a.Description != "云南七天" {
		t.Fatalf("描述未更新: %+v", a.Description)
	}

	title := "毕业旅行·改"
	if err := UpdateAlbum(db, id, &title, nil); err != nil {
		t.Fatal(err)
	}

	albums, err := ListAlbums(db)
	if err != nil {
		t.Fatal(err)
	}
	if len(albums) != 1 || albums[0].Title != "毕业旅行·改" {
		t.Fatalf("列表不符: %+v", albums)
	}

	if err := DeleteAlbum(db, id); err != nil {
		t.Fatal(err)
	}
	if _, err := GetAlbum(db, id); !errors.Is(err, ErrNotFound) {
		t.Fatalf("删除后应 NotFound, got %v", err)
	}
}

func TestGroupBindUnbind(t *testing.T) {
	db := testDB(t)

	gid, err := CreateGroup(db, "全体同学")
	if err != nil {
		t.Fatal(err)
	}
	a1, _ := CreateAlbum(db, "相册一", nil)
	a2, _ := CreateAlbum(db, "相册二", nil)

	if err := BindAlbums(db, gid, []int64{a1, a2}); err != nil {
		t.Fatal(err)
	}
	ids, err := AlbumIDsForGroup(db, gid)
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 2 {
		t.Fatalf("绑定数量不符: %v", ids)
	}

	// 幂等：重复绑定不产生重复行
	if err := BindAlbums(db, gid, []int64{a1}); err != nil {
		t.Fatal(err)
	}
	ids, _ = AlbumIDsForGroup(db, gid)
	if len(ids) != 2 {
		t.Fatalf("重复绑定后数量应为 2: %v", ids)
	}

	if err := UnbindAlbum(db, gid, a1); err != nil {
		t.Fatal(err)
	}
	ids, _ = AlbumIDsForGroup(db, gid)
	if len(ids) != 1 || ids[0] != a2 {
		t.Fatalf("解绑后不符: %v", ids)
	}

	// 删除分组应级联清空绑定
	if err := DeleteGroup(db, gid); err != nil {
		t.Fatal(err)
	}
	ids, _ = AlbumIDsForGroup(db, gid)
	if len(ids) != 0 {
		t.Fatalf("分组删除后绑定应级联清空: %v", ids)
	}
}

func TestOwnerUpsertPreservesCreatedAt(t *testing.T) {
	db := testDB(t)

	id1, err := UpsertOwner(db, "admin", "hash-v1")
	if err != nil {
		t.Fatal(err)
	}
	o1, _ := GetOwnerByUsername(db, "admin")

	id2, err := UpsertOwner(db, "admin", "hash-v2")
	if err != nil {
		t.Fatal(err)
	}
	if id1 != id2 {
		t.Fatalf("同一用户名应复用同一行: %d vs %d", id1, id2)
	}
	o2, _ := GetOwnerByUsername(db, "admin")
	if o1.CreatedAt != o2.CreatedAt {
		t.Fatalf("created_at 不应被覆盖: %d vs %d", o1.CreatedAt, o2.CreatedAt)
	}
	if o2.PasswordHash != "hash-v2" {
		t.Fatalf("密码哈希应更新: %q", o2.PasswordHash)
	}
}
