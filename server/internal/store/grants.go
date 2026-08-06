package store

import (
	"database/sql"
	"time"
)

type Grant struct {
	ID             int64
	GroupID        int64
	Token          string
	NumericCode    string
	Label          *string
	Enabled        bool
	ExpiresAt      *int64
	MaxUses        *int64
	UsedCount      int64
	SessionTTLDays int
	CreatedAt      int64
	RevokedAt      *int64
}

func CreateGrant(db *sql.DB, g *Grant) (int64, error) {
	enabled := 1
	if !g.Enabled {
		enabled = 0
	}
	res, err := db.Exec(`
		INSERT INTO grants(group_id, token, numeric_code, label, enabled, expires_at,
			max_uses, session_ttl_days, created_at)
		VALUES(?,?,?,?,?,?,?,?,?)`,
		g.GroupID, g.Token, g.NumericCode, g.Label, enabled,
		g.ExpiresAt, g.MaxUses, g.SessionTTLDays, time.Now().Unix())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func ListGrants(db *sql.DB) ([]Grant, error) {
	rows, err := db.Query(`
		SELECT id, group_id, token, numeric_code, label, enabled, expires_at,
			max_uses, used_count, session_ttl_days, created_at, revoked_at
		FROM grants ORDER BY created_at DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	grants := []Grant{}
	for rows.Next() {
		g, err := scanGrant(rows)
		if err != nil {
			return nil, err
		}
		grants = append(grants, *g)
	}
	return grants, rows.Err()
}

func GetGrant(db *sql.DB, id int64) (*Grant, error) {
	return scanGrant(db.QueryRow(`
		SELECT id, group_id, token, numeric_code, label, enabled, expires_at,
			max_uses, used_count, session_ttl_days, created_at, revoked_at
		FROM grants WHERE id=?`, id))
}

func GetGrantByToken(db *sql.DB, token string) (*Grant, error) {
	return scanGrant(db.QueryRow(`
		SELECT id, group_id, token, numeric_code, label, enabled, expires_at,
			max_uses, used_count, session_ttl_days, created_at, revoked_at
		FROM grants WHERE token=?`, token))
}

func GetGrantByCode(db *sql.DB, code string) (*Grant, error) {
	return scanGrant(db.QueryRow(`
		SELECT id, group_id, token, numeric_code, label, enabled, expires_at,
			max_uses, used_count, session_ttl_days, created_at, revoked_at
		FROM grants WHERE numeric_code=?`, code))
}

// GrantPatch 授权补丁。nil 字段表示不变；ClearXxx 表示写 NULL。
type GrantPatch struct {
	Enabled        *bool
	Label          *string
	ClearLabel     bool
	ExpiresAt      *int64
	ClearExpires   bool
	MaxUses        *int64
	ClearMaxUses   bool
	SessionTTLDays *int
	Token          *string
	NumericCode    *string
}

// UpdateGrant 应用授权补丁，仅更新变化字段。Token/NumericCode 传新值即重生。
func UpdateGrant(db *sql.DB, id int64, p GrantPatch) error {
	sets := []string{}
	args := []any{}
	if p.Enabled != nil {
		v := 0
		if *p.Enabled {
			v = 1
		}
		sets = append(sets, "enabled=?")
		args = append(args, v)
	}
	if p.Label != nil || p.ClearLabel {
		sets = append(sets, "label=?")
		args = append(args, nullableString(p.Label))
	}
	if p.ExpiresAt != nil || p.ClearExpires {
		sets = append(sets, "expires_at=?")
		args = append(args, nullableInt(p.ExpiresAt))
	}
	if p.MaxUses != nil || p.ClearMaxUses {
		sets = append(sets, "max_uses=?")
		args = append(args, nullableInt(p.MaxUses))
	}
	if p.SessionTTLDays != nil {
		sets = append(sets, "session_ttl_days=?")
		args = append(args, *p.SessionTTLDays)
	}
	if p.Token != nil {
		sets = append(sets, "token=?")
		args = append(args, *p.Token)
	}
	if p.NumericCode != nil {
		sets = append(sets, "numeric_code=?")
		args = append(args, *p.NumericCode)
	}
	if len(sets) == 0 {
		_, err := GetGrant(db, id)
		return err
	}
	args = append(args, id)
	res, err := db.Exec(`UPDATE grants SET `+joinSets(sets)+` WHERE id=?`, args...)
	if err != nil {
		return err
	}
	return requireAffected(res)
}

func DeleteGrant(db *sql.DB, id int64) error {
	res, err := db.Exec(`DELETE FROM grants WHERE id=?`, id)
	if err != nil {
		return err
	}
	return requireAffected(res)
}

// IncrementGrantUse 原子递增用量并带 max_uses 守卫：已满返回 (false, nil)，
// 并发解锁不会超卖。
func IncrementGrantUse(db *sql.DB, id int64) (bool, error) {
	res, err := db.Exec(`UPDATE grants SET used_count = used_count + 1
		WHERE id=? AND (max_uses IS NULL OR used_count < max_uses)`, id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

func scanGrant(row scanner) (*Grant, error) {
	var g Grant
	var label sql.NullString
	var enabled int
	if err := row.Scan(&g.ID, &g.GroupID, &g.Token, &g.NumericCode, &label, &enabled,
		&g.ExpiresAt, &g.MaxUses, &g.UsedCount, &g.SessionTTLDays, &g.CreatedAt, &g.RevokedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	g.Enabled = enabled == 1
	g.Label = nullStringPtr(label)
	return &g, nil
}
