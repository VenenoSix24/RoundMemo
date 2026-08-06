package api

import (
	"net"
	"net/http"
	"sync"
	"time"
)

// rateLimiter 单进程内存限流（开发文档 §6.4 缓解措施）。多副本部署时需换共享存储，
// 见 docs/future.md。
type rateLimiter struct {
	mu       sync.Mutex
	window   time.Duration
	limit    int
	attempts map[string][]time.Time
}

func newRateLimiter(window time.Duration, limit int) *rateLimiter {
	if limit <= 0 {
		limit = 10
	}
	return &rateLimiter{window: window, limit: limit, attempts: map[string][]time.Time{}}
}

// allow 判断 key（通常是 IP）在窗口内是否还有配额，有则记账。
func (rl *rateLimiter) allow(key string) bool {
	now := time.Now()
	cutoff := now.Add(-rl.window)
	rl.mu.Lock()
	defer rl.mu.Unlock()

	kept := rl.attempts[key][:0]
	for _, t := range rl.attempts[key] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= rl.limit {
		rl.attempts[key] = kept
		return false
	}
	rl.attempts[key] = append(kept, now)
	return true
}

// clientIP 取请求来源 IP。chi RealIP 中间件已优先用 X-Forwarded-For（Caddy 在墙外）。
func clientIP(r *http.Request) string {
	if h, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return h
	}
	return r.RemoteAddr
}
