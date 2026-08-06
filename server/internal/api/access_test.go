package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"roundmemo/internal/auth"
	"roundmemo/internal/store"
)

// seedAccess 建好 Owner/相册1/分组1(绑定相册1)/授权，返回 admin cookie、码、token。
func seedAccess(t *testing.T, s *Server, db *sql.DB, groupName string) (adminCookie, code, token string) {
	t.Helper()
	seedOwner(t, db, "admin", "correct-password")
	adminCookie = loginOwner(t, s, "admin", "correct-password")

	doRequest(t, s, http.MethodPost, "/api/admin/albums", `{"title":"相册一"}`, adminCookie)
	if rr := doRequest(t, s, http.MethodPost, "/api/admin/groups", fmt.Sprintf(`{"name":%q}`, groupName), adminCookie); rr.Code != http.StatusCreated {
		t.Fatalf("建分组失败: %d %s", rr.Code, rr.Body.String())
	}
	doRequest(t, s, http.MethodPost, "/api/admin/groups/1/albums", `{"album_ids":[1]}`, adminCookie)

	rr := doRequest(t, s, http.MethodPost, "/api/admin/grants", `{"group_id":1}`, adminCookie)
	if rr.Code != http.StatusCreated {
		t.Fatalf("建授权失败: %d %s", rr.Code, rr.Body.String())
	}
	var g struct {
		NumericCode string `json:"numeric_code"`
		Token       string `json:"token"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &g); err != nil {
		t.Fatal(err)
	}
	return adminCookie, g.NumericCode, g.Token
}

func cookieFrom(t *testing.T, rr *httptest.ResponseRecorder) string {
	t.Helper()
	for _, c := range rr.Result().Cookies() {
		if c.Name == visitorCookieName {
			return visitorCookieName + "=" + c.Value
		}
	}
	t.Fatal("响应未携带 rm_sid cookie")
	return ""
}

func unlockByCode(t *testing.T, s *Server, code, cookie string) *httptest.ResponseRecorder {
	t.Helper()
	return doRequest(t, s, http.MethodPost, "/api/access/code",
		fmt.Sprintf(`{"code":%q}`, code), cookie)
}

func TestUnlockByCodeAndToken(t *testing.T) {
	s, db := newTestServer(t)
	_, code, token := seedAccess(t, s, db, "全体同学")

	rr := unlockByCode(t, s, code, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("码解锁应 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"name":"全体同学"`) {
		t.Fatalf("返回应含分组: %s", rr.Body.String())
	}
	cookie := cookieFrom(t, rr)

	rr = doRequest(t, s, http.MethodGet, "/api/session", "", cookie)
	if !strings.Contains(rr.Body.String(), "全体同学") {
		t.Fatalf("会话应含分组: %s", rr.Body.String())
	}

	rr = doRequest(t, s, http.MethodPost, "/api/access/token", fmt.Sprintf(`{"token":%q}`, token), "")
	if rr.Code != http.StatusOK {
		t.Fatalf("token 解锁应 200, got %d", rr.Code)
	}
}

func TestUnlockWrongCodeGeneric(t *testing.T) {
	s, db := newTestServer(t)
	seedOwner(t, db, "admin", "correct-password")

	// 空库与错码响应应一致（不泄露"码是否存在"）
	rr1 := unlockByCode(t, s, "00000000", "")
	rr2 := unlockByCode(t, s, "99999999", "")
	if rr1.Code != http.StatusUnauthorized || rr2.Code != http.StatusUnauthorized {
		t.Fatalf("错码应 401: %d %d", rr1.Code, rr2.Code)
	}
	if rr1.Body.String() != rr2.Body.String() {
		t.Fatalf("错对响应应一致: %q vs %q", rr1.Body.String(), rr2.Body.String())
	}
}

