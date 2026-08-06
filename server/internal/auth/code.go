package auth

import (
	"crypto/rand"
	"math/big"
	"strings"
)

// NumericCode 生成 8 位数字口令（每位 0-9 独立随机，允许前导 0）。
// 由 crypto/rand 产生，避免可预测性。
func NumericCode() (string, error) {
	var b strings.Builder
	for i := 0; i < 8; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			return "", err
		}
		b.WriteByte(byte('0' + n.Int64()))
	}
	return b.String(), nil
}
