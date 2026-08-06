package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"roundmemo/internal/auth"
	"roundmemo/internal/store"
)

// visitorCookieName 访客会话 cookie（开发文档 §5.6 的 rm_sid）。
const visitorCookieName = "rm_sid"

// visitorSession 解析访客会话：cookie rm_sid 优先，其次 Bearer。
// 无有效会话返回 nil；调用方统一按 404/空响应处理，不泄露存在性。
func (s *Server) visitorSession(r *http.Request) *store.Session {
	sid := ""
	if c, err := r.Cookie(visitorCookieName); err == nil {
		sid = c.Value
	} else if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		sid = strings.TrimPrefix(h, "Bearer ")
	}
	if sid == "" {
		return nil
	}
	sess, err := store.GetSession(s.db, sid, time.Now().Unix())
	if err != nil {
		return nil
	}
	return sess
}

// grantValid 校验授权当前是否可用。max_uses 的原子判定在 IncrementGrantUse 里做。
func grantValid(g *store.Grant, now int64) bool {
	return g.Enabled && g.RevokedAt == nil &&
		(g.ExpiresAt == nil || *g.ExpiresAt > now) &&
		(g.MaxUses == nil || g.UsedCount < *g.MaxUses)
}

// unlock 双解锁口径的共用实现：校验授权 → 递增用量 → 建/扩会话 → 下发 cookie。
func (s *Server) unlock(w http.ResponseWriter, r *http.Request, byCode bool) {
	var req struct {
		Code  string `json:"code"`
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	value := req.Token
	if byCode {
		value = req.Code
		if !s.codeLimiter.allow(clientIP(r)) {
			writeError(w, http.StatusTooManyRequests, "尝试过于频繁，请稍后再试")
			return
		}
	}

	now := time.Now().Unix()
	var grant *store.Grant
	var err error
	if byCode {
		grant, err = store.GetGrantByCode(s.db, value)
	} else {
		grant, err = store.GetGrantByToken(s.db, value)
	}
	// 存在与否响应一致（防枚举），无论是否命中都提示同一文案。
	if err != nil || !grantValid(grant, now) {
		writeError(w, http.StatusUnauthorized, "口令无效或已失效")
		return
	}

	// 原子递增用量；max_uses 已满返回 false（并发下不超卖）。
	ok, err := store.IncrementGrantUse(s.db, grant.ID)
	if err != nil {
		s.internalError(w, err)
		return
	}
	if !ok {
		writeError(w, http.StatusUnauthorized, "口令无效或已失效")
		return
	}

	// 已有会话则扩展（decisions/0001：同一浏览器多 group 共存），否则新建。
	sess := s.visitorSession(r)
	sid := ""
	if sess == nil {
		sid, err = auth.RandomToken(32)
		if err != nil {
			s.internalError(w, err)
			return
		}
		if err := store.CreateSession(s.db, sid, r.UserAgent(), grant.SessionTTLDays); err != nil {
			s.internalError(w, err)
			return
		}
	} else {
		sid = sess.SID
	}
	if err := store.LinkSessionGrant(s.db, sid, grant.ID); err != nil {
		s.internalError(w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     visitorCookieName,
		Value:    sid,
		Path:     "/",
		HttpOnly: true,
		Secure:   s.cfg.Server.SecureCookies,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   grant.SessionTTLDays * 86400,
	})

	groups, err := store.SessionGroups(s.db, sid, time.Now().Unix())
	if err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"groups": groups})
}

func (s *Server) handleUnlockByCode(w http.ResponseWriter, r *http.Request) {
	s.unlock(w, r, true)
}

func (s *Server) handleUnlockByToken(w http.ResponseWriter, r *http.Request) {
	s.unlock(w, r, false)
}

// handleSessionInfo 返回会话可访问的分组。无会话也返回 200 + 空列表，
// 让口令入口页不报错即可展示"请输入口令"。
func (s *Server) handleSessionInfo(w http.ResponseWriter, r *http.Request) {
	groups := []store.GroupSummary{}
	if sess := s.visitorSession(r); sess != nil {
		var err error
		groups, err = store.SessionGroups(s.db, sess.SID, time.Now().Unix())
		if err != nil {
			s.internalError(w, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"groups": groups})
}

// handleRevokeSession 清空当前会话与 cookie（退出访问）。
func (s *Server) handleRevokeSession(w http.ResponseWriter, r *http.Request) {
	if sess := s.visitorSession(r); sess != nil {
		if err := store.DeleteSession(s.db, sess.SID); err != nil {
			s.internalError(w, err)
			return
		}
	}
	http.SetCookie(w, &http.Cookie{
		Name:     visitorCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   s.cfg.Server.SecureCookies,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