func TestCodeRateLimit(t *testing.T) {
	s, db := newTestServer(t)
	seedOwner(t, db, "admin", "correct-password")

	// 默认每 IP 每小时 10 次：第 11 次应 429
	for i := 0; i < 10; i++ {
		if rr := unlockByCode(t, s, "00000000", ""); rr.Code != http.StatusUnauthorized {
			t.Fatalf("第 %d 次应为 401, got %d", i+1, rr.Code)
		}
	}
	if rr := unlockByCode(t, s, "00000000", ""); rr.Code != http.StatusTooManyRequests {
		t.Fatalf("超限应 429, got %d", rr.Code)
	}
	// token 解锁不受限流
	if rr := doRequest(t, s, http.MethodPost, "/api/access/token", `{"token":"whatever"}`, ""); rr.Code != http.StatusUnauthorized {
		t.Fatalf("token 不受限流，应 401, got %d", rr.Code)
	}
}

func TestUnlockRejectsInvalidGrant(t *testing.T) {
	cases := []struct {
		name  string
		patch string
	}{
		{"禁用", `{"enabled":false}`},
		{"到期", `{"expires_at":1}`},
		{"用量已尽", `{"max_uses":1}`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, db := newTestServer(t)
			adminCookie, code, _ := seedAccess(t, s, db, "G")

			// 先把用量用尽（针对 max_uses 用例：补丁后 1 次即超限）
			unlockByCode(t, s, code, "")

			if rr := doRequest(t, s, http.MethodPatch, "/api/admin/grants/1", tc.patch, adminCookie); rr.Code != http.StatusOK {
				t.Fatalf("补丁失败: %d", rr.Code)
			}

			if rr := unlockByCode(t, s, code, ""); rr.Code != http.StatusUnauthorized {
				t.Fatalf("%s 后解锁应 401, got %d", tc.name, rr.Code)
			}
		})
	}
}

func TestSessionMergeAndGroupSwitch(t *testing.T) {
	s, db := newTestServer(t)
	seedOwner(t, db, "admin", "correct-password")
	adminCookie := loginOwner(t, s, "admin", "correct-password")

	doRequest(t, s, http.MethodPost, "/api/admin/albums", `{"title":"相册A"}`, adminCookie)
	doRequest(t, s, http.MethodPost, "/api/admin/albums", `{"title":"相册B"}`, adminCookie)
	doRequest(t, s, http.MethodPost, "/api/admin/groups", `{"name":"甲组"}`, adminCookie)
	doRequest(t, s, http.MethodPost, "/api/admin/groups", `{"name":"乙组"}`, adminCookie)
	doRequest(t, s, http.MethodPost, "/api/admin/groups/1/albums", `{"album_ids":[1]}`, adminCookie)
	doRequest(t, s, http.MethodPost, "/api/admin/groups/2/albums", `{"album_ids":[2]}`, adminCookie)

	rr := doRequest(t, s, http.MethodPost, "/api/admin/grants", `{"group_id":1}`, adminCookie)
	var g1 struct {
		NumericCode string `json:"numeric_code"`
	}
	json.Unmarshal(rr.Body.Bytes(), &g1)
	rr = doRequest(t, s, http.MethodPost, "/api/admin/grants", `{"group_id":2}`, adminCookie)
	var g2 struct {
		NumericCode string `json:"numeric_code"`
	}
	json.Unmarshal(rr.Body.Bytes(), &g2)

	// 先解锁甲组，再在"同一会话"解锁乙组（带 cookie）
	rr = unlockByCode(t, s, g1.NumericCode, "")
	cookie := cookieFrom(t, rr)
	rr = unlockByCode(t, s, g2.NumericCode, cookie)
	if rr.Code != http.StatusOK {
		t.Fatalf("二次解锁应 200: %s", rr.Body.String())
	}

	rr = doRequest(t, s, http.MethodGet, "/api/session", "", cookie)
	if !strings.Contains(rr.Body.String(), "甲组") || !strings.Contains(rr.Body.String(), "乙组") {
		t.Fatalf("会话应含两个分组: %s", rr.Body.String())
	}

	// 分组切换：甲组只见相册A，乙组只见相册B
	rr = doRequest(t, s, http.MethodGet, "/api/albums?group_id=1", "", cookie)
	if !strings.Contains(rr.Body.String(), "相册A") || strings.Contains(rr.Body.String(), "相册B") {
		t.Fatalf("甲组应只见相册A: %s", rr.Body.String())
	}
	rr = doRequest(t, s, http.MethodGet, "/api/albums?group_id=2", "", cookie)
	if !strings.Contains(rr.Body.String(), "相册B") || strings.Contains(rr.Body.String(), "相册A") {
		t.Fatalf("乙组应只见相册B: %s", rr.Body.String())
	}
	rr = doRequest(t, s, http.MethodGet, "/api/albums?group_id=999", "", cookie)
	if !strings.Contains(rr.Body.String(), `"albums":[]`) {
		t.Fatalf("未解锁分组应为空: %s", rr.Body.String())
	}
}

