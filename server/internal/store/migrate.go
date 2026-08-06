package store

import (
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

var ErrNotFound = errors.New("记录不存在")

// Migrate 按文件名顺序应用未执行的迁移。逐条语句在独立事务中执行，
// 任一失败整体回滚，保证 schema 与应用代码永远对齐。
func Migrate(db *sql.DB) error {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY,
		applied_at INTEGER NOT NULL
	)`); err != nil {
		return fmt.Errorf("创建迁移记录表: %w", err)
	}

	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("读取迁移目录: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)

	for _, name := range names {
		applied, err := migrationApplied(db, name)
		if err != nil {
			return err
		}
		if applied {
			continue
		}
		content, err := migrationsFS.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}
		if err := applyMigration(db, name, content); err != nil {
			return err
		}
	}
	return nil
}

func migrationApplied(db *sql.DB, name string) (bool, error) {
	var n int
	err := db.QueryRow(`SELECT COUNT(1) FROM schema_migrations WHERE version=?`, name).Scan(&n)
	if err != nil {
		return false, fmt.Errorf("查询迁移状态 %s: %w", name, err)
	}
	return n > 0, nil
}

func applyMigration(db *sql.DB, name string, content []byte) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// SQLite 驱动不保证一次 Exec 执行多条语句，按 ';' 切分逐条执行。
	for _, stmt := range strings.Split(string(content), ";") {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		if _, err := tx.Exec(stmt); err != nil {
			return fmt.Errorf("迁移 %s 执行失败: %w", name, err)
		}
	}

	if _, err := tx.Exec(`INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)`,
		name, time.Now().Unix()); err != nil {
		return fmt.Errorf("记录迁移 %s: %w", name, err)
	}
	return tx.Commit()
}
