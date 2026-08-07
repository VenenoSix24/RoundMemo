package store

import "database/sql"

// BackupCounts 备份清单统计：恢复后对账 + manifest 展示用。
type BackupCounts struct {
	Photos int64
	Albums int64
	Groups int64
	Grants int64
}

// CountForBackup 汇总各实体数量，写入备份 manifest。
func CountForBackup(db *sql.DB) (BackupCounts, error) {
	var c BackupCounts
	q := []struct {
		sql  string
		dest *int64
	}{
		{`SELECT COUNT(1) FROM photos`, &c.Photos},
		{`SELECT COUNT(1) FROM albums`, &c.Albums},
		{`SELECT COUNT(1) FROM groups`, &c.Groups},
		{`SELECT COUNT(1) FROM grants`, &c.Grants},
	}
	for _, item := range q {
		if err := db.QueryRow(item.sql).Scan(item.dest); err != nil {
			return c, err
		}
	}
	return c, nil
}
