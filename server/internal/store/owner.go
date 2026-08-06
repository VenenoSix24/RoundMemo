package store

import (
	"database/sql"
	"strings"
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

// GetOwner 返回唯一 Owner（单用户产品）。whoami 需要用户名展示顶栏身份。
func GetOwner(db *sql.DB) (*Owner, error) {
	row := db.QueryRow(`SELECT id, username, password_hash, created_at FROM owner ORDER BY id LIMIT 1`)
	var o Owner
	if err := row.Scan(&o.ID, &o.Username, &o.PasswordHash, &o.CreatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &o, nil
}

// UpdateOwner 修改唯一 Owner 的用户名/密码哈希（改账号）。nil 字段表示不变。
func UpdateOwner(db *sql.DB, newUsername, newPasswordHash *string) error {
	sets := []string{}
	args := []any{}
	if newUsername != nil {
		sets = append(sets, "username=?")
		args = append(args, *newUsername)
	}
	if newPasswordHash != nil {
		sets = append(sets, "password_hash=?")
		args = append(args, *newPasswordHash)
	}
	if len(sets) == 0 {
		return nil
	}
	_, err := db.Exec(`UPDATE owner SET `+strings.Join(sets, ", ")+` WHERE id=(SELECT id FROM owner ORDER BY id LIMIT 1)`, args...)
	return err
}
