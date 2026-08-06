package store

import (
	"database/sql"
	"time"
)

type Session struct {
	SID        string
	IssuedAt   int64
	LastSeenAt int64
	ExpiresAt  int64
	UserAgent  string
}

type GroupSummary struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// CreateSession 记录会话。ttlDays 来自解锁它的 grant（decisions/0001：会话不绑定照片，
// 可访问的 group 由 session_grants → grants → group_albums 实时派生）。
func CreateSession(db *sql.DB, sid, userAgent string, ttlDays int) error {
	now := time.Now().Unix()
	_, err := db.Exec(`
		INSERT INTO sessions(sid, issued_at, last_seen_at, expires_at, user_agent)
		VALUES(?, ?, ?, ?, ?)`,
		sid, now, now, now+int64(ttlDays)*86400, userAgent)
	return err
}

// GetSession 返回未过期的会话。过期即视为不存在。
func GetSession(db *sql.DB, sid string, now int64) (*Session, error) {
	row := db.QueryRow(`
		SELECT sid, issued_at, last_seen_at, expires_at, user_agent
		FROM sessions WHERE sid=? AND expires_at > ?`, sid, now)
	var s Session
	if err := row.Scan(&s.SID, &s.IssuedAt, &s.LastSeenAt, &s.ExpiresAt, &s.UserAgent); err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &s, nil
}

// DeleteSession 主动吊销会话（退出访问 / 单设备下线）。
func DeleteSession(db *sql.DB, sid string) error {
	_, err := db.Exec(`DELETE FROM sessions WHERE sid=?`, sid)
	return err
}

// LinkSessionGrant 把一次解锁关联到会话。同会话解锁多个 grant 即累积多个 group。
func LinkSessionGrant(db *sql.DB, sid string, grantID int64) error {
	_, err := db.Exec(`INSERT OR IGNORE INTO session_grants(session_id, grant_id) VALUES(?, ?)`,
		sid, grantID)
	return err
}

// SessionGroups 返回会话当前可访问的分组。每次都实时校验 grant 状态：
// 任一 grant 被禁用/到期/超量/撤销，其 group 立即从结果消失（开发文档 §6.3）。
func SessionGroups(db *sql.DB, sid string, now int64) ([]GroupSummary, error) {
	rows, err := db.Query(`
		SELECT DISTINCT g.group_id, grp.name
		FROM session_grants sg
		JOIN grants g ON g.id = sg.grant_id
		JOIN groups grp ON grp.id = g.group_id
		WHERE sg.session_id = ?
		  AND g.enabled = 1 AND g.revoked_at IS NULL
		  AND (g.expires_at IS NULL OR g.expires_at > ?)
		  AND (g.max_uses IS NULL OR g.used_count < g.max_uses)
		ORDER BY g.group_id`, sid, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := []GroupSummary{}
	for rows.Next() {
		var g GroupSummary
		if err := rows.Scan(&g.ID, &g.Name); err != nil {
			return nil, err
		}
		groups = append(groups, g)
	}
	return groups, rows.Err()
}

// SessionCoversAlbum 判断会话是否能访问某个相册（该相册被某个可见分组绑定）。
func SessionCoversAlbum(db *sql.DB, sid string, albumID int64, now int64) (bool, error) {
	var n int
	err := db.QueryRow(`
		SELECT COUNT(1) FROM session_grants sg
		JOIN grants g ON g.id = sg.grant_id
		JOIN group_albums ga ON ga.group_id = g.group_id
		WHERE sg.session_id = ? AND ga.album_id = ?
		  AND g.enabled = 1 AND g.revoked_at IS NULL
		  AND (g.expires_at IS NULL OR g.expires_at > ?)
		  AND (g.max_uses IS NULL OR g.used_count < g.max_uses)`,
		sid, albumID, now).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// DeleteGrantSessions 撤销某授权下所有活跃会话（重生令牌/下线全部设备时用）。
func DeleteGrantSessions(db *sql.DB, grantID int64) error {
	_, err := db.Exec(`DELETE FROM sessions WHERE sid IN (
		SELECT session_id FROM session_grants WHERE grant_id=?)`, grantID)
	return err
}

// SessionsForGrant 返回某授权下仍活跃的会话（Owner 后台查看设备列表）。
func SessionsForGrant(db *sql.DB, grantID int64, now int64) ([]Session, error) {
	rows, err := db.Query(`
		SELECT s.sid, s.issued_at, s.last_seen_at, s.expires_at, s.user_agent
		FROM sessions s JOIN session_grants sg ON sg.session_id = s.sid
		WHERE sg.grant_id=? AND s.expires_at > ?
		ORDER BY s.last_seen_at DESC`, grantID, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	sessions := []Session{}
	for rows.Next() {
		var s Session
		if err := rows.Scan(&s.SID, &s.IssuedAt, &s.LastSeenAt, &s.ExpiresAt, &s.UserAgent); err != nil {
			return nil, err
		}
		sessions = append(sessions, s)
	}
	return sessions, rows.Err()
}

// PurgeExpiredSessions 清理过期会话，防 sessions 表无限膨胀。
func PurgeExpiredSessions(db *sql.DB, now int64) error {
	_, err := db.Exec(`DELETE FROM sessions WHERE expires_at <= ?`, now)
	return err
}