func TestGrantDisableTakesEffectImmediately(t *testing.T) {
	s, db := newTestServer(t)
	adminCookie, code, _ := seedAccess(t, s, db, "G")

	rr := unlockByCode(t, s, code, "")
	cookie := cookieFrom(t, rr)

	rr = doRequest(t, s, http.MethodGet, "/api/albums?group_id=1", "", cookie)
	if !strings.Contains(rr.Body.String(), "相册一") {
		t.Fatalf("解锁后应可见相册: %s", rr.Body.String())
	}

	// 禁用授权 → 已有会话下次请求该分组立即消失（开发文档 §6.3）
	doRequest(t, s, http.MethodPatch, "/api/admin/grants/1", `{"enabled":false}`, adminCookie)
	rr = doRequest(t, s, http.MethodGet, "/api/session", "", cookie)
	if strings.Contains(rr.Body.String(), "G") {
		t.Fatalf("禁用后分组应立即消失: %s", rr.Body.String())
	}
}

func TestPhotoAndImageAccess(t *testing.T) {
	s, db := newTestServer(t)
	adminCookie, code, _ := seedAccess(t, s, db, "G")

	rr := uploadPhoto(t, s, adminCookie, 1, testJPEG(t, 800, 400))
	if !strings.Contains(rr.Body.String(), `"added"`) {
		t.Fatalf("上传失败: %s", rr.Body.String())
	}
	photos, err := store.ListAllPhotos(db)
	if err != nil || len(photos) != 1 {
		t.Fatalf("照片入库失败: %v", err)
	}
	if err := store.AddPhotosToAlbum(db, 1, []int64{photos[0].ID}); err != nil {
		t.Fatal(err)
	}
	sha := photos[0].SHA256

	// 未解锁 → 照片/相册/图片一律 404
	if rr := doRequest(t, s, http.MethodGet, "/api/photos/1", "", ""); rr.Code != http.StatusNotFound {
		t.Fatalf("未登录访问照片应 404, got %d", rr.Code)
	}
	if rr := doRequest(t, s, http.MethodGet, "/img/thumb256/"+sha, "", ""); rr.Code != http.StatusNotFound {
		t.Fatalf("未登录访问图片应 404, got %d", rr.Code)
	}

	// 解锁后 → 可见
	rr = unlockByCode(t, s, code, "")
	cookie := cookieFrom(t, rr)
	if rr := doRequest(t, s, http.MethodGet, "/api/photos/1", "", cookie); rr.Code != http.StatusOK {
		t.Fatalf("解锁后访问照片应 200, got %d", rr.Code)
	}
	if rr := doRequest(t, s, http.MethodGet, "/api/albums/1", "", cookie); rr.Code != http.StatusOK {
		t.Fatalf("解锁后访问相册应 200, got %d", rr.Code)
	}

	// 图片：cookie 会话 → 200 JPEG
	rr = doRequest(t, s, http.MethodGet, "/img/thumb256/"+sha, "", cookie)
	if rr.Code != http.StatusOK {
		t.Fatalf("解锁后访问缩略图应 200, got %d", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "image/jpeg" {
		t.Fatalf("Content-Type 应为 image/jpeg, got %q", ct)
	}
	if body := rr.Body.Bytes(); len(body) < 2 || body[0] != 0xff || body[1] != 0xd8 {
		t.Fatal("图片内容应为 JPEG")
	}

	// 签名 URL（无 cookie）：从会话 cookie 取 sid，签一个 5 分钟 URL
	sid := strings.TrimPrefix(cookie, visitorCookieName+"=")
	exp := time.Now().Unix() + 300
	sig := auth.SignImageURL(s.secret, sid, "thumb256", sha, exp)
	url := fmt.Sprintf("/img/thumb256/%s?sid=%s&exp=%d&sig=%s", sha, sid, exp, sig)
	req := httptest.NewRequest(http.MethodGet, url, nil)
	rr2 := httptest.NewRecorder()
	s.Router().ServeHTTP(rr2, req)
	if rr2.Code != http.StatusOK {
		t.Fatalf("签名 URL 应 200, got %d", rr2.Code)
	}

	// 篡改签名 → 404
	url = fmt.Sprintf("/img/thumb256/%s?sid=%s&exp=%d&sig=%s", sha, sid, exp, "forged")
	req = httptest.NewRequest(http.MethodGet, url, nil)
	rr3 := httptest.NewRecorder()
	s.Router().ServeHTTP(rr3, req)
	if rr3.Code != http.StatusNotFound {
		t.Fatalf("伪造签名应 404, got %d", rr3.Code)
	}
}

func TestAdminGrantManagement(t *testing.T) {
	s, db := newTestServer(t)
	adminCookie, code, token := seedAccess(t, s, db, "G")

	rr := doRequest(t, s, http.MethodGet, "/api/admin/grants", "", adminCookie)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), code) {
		t.Fatalf("授权列表应含新建码: %d %s", rr.Code, rr.Body.String())
	}

	// 重生码：旧码失效
	rr = doRequest(t, s, http.MethodPatch, "/api/admin/grants/1", `{"regenerate_code":true}`, adminCookie)
	if rr.Code != http.StatusOK {
		t.Fatalf("重生码失败: %d", rr.Code)
	}
	var g struct {
		NumericCode string `json:"numeric_code"`
		Token       string `json:"token"`
	}
	json.Unmarshal(rr.Body.Bytes(), &g)
	if g.NumericCode == code {
		t.Fatal("重生后的码不应与旧码相同")
	}
	if rr := unlockByCode(t, s, code, ""); rr.Code != http.StatusUnauthorized {
		t.Fatalf("旧码应失效, got %d", rr.Code)
	}
	if rr := unlockByCode(t, s, g.NumericCode, ""); rr.Code != http.StatusOK {
		t.Fatalf("新码应可用, got %d", rr.Code)
	}

	// 重生 token：旧 token 失效
	rr = doRequest(t, s, http.MethodPatch, "/api/admin/grants/1", `{"regenerate_token":true}`, adminCookie)
	json.Unmarshal(rr.Body.Bytes(), &g)
	if rr := doRequest(t, s, http.MethodPost, "/api/access/token", fmt.Sprintf(`{"token":%q}`, token), ""); rr.Code != http.StatusUnauthorized {
		t.Fatalf("旧 token 应失效, got %d", rr.Code)
	}
	if rr := doRequest(t, s, http.MethodPost, "/api/access/token", fmt.Sprintf(`{"token":%q}`, g.Token), ""); rr.Code != http.StatusOK {
		t.Fatalf("新 token 应可用, got %d", rr.Code)
	}
}

