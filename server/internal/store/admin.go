package store

import (
	"database/sql"
	"time"
)

type AdminSession struct {
	SID       string
	CreatedAt int64
	ExpiresAt int64
	UserAgent string
}

// CreateAdminSession 记录一条管理会话。sid 由调用方生成（32 字节随机），
// 存库以便随时吊销，符合 opaque session 而非 JWT 的选型。
func CreateAdminSession(db *sql.DB, sid, userAgent string, ttlDays int) error {
	now := time.Now().Unix()
	_, err := db.Exec(`
		INSERT INTO admin_sessions(sid, created_at, expires_at, user_agent)
		VALUES(?, ?, ?, ?)`,
		sid, now, now+int64(ttlDays)*86400, userAgent)
	return err
}

func GetAdminSession(db *sql.DB, sid string, now int64) (*AdminSession, error) {
	row := db.QueryRow(`
		SELECT sid, created_at, expires_at, user_agent FROM admin_sessions
		WHERE sid=? AND expires_at > ?`, sid, now)
	var s AdminSession
	if err := row.Scan(&s.SID, &s.CreatedAt, &s.ExpiresAt, &s.UserAgent); err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &s, nil
}

// DeleteAdminSession 主动吊销（退出登录）。
func DeleteAdminSession(db *sql.DB, sid string) error {
	_, err := db.Exec(`DELETE FROM admin_sessions WHERE sid=?`, sid)
	return err
}
