package store

import (
	"database/sql"
	"strings"
)

// nullStringPtr 把 NULL 列转成 nil 指针，便于 JSON 输出为 null 而非 ""。
func nullStringPtr(ns sql.NullString) *string {
	if !ns.Valid {
		return nil
	}
	v := ns.String
	return &v
}

func nullIntPtr(ni sql.NullInt64) *int64 {
	if !ni.Valid {
		return nil
	}
	v := ni.Int64
	return &v
}

// requireAffected 把"无匹配行"归一为 ErrNotFound，让调用方统一按 404 处理。
func requireAffected(res sql.Result) error {
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// nullableString/Int 把 nil 指针转为 SQL NULL，非 nil 取解引用值。
func nullableString(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

func nullableInt(p *int64) any {
	if p == nil {
		return nil
	}
	return *p
}

func joinSets(sets []string) string {
	return strings.Join(sets, ", ")
}
