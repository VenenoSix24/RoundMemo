package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"roundmemo/internal/auth"
	"roundmemo/internal/store"
)

type grantJSON struct {
	ID             int64   `json:"id"`
	GroupID        int64   `json:"group_id"`
	Token          string  `json:"token"`
	NumericCode    string  `json:"numeric_code"`
	Label          *string `json:"label"`
	Enabled        bool    `json:"enabled"`
	Active         bool    `json:"active"`
	ExpiresAt      *int64  `json:"expires_at"`
	MaxUses        *int64  `json:"max_uses"`
	UsedCount      int64   `json:"used_count"`
	SessionTTLDays int     `json:"session_ttl_days"`
	CreatedAt      int64   `json:"created_at"`
	RevokedAt      *int64  `json:"revoked_at"`
}

func toGrantJSON(g *store.Grant, now int64) grantJSON {
	active := g.Enabled && g.RevokedAt == nil &&
		(g.ExpiresAt == nil || *g.ExpiresAt > now) &&
		(g.MaxUses == nil || g.UsedCount < *g.MaxUses)
	return grantJSON{
		ID: g.ID, GroupID: g.GroupID, Token: g.Token, NumericCode: g.NumericCode,
		Label: g.Label, Enabled: g.Enabled, Active: active,
		ExpiresAt: g.ExpiresAt, MaxUses: g.MaxUses, UsedCount: g.UsedCount,
		SessionTTLDays: g.SessionTTLDays, CreatedAt: g.CreatedAt, RevokedAt: g.RevokedAt,
	}
}

func (s *Server) handleListGrants(w http.ResponseWriter, _ *http.Request) {
	grants, err := store.ListGrants(s.db)
	if err != nil {
		s.internalError(w, err)
		return
	}
	now := time.Now().Unix()
	out := make([]grantJSON, 0, len(grants))
	for i := range grants {
		out = append(out, toGrantJSON(&grants[i], now))
	}
	writeJSON(w, http.StatusOK, map[string]any{"grants": out})
}

func (s *Server) handleCreateGrant(w http.ResponseWriter, r *http.Request) {
	var req struct {
		GroupID        int64   `json:"group_id"`
		Label          *string `json:"label"`
		ExpiresAt      *int64  `json:"expires_at"`
		MaxUses        *int64  `json:"max_uses"`
		SessionTTLDays int     `json:"session_ttl_days"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if req.GroupID == 0 {
		writeError(w, http.StatusBadRequest, "group_id 不能为空")
		return
	}
	if _, err := store.GetGroup(s.db, req.GroupID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "分组不存在")
			return
		}
		s.internalError(w, err)
		return
	}

	token, err := auth.RandomToken(32)
	if err != nil {
		s.internalError(w, err)
		return
	}
	// 8 位码唯一冲突概率极低，重试几次兜底。
	code := ""
	for i := 0; i < 3; i++ {
		code, err = auth.NumericCode()
		if err != nil {
			s.internalError(w, err)
			return
		}
		_, gerr := store.GetGrantByCode(s.db, code)
		if errors.Is(gerr, store.ErrNotFound) {
			break
		}
	}
	ttl := req.SessionTTLDays
	if ttl <= 0 {
		ttl = s.cfg.Security.SessionTTLDays
	}
	id, err := store.CreateGrant(s.db, &store.Grant{
		GroupID: req.GroupID, Token: token, NumericCode: code, Label: req.Label,
		Enabled: true, ExpiresAt: req.ExpiresAt, MaxUses: req.MaxUses,
		SessionTTLDays: ttl,
	})
	if err != nil {
		s.internalError(w, err)
		return
	}
	grant, err := store.GetGrant(s.db, id)
	if err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, toGrantJSON(grant, time.Now().Unix()))
}

func (s *Server) handleUpdateGrant(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的授权 id")
		return
	}
	var req struct {
		Enabled         *bool   `json:"enabled"`
		Label           *string `json:"label"`
		ExpiresAt       *int64  `json:"expires_at"`
		MaxUses         *int64  `json:"max_uses"`
		SessionTTLDays  *int    `json:"session_ttl_days"`
		RegenerateToken *bool   `json:"regenerate_token"`
		RegenerateCode  *bool   `json:"regenerate_code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}

	patch := store.GrantPatch{
		Enabled: req.Enabled, Label: req.Label,
		ExpiresAt: req.ExpiresAt, MaxUses: req.MaxUses,
		SessionTTLDays: req.SessionTTLDays,
	}
	if req.ExpiresAt != nil && *req.ExpiresAt == 0 {
		patch.ExpiresAt, patch.ClearExpires = nil, true
	}
	if req.MaxUses != nil && *req.MaxUses == 0 {
		patch.MaxUses, patch.ClearMaxUses = nil, true
	}
	if req.Label != nil && *req.Label == "" {
		patch.Label, patch.ClearLabel = nil, true
	}
	if req.RegenerateToken != nil && *req.RegenerateToken {
		token, err := auth.RandomToken(32)
		if err != nil {
			s.internalError(w, err)
			return
		}
		patch.Token = &token
	}
	if req.RegenerateCode != nil && *req.RegenerateCode {
		code, err := auth.NumericCode()
		if err != nil {
			s.internalError(w, err)
			return
		}
		patch.NumericCode = &code
	}

	if err := store.UpdateGrant(s.db, id, patch); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "授权不存在")
			return
		}
		s.internalError(w, err)
		return
	}
	grant, err := store.GetGrant(s.db, id)
	if err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toGrantJSON(grant, time.Now().Unix()))
}

func (s *Server) handleDeleteGrant(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的授权 id")
		return
	}
	if err := store.DeleteGrant(s.db, id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "授权不存在")
			return
		}
		s.internalError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
