package api

import (
	"context"
	"net/http"
	"strings"
	"time"

	"roundmemo/internal/store"
)

// adminCookieName 为管理会话 httpOnly cookie 名。同一会话也接受
// Authorization: Bearer 携带 sid，为将来软件端不依赖 cookie 预留（开发文档 §8.3 预留点）。
const adminCookieName = "rm_admin"

type ctxKey int

const (
	ctxAdminSession ctxKey = iota
)

func adminSessionFrom(r *http.Request) *store.AdminSession {
	if s, ok := r.Context().Value(ctxAdminSession).(*store.AdminSession); ok {
		return s
	}
	return nil
}

// requireAdmin 解析管理会话：优先 httpOnly cookie，其次 Bearer。未解析到一律 401。
func (s *Server) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sid := ""
		if c, err := r.Cookie(adminCookieName); err == nil {
			sid = c.Value
		} else if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
			sid = strings.TrimPrefix(h, "Bearer ")
		}
		if sid == "" {
			writeError(w, http.StatusUnauthorized, "未登录")
			return
		}

		sess, err := store.GetAdminSession(s.db, sid, time.Now().Unix())
		if err != nil {
			// 会话不存在或已过期：同样 401，不暴露具体原因
			writeError(w, http.StatusUnauthorized, "会话无效或已过期")
			return
		}

		ctx := context.WithValue(r.Context(), ctxAdminSession, sess)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
