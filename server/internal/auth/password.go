package auth

import "github.com/alexedwards/argon2id"

// HashPassword 用 argon2id 默认参数（m=64MiB,t=3,p=2）。仅 Owner 登录用，
// 低频、单用户，64MiB 内存成本在此规模可接受且更抗 GPU 穷举。
func HashPassword(pw string) (string, error) {
	return argon2id.CreateHash(pw, argon2id.DefaultParams)
}

// VerifyPassword 校验密码，返回 (是否匹配, 错误)。
func VerifyPassword(pw, encodedHash string) (bool, error) {
	return argon2id.ComparePasswordAndHash(pw, encodedHash)
}
