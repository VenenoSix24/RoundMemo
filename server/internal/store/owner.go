package store

import (
	"database/sql"
	"time"
)

type Owner struct {
	ID           int64
	Username     string
	PasswordHash string
	CreatedAt    int64
}

// UpsertOwner 创建或重置 Owner（唯一用户名）。已存在时仅更新密码，保留创建时间，
// 使同一命令既能初始化也能改密。
func UpsertOwner(db *sql.DB, username, passwordHash string) (int64, error) {
	res, err := db.Exec(`
		INSERT INTO owner(username, password_hash, created_at) VALUES(?, ?, ?)
		ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash`,
		username, passwordHash, time.Now().Unix())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func GetOwnerByUsername(db *sql.DB, username string) (*Owner, error) {
	row := db.QueryRow(`SELECT id, username, password_hash, created_at FROM owner WHERE username=?`, username)
	var o Owner
	if err := row.Scan(&o.ID, &o.Username, &o.PasswordHash, &o.CreatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &o, nil
}
