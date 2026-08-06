package api

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func TestAdminAlbumPhotosAndCover(t *testing.T) {
	s, db := newTestServer(t)
	seedOwner(t, db, "admin", "correct-password")
	cookie := loginOwner(t, s, "admin", "correct-password")

	if rr := doRequest(t, s, http.MethodPost, "/api/admin/albums", `{"title":"旅行"}`, cookie); rr.Code != http.StatusCreated {
		t.Fatalf("建相册失败: %d", rr.Code)
	}
	img := testJPEG(t, 800, 400)
	uploadPhoto(t, s, cookie, 1, img)

	// 相册照片列表应含 filename
	rr := doRequest(t, s, http.MethodGet, "/api/admin/albums/1/photos", "", cookie)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"filename":"test.jpg"`) {
		t.Fatalf("照片列表应含 filename, got %d: %s", rr.Code, rr.Body.String())
	}

	// 手动设封面
	rr = doRequest(t, s, http.MethodPost, "/api/admin/albums/1/cover", `{"photo_id":1}`, cookie)
	if rr.Code != http.StatusOK {
		t.Fatalf("设封面失败: %d", rr.Code)
	}

	// 相册列表应返回 cover_sha
	rr = doRequest(t, s, http.MethodGet, "/api/admin/albums", "", cookie)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"cover_sha":`) {
		t.Fatalf("相册列表应含 cover_sha, got %d: %s", rr.Code, rr.Body.String())
	}

	// 跨相册设封面应被拒
	if rr := doRequest(t, s, http.MethodPost, "/api/admin/albums/999/cover", `{"photo_id":1}`, cookie); rr.Code != http.StatusNotFound {
		t.Fatalf("不存在的相册设封面应 404, got %d", rr.Code)
	}
}

func TestAdminAccountChange(t *testing.T) {
	s, db := newTestServer(t)
	seedOwner(t, db, "admin", "old-password-1")
	cookie := loginOwner(t, s, "admin", "old-password-1")

	// 当前密码错误 → 401
	if rr := doRequest(t, s, http.MethodPost, "/api/admin/account", `{"current_password":"wrong","password":"new-password-2"}`, cookie); rr.Code != http.StatusUnauthorized {
		t.Fatalf("错误当前密码应 401, got %d", rr.Code)
	}

	// 空补丁 → 400
	if rr := doRequest(t, s, http.MethodPost, "/api/admin/account", `{"current_password":"old-password-1"}`, cookie); rr.Code != http.StatusBadRequest {
		t.Fatalf("空补丁应 400, got %d", rr.Code)
	}

	// 改密 + 改用户名
	if rr := doRequest(t, s, http.MethodPost, "/api/admin/account", `{"current_password":"old-password-1","username":"owner2","password":"new-password-2"}`, cookie); rr.Code != http.StatusOK {
		t.Fatalf("改账号应 200, got %d: %s", rr.Code, rr.Body.String())
	}

	// 旧密码失效
	if rr := doRequest(t, s, http.MethodPost, "/api/admin/login", `{"username":"admin","password":"old-password-1"}`, ""); rr.Code != http.StatusUnauthorized {
		t.Fatalf("旧密码应失效, got %d", rr.Code)
	}

	// 新用户名 + 新密码可登录
	if rr := doRequest(t, s, http.MethodPost, "/api/admin/login", fmt.Sprintf(`{"username":"owner2","password":"new-password-2"}`), ""); rr.Code != http.StatusOK {
		t.Fatalf("新凭据应可登录, got %d: %s", rr.Code, rr.Body.String())
	}
}
