package store

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

// Open 打开 SQLite 数据库并应用连接级 pragma。
// 全部走 WAL + foreign_keys，保证读写并发与引用完整性。
func Open(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("打开 SQLite: %w", err)
	}
	// 单连接即可：WAL 下并发读由数据库本身承担，过度连接反而放大锁竞争。
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	pragmas := []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA foreign_keys=ON",
		"PRAGMA busy_timeout=5000",
	}
	for _, p := range pragmas {
		if _, err := db.Exec(p); err != nil {
			db.Close()
			return nil, fmt.Errorf("应用 pragma %q: %w", p, err)
		}
	}
	return db, nil
}
