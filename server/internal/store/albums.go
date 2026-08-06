package store

import (
	"database/sql"
	"time"
)

type Album struct {
	ID           int64
	Title        string
	Description  *string
	CoverPhotoID *int64
	SortKey      string
	CreatedAt    int64
	UpdatedAt    int64
}

func CreateAlbum(db *sql.DB, title string, description *string) (int64, error) {
	now := time.Now().Unix()
	res, err := db.Exec(`
		INSERT INTO albums(title, description, sort_key, created_at, updated_at)
		VALUES(?, ?, 'shot_at', ?, ?)`,
		title, description, now, now)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func ListAlbums(db *sql.DB) ([]Album, error) {
	rows, err := db.Query(`
		SELECT id, title, description, cover_photo_id, sort_key, created_at, updated_at
		FROM albums ORDER BY created_at DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	albums := []Album{}
	for rows.Next() {
		a, err := scanAlbum(rows)
		if err != nil {
			return nil, err
		}
		albums = append(albums, *a)
	}
	return albums, rows.Err()
}

// AlbumsForGroup 返回分组当前绑定的相册（访客按分组切换时用）。
func AlbumsForGroup(db *sql.DB, groupID int64) ([]Album, error) {
	rows, err := db.Query(`
		SELECT a.id, a.title, a.description, a.cover_photo_id, a.sort_key, a.created_at, a.updated_at
		FROM albums a JOIN group_albums ga ON ga.album_id = a.id
		WHERE ga.group_id=? ORDER BY a.created_at DESC, a.id DESC`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	albums := []Album{}
	for rows.Next() {
		a, err := scanAlbum(rows)
		if err != nil {
			return nil, err
		}
		albums = append(albums, *a)
	}
	return albums, rows.Err()
}

func GetAlbum(db *sql.DB, id int64) (*Album, error) {
	return scanAlbum(db.QueryRow(`
		SELECT id, title, description, cover_photo_id, sort_key, created_at, updated_at
		FROM albums WHERE id=?`, id))
}

func scanAlbum(row scanner) (*Album, error) {
	var a Album
	var desc sql.NullString
	var coverID sql.NullInt64
	if err := row.Scan(&a.ID, &a.Title, &desc, &coverID, &a.SortKey, &a.CreatedAt, &a.UpdatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	a.Description = nullStringPtr(desc)
	a.CoverPhotoID = nullIntPtr(coverID)
	return &a, nil
}

// UpdateAlbum 部分更新：title/description 传 nil 表示该字段不改；
// description 传空串即清空文案。单条 UPDATE，无需事务。
func UpdateAlbum(db *sql.DB, id int64, title *string, description *string) error {
	cur, err := GetAlbum(db, id)
	if err != nil {
		return err
	}
	newTitle := cur.Title
	if title != nil {
		newTitle = *title
	}
	newDesc := cur.Description
	if description != nil {
		newDesc = description
	}
	res, err := db.Exec(`UPDATE albums SET title=?, description=?, updated_at=? WHERE id=?`,
		newTitle, newDesc, time.Now().Unix(), id)
	if err != nil {
		return err
	}
	return requireAffected(res)
}

func DeleteAlbum(db *sql.DB, id int64) error {
	res, err := db.Exec(`DELETE FROM albums WHERE id=?`, id)
	if err != nil {
		return err
	}
	return requireAffected(res)
}