func TestSingleDeviceLogout(t *testing.T) {
	s, db := newTestServer(t)
	adminCookie, code, _ := seedAccess(t, s, db, "G")

	rr := unlockByCode(t, s, code, "")
	cookie := cookieFrom(t, rr)

	// Owner 查看该授权下设备
	rr = doRequest(t, s, http.MethodGet, "/api/admin/grants/1/sessions", "", adminCookie)
	if !strings.Contains(rr.Body.String(), `"sessions":[`) {
		t.Fatalf("应列出会话: %s", rr.Body.String())
	}
	var resp struct {
		Sessions []struct {
			SID string `json:"sid"`
		} `json:"sessions"`
	}
	json.Unmarshal(rr.Body.Bytes(), &resp)
	if len(resp.Sessions) == 0 {
		t.Fatal("应有活跃会话")
	}

	// 单设备下线
	rr = doRequest(t, s, http.MethodDelete, "/api/admin/sessions/"+resp.Sessions[0].SID, "", adminCookie)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("下线应 204, got %d", rr.Code)
	}

	// 被下线的会话失效
	rr = doRequest(t, s, http.MethodGet, "/api/session", "", cookie)
	if strings.Contains(rr.Body.String(), "G") {
		t.Fatalf("下线后会话应失效: %s", rr.Body.String())
	}
}
