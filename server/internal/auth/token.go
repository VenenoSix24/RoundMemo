package auth

import (
	"crypto/rand"
	"encoding/base64"
)

// RandomToken 生成 n 字节的 CSPRNG 随机 token（base64url 无 padding）。
// 用于会话 sid、grant token 等高熵标识。
func RandomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
