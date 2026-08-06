package store

import "database/sql"

// GetSetting 读取站点设置；未设置返回空串（非错误）。
func GetSetting(db *sql.DB, key string) (string, error) {
	var v string
	err := db.QueryRow(`SELECT value FROM settings WHERE key=?`, key).Scan(&v)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return v, err
}

// SetSetting 写入或更新站点设置。
func SetSetting(db *sql.DB, key, value string) error {
	_, err := db.Exec(`
		INSERT INTO settings(key, value) VALUES(?, ?)
		ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	return err
}
