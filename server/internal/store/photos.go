package store

import (
	"database/sql"
	"errors"
	"time"
)

type Photo struct {
	ID          int64
	AlbumID     int64
	StorageKey  string
	SHA256      string
	ByteSize    int64
	Width       *int
	Height      *int
	ShotAt      *int64
	GPSLat      *float64
	GPSLng      *float64
	DeviceMake  string
	DeviceModel string
	Title       *string
	Description *string
	CreatedAt   int64
}

// CreatePhoto 写库并做 sha256 去重。返回 (照片, 是否本次新建, 错误)；
// 已存在时返回既有行而不重复落盘。
// 单连接串行化保证检查-插入无竞态。
func CreatePhoto(db *sql.DB, p *Photo) (*Photo, bool, error) {
	if existing, err := GetPhotoBySHA(db, p.SHA256); err == nil {
		return existing, false, nil
	} else if !errors.Is(err, ErrNotFound) {
		return nil, false, err
	}

	_, err := db.Exec(`
		INSERT INTO photos(album_id, storage_key, sha256, byte_size, width, height,
			shot_at, gps_lat, gps_lng, device_make, device_model, created_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
		p.AlbumID, p.StorageKey, p.SHA256, p.ByteSize, p.Width, p.Height,
		p.ShotAt, p.GPSLat, p.GPSLng, p.DeviceMake, p.DeviceModel, time.Now().Unix())
	if err != nil {
		return nil, false, err
	}
	created, err := GetPhotoBySHA(db, p.SHA256)
	return created, err == nil, err
}

func GetPhoto(db *sql.DB, id int64) (*Photo, error) {
	row := db.QueryRow(`
		SELECT id, album_id, storage_key, sha256, byte_size, width, height,
			shot_at, gps_lat, gps_lng, device_make, device_model, title, description, created_at
		FROM photos WHERE id=?`, id)
	return scanPhoto(row)
}

func GetPhotoBySHA(db *sql.DB, sha string) (*Photo, error) {
	row := db.QueryRow(`
		SELECT id, album_id, storage_key, sha256, byte_size, width, height,
			shot_at, gps_lat, gps_lng, device_make, device_model, title, description, created_at
		FROM photos WHERE sha256=?`, sha)
	return scanPhoto(row)
}

func ListPhotosByAlbum(db *sql.DB, albumID int64) ([]Photo, error) {
	rows, err := db.Query(`
		SELECT id, album_id, storage_key, sha256, byte_size, width, height,
			shot_at, gps_lat, gps_lng, device_make, device_model, title, description, created_at
		FROM photos WHERE album_id=? ORDER BY shot_at, id`, albumID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
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

// SetAlbumCover 在相册尚无封面时设为指定照片。
func SetAlbumCover(db *sql.DB, albumID, photoID int64) error {
	_, err := db.Exec(`UPDATE albums SET cover_photo_id=?, updated_at=? WHERE id=? AND cover_photo_id IS NULL`,
		photoID, time.Now().Unix(), albumID)
	return err
}

type scanner interface{ Scan(dest ...any) error }

func scanPhoto(row scanner) (*Photo, error) {
	var p Photo
	if err := scanPhotoInto(row.Scan, &p); err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &p, nil
}

func scanPhotoInto(scan func(dest ...any) error, p *Photo) error {
	var width, height, shotAt sql.NullInt64
	var gpsLat, gpsLng sql.NullFloat64
	var title, desc sql.NullString
	if err := scan(&p.ID, &p.AlbumID, &p.StorageKey, &p.SHA256, &p.ByteSize,
		&width, &height, &shotAt, &gpsLat, &gpsLng,
		&p.DeviceMake, &p.DeviceModel, &title, &desc, &p.CreatedAt); err != nil {
		return err
	}
	p.Width = nullIntPtr64(width)
	p.Height = nullIntPtr64(height)
	p.ShotAt = nullInt64Ptr(shotAt)
	p.GPSLat = nullFloatPtr(gpsLat)
	p.GPSLng = nullFloatPtr(gpsLng)
	p.Title = nullStringPtr(title)
	p.Description = nullStringPtr(desc)
	return nil
}

func nullIntPtr64(ni sql.NullInt64) *int {
	if !ni.Valid {
		return nil
	}
	v := int(ni.Int64)
	return &v
}

func nullInt64Ptr(ni sql.NullInt64) *int64 {
	if !ni.Valid {
		return nil
	}
	v := ni.Int64
	return &v
}

func nullFloatPtr(nf sql.NullFloat64) *float64 {
	if !nf.Valid {
		return nil
	}
	v := nf.Float64
	return &v
}
