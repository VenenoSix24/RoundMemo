package store

import (
	"database/sql"
	"strings"
)

// 照片池 → 相册的多对多：照片进池，相册通过 album_photos 引用。
// 一张照片可属多个相册；「从相册移除」只解引用，「照片池删除」才真删。

const photoCols = `p.id, p.storage_key, p.sha256, p.byte_size, p.width, p.height,
	p.shot_at, p.gps_lat, p.gps_lng, p.device_make, p.device_model, p.title, p.description, p.location_name, p.filename, p.created_at`

// AddPhotosToAlbum 把池中照片挂到相册（已挂的不重复）。
func AddPhotosToAlbum(db *sql.DB, albumID int64, photoIDs []int64) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, pid := range photoIDs {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO album_photos(album_id, photo_id, position) VALUES(?,?,0)`, albumID, pid); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// RemovePhotoFromAlbum 从相册移除照片（仅解引用，不从照片池删除）。
func RemovePhotoFromAlbum(db *sql.DB, albumID, photoID int64) error {
	res, err := db.Exec(`DELETE FROM album_photos WHERE album_id=? AND photo_id=?`, albumID, photoID)
	if err != nil {
		return err
	}
	return requireAffected(res)
}

// ListAlbumPhotos 相册内照片，按拍摄时间降序，最新在前（无时间按导入时间兜底）。
func ListAlbumPhotos(db *sql.DB, albumID int64) ([]Photo, error) {
	rows, err := db.Query(`
		SELECT `+photoCols+`
		FROM album_photos ap JOIN photos p ON p.id = ap.photo_id
		WHERE ap.album_id=?
		ORDER BY COALESCE(p.shot_at, p.created_at) DESC, p.id DESC`, albumID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPhotos(rows)
}

// ListPhotosByAlbums 跨多个相册取照片（时间线用），去重后按拍摄时间升序。
// 动态 IN 参数，相册数量极少，安全性无虞。
func ListPhotosByAlbums(db *sql.DB, albumIDs []int64) ([]Photo, error) {
	if len(albumIDs) == 0 {
		return []Photo{}, nil
	}
	placeholders := strings.Repeat("?,", len(albumIDs))
	placeholders = placeholders[:len(placeholders)-1]
	args := make([]any, len(albumIDs))
	for i, id := range albumIDs {
		args[i] = id
	}
	rows, err := db.Query(`
		SELECT `+photoCols+`
		FROM album_photos ap JOIN photos p ON p.id = ap.photo_id
		WHERE ap.album_id IN (`+placeholders+`)
		GROUP BY p.id
		ORDER BY COALESCE(p.shot_at, p.created_at), p.id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPhotos(rows)
}

// AlbumIDsForPhoto 某照片所属的相册 id 列表。
func AlbumIDsForPhoto(db *sql.DB, photoID int64) ([]int64, error) {
	rows, err := db.Query(`SELECT album_id FROM album_photos WHERE photo_id=? ORDER BY album_id`, photoID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func scanPhotos(rows *sql.Rows) ([]Photo, error) {
	photos := []Photo{}
	for rows.Next() {
		var p Photo
		if err := scanPhotoInto(rows.Scan, &p); err != nil {
			return nil, err
		}
		photos = append(photos, p)
	}
	return photos, rows.Err()
}
