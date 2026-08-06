package auth

import (
	"crypto/rand"
	"os"
	"path/filepath"
)

// LoadOrCreateSecret 读取数据目录里的签名密钥，不存在则生成 32 字节随机值落盘。
// 密钥必须跨重启稳定（否则已签发图片 URL 全部失效），故持久化而非每次随机。
func LoadOrCreateSecret(dataDir string) ([]byte, error) {
	path := filepath.Join(dataDir, "secret.key")
	if b, err := os.ReadFile(path); err == nil && len(b) == 32 {
		return b, nil
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, key, 0o600); err != nil {
		return nil, err
	}
	return key, nil
}
