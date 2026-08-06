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
	// 上传进池后需挂接到相册
	if rr := doRequest(t, s, http.MethodPost, "/api/admin/albums/1/photos", `{"photo_ids":[1]}`, cookie); rr.Code != http.StatusOK {
		t.Fatalf("挂接失败: %d", rr.Code)
	}

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

func TestAdminSettingsAndPhotoDelete(t *testing.T) {
	s, db := newTestServer(t)
	seedOwner(t, db, "admin", "correct-password")
	cookie := loginOwner(t, s, "admin", "correct-password")

	// 公共 settings 初始为空
	if rr := doRequest(t, s, http.MethodGet, "/api/settings", "", ""); rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"site_title":""`) {
		t.Fatalf("公共 settings 初始应空, got %d: %s", rr.Code, rr.Body.String())
	}

	// 后台设标题
	if rr := doRequest(t, s, http.MethodPut, "/api/admin/settings", `{"site_title":"圆忆相册"}`, cookie); rr.Code != http.StatusOK {
		t.Fatalf("设标题应 200, got %d", rr.Code)
	}
	if rr := doRequest(t, s, http.MethodGet, "/api/settings", "", ""); !strings.Contains(rr.Body.String(), `"site_title":"圆忆相册"`) {
		t.Fatalf("公共 settings 应含标题, got %s", rr.Body.String())
	}
	// 空标题拒绝
	if rr := doRequest(t, s, http.MethodPut, "/api/admin/settings", `{"site_title":""}`, cookie); rr.Code != http.StatusBadRequest {
		t.Fatalf("空标题应 400, got %d", rr.Code)
	}

	// 建相册 + 上传到池
	if rr := doRequest(t, s, http.MethodPost, "/api/admin/albums", `{"title":"旅行"}`, cookie); rr.Code != http.StatusCreated {
		t.Fatalf("建相册失败: %d", rr.Code)
	}
	uploadPhoto(t, s, cookie, 1, testJPEG(t, 800, 400))

	// 从池挂接到相册（照片池 → 相册）
	if rr := doRequest(t, s, http.MethodPost, "/api/admin/albums/1/photos", `{"photo_ids":[1]}`, cookie); rr.Code != http.StatusOK {
		t.Fatalf("挂接失败: %d", rr.Code)
	}
	// 全量照片列表应含所属相册
	if rr := doRequest(t, s, http.MethodGet, "/api/admin/photos", "", cookie); rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"album_ids":[1]`) {
		t.Fatalf("全量照片列表应含 album_ids, got %d: %s", rr.Code, rr.Body.String())
	}

	// 删除照片 → 封面引用清空
	if rr := doRequest(t, s, http.MethodDelete, "/api/admin/photos/1", "", cookie); rr.Code != http.StatusNoContent {
		t.Fatalf("删除照片应 204, got %d", rr.Code)
	}
	if rr := doRequest(t, s, http.MethodGet, "/api/admin/photos", "", cookie); strings.Contains(rr.Body.String(), `"id":1`) {
		t.Fatalf("删除后照片应消失, got %s", rr.Body.String())
	}
}
