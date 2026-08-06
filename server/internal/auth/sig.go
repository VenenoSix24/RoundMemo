package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
)

// SignImageURL 生成绑定会话的图片分发签名（docs/decisions/0002 方案 A）：
// sig = HMAC(secret, sid|kind|sha|exp)。签发方必须自己保留 sid、exp，
// URL 形如 /img/<kind>/<sha>?sid=...&exp=...&sig=...
func SignImageURL(secret []byte, sid, kind, sha string, exp int64) string {
	mac := hmac.New(sha256.New, secret)
	fmt.Fprintf(mac, "%s|%s|%s|%d", sid, kind, sha, exp)
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// VerifyImageSig 常量时间校验签名。签名由服务端 secret 计算，客户端无法伪造；
// 校验通过后再走会话鉴权，保证吊销即时生效（decisions/0002）。
func VerifyImageSig(secret []byte, sid, kind, sha string, exp int64, sig string) bool {
	want := SignImageURL(secret, sid, kind, sha, exp)
	return hmac.Equal([]byte(want), []byte(sig))
}
