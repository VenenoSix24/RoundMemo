package store

import (
	"database/sql"
	"time"
)

type Group struct {
	ID        int64
	Name      string
	CreatedAt int64
}

func CreateGroup(db *sql.DB, name string) (int64, error) {
	res, err := db.Exec(`INSERT INTO groups(name, created_at) VALUES(?, ?)`, name, time.Now().Unix())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func ListGroups(db *sql.DB) ([]Group, error) {
	rows, err := db.Query(`SELECT id, name, created_at FROM groups ORDER BY created_at DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	groups := []Group{}
	for rows.Next() {
		var g Group
		if err := rows.Scan(&g.ID, &g.Name, &g.CreatedAt); err != nil {
			return nil, err
		}
		groups = append(groups, g)
	}
	return groups, rows.Err()
}

func GetGroup(db *sql.DB, id int64) (*Group, error) {
	row := db.QueryRow(`SELECT id, name, created_at FROM groups WHERE id=?`, id)
	var g Group
	if err := row.Scan(&g.ID, &g.Name, &g.CreatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &g, nil
}

func UpdateGroupName(db *sql.DB, id int64, name string) error {
	res, err := db.Exec(`UPDATE groups SET name=? WHERE id=?`, name, id)
	if err != nil {
		return err
	}
	return requireAffected(res)
}

func DeleteGroup(db *sql.DB, id int64) error {
	res, err := db.Exec(`DELETE FROM groups WHERE id=?`, id)
	if err != nil {
		return err
	}
	return requireAffected(res)
}

// BindAlbums 把一组相册挂到分组。重复绑定用 OR IGNORE 跳过，幂等。
func BindAlbums(db *sql.DB, groupID int64, albumIDs []int64) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`INSERT OR IGNORE INTO group_albums(group_id, album_id) VALUES(?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, albumID := range albumIDs {
		if _, err := stmt.Exec(groupID, albumID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func UnbindAlbum(db *sql.DB, groupID, albumID int64) error {
	res, err := db.Exec(`DELETE FROM group_albums WHERE group_id=? AND album_id=?`, groupID, albumID)
	if err != nil {
		return err
	}
	return requireAffected(res)
}

// AlbumIDsForGroup 返回分组当前绑定的相册 id（供鉴权派生使用）。
func AlbumIDsForGroup(db *sql.DB, groupID int64) ([]int64, error) {
	rows, err := db.Query(`SELECT album_id FROM group_albums WHERE group_id=? ORDER BY album_id`, groupID)
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
