package api

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"roundmemo/internal/store"
)

type sessionJSON struct {
	SID        string `json:"sid"`
	IssuedAt   int64  `json:"issued_at"`
	LastSeenAt int64  `json:"last_seen_at"`
	ExpiresAt  int64  `json:"expires_at"`
	UserAgent  string `json:"user_agent"`
}

// handleGrantSessions 列出某授权下仍活跃的会话（单设备下线前的设备列表）。
func (s *Server) handleGrantSessions(w http.ResponseWriter, r *http.Request) {
	grantID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的授权 id")
		return
	}
	if _, err := store.GetGrant(s.db, grantID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "授权不存在")
			return
		}
		s.internalError(w, err)
		return
	}
	sessions, err := store.SessionsForGrant(s.db, grantID, time.Now().Unix())
	if err != nil {
		s.internalError(w, err)
		return
	}
	out := make([]sessionJSON, 0, len(sessions))
	for _, sess := range sessions {
		out = append(out, sessionJSON{
			SID: sess.SID, IssuedAt: sess.IssuedAt,
			LastSeenAt: sess.LastSeenAt, ExpiresAt: sess.ExpiresAt,
			UserAgent: sess.UserAgent,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": out})
}

// handleDeleteSession 单设备下线：吊销指定会话。
func (s *Server) handleDeleteSession(w http.ResponseWriter, r *http.Request) {
	sid := chi.URLParam(r, "sid")
	if sid == "" {
		writeError(w, http.StatusBadRequest, "无效的会话 id")
		return
	}
	if err := store.DeleteSession(s.db, sid); err != nil {
		s.internalError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
