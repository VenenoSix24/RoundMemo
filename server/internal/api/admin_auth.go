package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"roundmemo/internal/auth"
	"roundmemo/internal/store"
)

func (s *Server) handleAdminLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}

	owner, err := store.GetOwnerByUsername(s.db, req.Username)
	if err != nil {
		// 用户不存在与密码错误统一响应，避免枚举用户名
		if !errors.Is(err, store.ErrNotFound) {
			s.internalError(w, err)
			return
		}
		writeError(w, http.StatusUnauthorized, "用户名或密码错误")
		return
	}

	ok, err := auth.VerifyPassword(req.Password, owner.PasswordHash)
	if err != nil {
		s.internalError(w, err)
		return
	}
	if !ok {
		writeError(w, http.StatusUnauthorized, "用户名或密码错误")
		return
	}

	sid, err := auth.RandomToken(32)
	if err != nil {
		s.internalError(w, err)
		return
	}
	if err := store.CreateAdminSession(s.db, sid, r.UserAgent(), s.cfg.Security.AdminSessionTTLDays); err != nil {
		s.internalError(w, err)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     adminCookieName,
		Value:    sid,
		Path:     "/",
		HttpOnly: true,
		Secure:   s.cfg.Server.SecureCookies,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   s.cfg.Security.AdminSessionTTLDays * 86400,
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"username":   owner.Username,
		"expires_at": time.Now().Unix() + int64(s.cfg.Security.AdminSessionTTLDays)*86400,
	})
}
