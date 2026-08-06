package api

import (
	"database/sql"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"roundmemo/internal/auth"
	"roundmemo/internal/config"
	"roundmemo/internal/store"
)

func newTestServer(t *testing.T) (*Server, *sql.DB) {
	t.Helper()
	dir := t.TempDir()
	db, err := store.Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := store.Migrate(db); err != nil {
		t.Fatal(err)
	}

	cfg := &config.Config{}
	cfg.Server.SecureCookies = false
	cfg.Security.AdminSessionTTLDays = 7
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return NewServer(db, cfg, logger), db
}

func seedOwner(t *testing.T, db *sql.DB, username, password string) {
	t.Helper()
	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpsertOwner(db, username, hash); err != nil {
		t.Fatal(err)
	}
}

func doRequest(t *testing.T, s *Server, method, path, body, cookie string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	rr := httptest.NewRecorder()
	s.Router().ServeHTTP(rr, req)
	return rr
}

func loginOwner(t *testing.T, s *Server, username, password string) string {
	t.Helper()
	body := fmt.Sprintf(`{"username":%q,"password":%q}`, username, password)
	rr := doRequest(t, s, http.MethodPost, "/api/admin/login", body, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("登录失败: %d %s", rr.Code, rr.Body.String())
	}
	for _, c := range rr.Result().Cookies() {
		if c.Name == adminCookieName {
			return adminCookieName + "=" + c.Value
		}
	}
	t.Fatal("登录响应未携带 rm_admin cookie")
	return ""
}

func TestAdminAuthRequired(t *testing.T) {
	s, _ := newTestServer(t)
	if rr := doRequest(t, s, http.MethodGet, "/api/admin/albums", "", ""); rr.Code != http.StatusUnauthorized {
		t.Fatalf("未登录访问应 401, got %d", rr.Code)
	}
}

func TestAdminLoginWrongPassword(t *testing.T) {
	s, db := newTestServer(t)
	seedOwner(t, db, "admin", "correct-password")
	rr := doRequest(t, s, http.MethodPost, "/api/admin/login",
		`{"username":"admin","password":"wrong-password"}`, "")
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("错误密码应 401, got %d", rr.Code)
	}
}

func TestAdminLoginUnknownUser(t *testing.T) {
	s, _ := newTestServer(t)
	rr := doRequest(t, s, http.MethodPost, "/api/admin/login",
		`{"username":"nobody","password":"whatever-pass"}`, "")
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("未知用户应 401（与密码错误同响应，防枚举）, got %d", rr.Code)
	}
}

func TestAdminBearerAuth(t *testing.T) {
	s, db := newTestServer(t)
	seedOwner(t, db, "admin", "correct-password")

	body := `{"username":"admin","password":"correct-password"}`
	rr := doRequest(t, s, http.MethodPost, "/api/admin/login", body, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("登录失败: %d", rr.Code)
	}
	var sid string
	for _, c := range rr.Result().Cookies() {
		if c.Name == adminCookieName {
			sid = c.Value
		}
	}
	// 不携带 cookie，仅用 Bearer
	req := httptest.NewRequest(http.MethodGet, "/api/admin/albums", nil)
	req.Header.Set("Authorization", "Bearer "+sid)
	rr2 := httptest.NewRecorder()
	s.Router().ServeHTTP(rr2, req)
	if rr2.Code != http.StatusOK {
		t.Fatalf("Bearer 鉴权应通过, got %d", rr2.Code)
	}
}

func TestAlbumLifecycle(t *testing.T) {
	s, db := newTestServer(t)
	seedOwner(t, db, "admin", "correct-password")
	cookie := loginOwner(t, s, "admin", "correct-password")

	rr := doRequest(t, s, http.MethodPost, "/api/admin/albums",
		`{"title":"毕业旅行","description":"云南七天"}`, cookie)
	if rr.Code != http.StatusCreated {
		t.Fatalf("创建相册应 201, got %d: %s", rr.Code, rr.Body.String())
	}

	rr = doRequest(t, s, http.MethodGet, "/api/admin/albums", "", cookie)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "毕业旅行") {
		t.Fatalf("列表应含新相册, got %d: %s", rr.Code, rr.Body.String())
	}

	rr = doRequest(t, s, http.MethodPatch, "/api/admin/albums/1",
		`{"title":"毕业旅行·改"}`, cookie)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "毕业旅行·改") {
		t.Fatalf("更新相册应 200 且返回新标题, got %d: %s", rr.Code, rr.Body.String())
	}

	rr = doRequest(t, s, http.MethodDelete, "/api/admin/albums/1", "", cookie)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("删除相册应 204, got %d", rr.Code)
	}
}

func TestGroupAndBinding(t *testing.T) {
	s, db := newTestServer(t)
	seedOwner(t, db, "admin", "correct-password")
	cookie := loginOwner(t, s, "admin", "correct-password")

	doRequest(t, s, http.MethodPost, "/api/admin/albums", `{"title":"相册A"}`, cookie)
	doRequest(t, s, http.MethodPost, "/api/admin/albums", `{"title":"相册B"}`, cookie)

	rr := doRequest(t, s, http.MethodPost, "/api/admin/groups", `{"name":"全体同学"}`, cookie)
	if rr.Code != http.StatusCreated {
		t.Fatalf("创建分组应 201, got %d: %s", rr.Code, rr.Body.String())
	}

	rr = doRequest(t, s, http.MethodPost, "/api/admin/groups/1/albums", `{"album_ids":[1,2]}`, cookie)
	if rr.Code != http.StatusOK {
		t.Fatalf("绑定相册应 200, got %d: %s", rr.Code, rr.Body.String())
	}

	rr = doRequest(t, s, http.MethodGet, "/api/admin/groups", "", cookie)
	if !strings.Contains(rr.Body.String(), `"album_ids":[1,2]`) {
		t.Fatalf("分组应含绑定相册: %s", rr.Body.String())
	}

	rr = doRequest(t, s, http.MethodDelete, "/api/admin/groups/1/albums/1", "", cookie)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("解绑应 204, got %d", rr.Code)
	}

	// 无效路径参数
	rr = doRequest(t, s, http.MethodDelete, "/api/admin/groups/1/albums/999", "", cookie)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("解绑不存在绑定应 404, got %d", rr.Code)
	}
}

func TestAlbumValidation(t *testing.T) {
	s, db := newTestServer(t)
	seedOwner(t, db, "admin", "correct-password")
	cookie := loginOwner(t, s, "admin", "correct-password")

	if rr := doRequest(t, s, http.MethodPost, "/api/admin/albums", `{"title":""}`, cookie); rr.Code != http.StatusBadRequest {
		t.Fatalf("空标题应 400, got %d", rr.Code)
	}
	if rr := doRequest(t, s, http.MethodPatch, "/api/admin/albums/999", `{"title":"x"}`, cookie); rr.Code != http.StatusNotFound {
		t.Fatalf("更新不存在相册应 404, got %d", rr.Code)
	}
}
