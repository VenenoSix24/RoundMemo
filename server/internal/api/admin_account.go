package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"roundmemo/internal/auth"
	"roundmemo/internal/store"
)

// handleAdminAccount 修改 Owner 账号（用户名/密码）。改密必须验证当前密码；
// 改用户名同样要求验证，防止他人篡改。改完不吊销现有管理会话（会话不含用户名）。
func (s *Server) handleAdminAccount(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CurrentPassword string  `json:"current_password"`
		Username        *string `json:"username"`
		Password        *string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}

	owner, err := store.GetOwner(s.db)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusUnauthorized, "未初始化")
			return
		}
		s.internalError(w, err)
		return
	}
	ok, err := auth.VerifyPassword(req.CurrentPassword, owner.PasswordHash)
	if err != nil {
		s.internalError(w, err)
		return
	}
	if !ok {
		writeError(w, http.StatusUnauthorized, "当前密码错误")
		return
	}

	var newUser, newHash *string
	if req.Username != nil && *req.Username != "" {
		v := *req.Username
		newUser = &v
	}
	if req.Password != nil && *req.Password != "" {
		if len(*req.Password) < 8 {
			writeError(w, http.StatusBadRequest, "新密码至少 8 位")
			return
		}
		hash, err := auth.HashPassword(*req.Password)
		if err != nil {
			s.internalError(w, err)
			return
		}
		newHash = &hash
	}
	if newUser == nil && newHash == nil {
		writeError(w, http.StatusBadRequest, "没有要修改的内容")
		return
	}

	if err := store.UpdateOwner(s.db, newUser, newHash); err != nil {
		s.internalError(w, err)
		return
	}
	username := owner.Username
	if newUser != nil {
		username = *newUser
	}
	writeJSON(w, http.StatusOK, map[string]any{"username": username, "ok": true})
}
