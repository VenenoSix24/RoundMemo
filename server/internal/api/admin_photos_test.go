package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"image/color"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/disintegration/imaging"

	"roundmemo/internal/store"
)

func testJPEG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := imaging.New(w, h, color.RGBA{R: 204, G: 178, B: 127, A: 255})
	var buf bytes.Buffer
	if err := imaging.Encode(&buf, img, imaging.JPEG); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func uploadPhoto(t *testing.T, s *Server, cookie string, _ int, img []byte) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("files", "test.jpg")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write(img); err != nil {
		t.Fatal(err)
	}
	mw.Close()

	// 照片池模型：上传一律进池，albumID 参数保留仅兼容旧调用
	req := httptest.NewRequest(http.MethodPost, "/api/admin/photos", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Cookie", cookie)
	rr := httptest.NewRecorder()
	s.Router().ServeHTTP(rr, req)
	return rr
}

func TestPhotoUploadDedup(t *testing.T) {
	s, db, mediaRoot := newTestServerWithRoot(t)
	seedOwner(t, db, "admin", "correct-password")
	cookie := loginOwner(t, s, "admin", "correct-password")

	if rr := doRequest(t, s, http.MethodPost, "/api/admin/albums", `{"title":"旅行"}`, cookie); rr.Code != http.StatusCreated {
		t.Fatalf("建相册失败: %d", rr.Code)
	}

	img := testJPEG(t, 800, 400)

	rr := uploadPhoto(t, s, cookie, 1, img)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"added"`) {
		t.Fatalf("首次上传应 added, got %d: %s", rr.Code, rr.Body.String())
	}

	rr = uploadPhoto(t, s, cookie, 1, img)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"duplicate"`) {
		t.Fatalf("重复上传应 duplicate, got %d: %s", rr.Code, rr.Body.String())
	}

	photos, err := store.ListAllPhotos(db)
	if err != nil {
		t.Fatal(err)
	}
	if len(photos) != 1 {
		t.Fatalf("去重后照片池应只有 1 张照片, got %d", len(photos))
	}
	if err := store.AddPhotosToAlbum(db, 1, []int64{photos[0].ID}); err != nil {
		t.Fatal(err)
	}
	albumPhotos, err := store.ListAlbumPhotos(db, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(albumPhotos) != 1 {
		t.Fatalf("相册挂接后应 1 张, got %d", len(albumPhotos))
	}

	// 验证存储布局：原图 + 两档缩略图均落盘（开发文档 §8.1 路径约定）
	sum := hex.EncodeToString(sha256Of(img))
	prefix := sum[:2]
	for _, rel := range []string{
		"photos/" + prefix + "/" + sum,
		"thumbs/" + sum + "_1024.jpg",
		"thumbs/" + sum + "_256.jpg",
	} {
		if _, err := os.Stat(filepath.Join(mediaRoot, filepath.FromSlash(rel))); err != nil {
			t.Fatalf("存储文件缺失 %s: %v", rel, err)
		}
	}

	// 元数据应已写入（宽度/高度）
	p := photos[0]
	if p.Width == nil || *p.Width != 800 || p.Height == nil || *p.Height != 400 {
		t.Fatalf("尺寸元数据不符: %+v", p)
	}
}

func TestPhotoUploadBadImage(t *testing.T) {
	s, db := newTestServer(t)
	seedOwner(t, db, "admin", "correct-password")
	cookie := loginOwner(t, s, "admin", "correct-password")
	doRequest(t, s, http.MethodPost, "/api/admin/albums", `{"title":"旅行"}`, cookie)

	rr := uploadPhoto(t, s, cookie, 1, []byte("not an image"))
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"error"`) {
		t.Fatalf("坏图应返回 error, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestPhotoUploadToPool(t *testing.T) {
	s, db := newTestServer(t)
	seedOwner(t, db, "admin", "correct-password")
	cookie := loginOwner(t, s, "admin", "correct-password")

	// 照片池模型：上传不依赖任何相册，直接进池
	rr := uploadPhoto(t, s, cookie, 0, testJPEG(t, 100, 100))
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"added"`) {
		t.Fatalf("上传进池应 200 added, got %d: %s", rr.Code, rr.Body.String())
	}
	photos, err := store.ListAllPhotos(db)
	if err != nil || len(photos) != 1 {
		t.Fatalf("照片池应 1 张, got %d err=%v", len(photos), err)
	}
}

func TestPhotoMetadataEdit(t *testing.T) {
	s, db := newTestServer(t)
	seedOwner(t, db, "admin", "correct-password")
	cookie := loginOwner(t, s, "admin", "correct-password")
	doRequest(t, s, http.MethodPost, "/api/admin/albums", `{"title":"旅行"}`, cookie)
	rr := uploadPhoto(t, s, cookie, 1, testJPEG(t, 800, 400))
	if !strings.Contains(rr.Body.String(), `"added"`) {
		t.Fatalf("上传失败: %s", rr.Body.String())
	}

	// 设置标题 + GPS
	rr = doRequest(t, s, http.MethodPatch, "/api/admin/photos/1",
		`{"title":"毕业旅行","gps_lat":39.9,"gps_lng":116.4}`, cookie)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"title":"毕业旅行"`) ||
		!strings.Contains(rr.Body.String(), `"gps_lat":39.9`) {
		t.Fatalf("设置元数据失败, got %d: %s", rr.Code, rr.Body.String())
	}

	// 设置拍摄时间
	rr = doRequest(t, s, http.MethodPatch, "/api/admin/photos/1", `{"shot_at":1754476798}`, cookie)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"shot_at":1754476798`) {
		t.Fatalf("设置拍摄时间失败, got %d: %s", rr.Code, rr.Body.String())
	}

	// GPS 必须成对：只给 lat 应 400
	rr = doRequest(t, s, http.MethodPatch, "/api/admin/photos/1", `{"gps_lat":10}`, cookie)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("只给 gps_lat 应 400, got %d", rr.Code)
	}

	// 清空 GPS
	rr = doRequest(t, s, http.MethodPatch, "/api/admin/photos/1", `{"gps_lat":null,"gps_lng":null}`, cookie)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"gps_lat":null`) {
		t.Fatalf("清空 GPS 失败, got %d: %s", rr.Code, rr.Body.String())
	}

	// 不存在照片应 404
	rr = doRequest(t, s, http.MethodPatch, "/api/admin/photos/999", `{"title":"x"}`, cookie)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("编辑不存在照片应 404, got %d", rr.Code)
	}

	// 空补丁幂等成功
	rr = doRequest(t, s, http.MethodPatch, "/api/admin/photos/1", `{}`, cookie)
	if rr.Code != http.StatusOK {
		t.Fatalf("空补丁应 200, got %d", rr.Code)
	}
}

func sha256Of(data []byte) []byte {
	h := sha256.New()
	h.Write(data)
	return h.Sum(nil)
}
