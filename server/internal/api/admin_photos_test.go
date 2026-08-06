package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
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

func uploadPhoto(t *testing.T, s *Server, cookie string, albumID int, img []byte) *httptest.ResponseRecorder {
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

	req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/admin/albums/%d/photos", albumID), &buf)
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

	photos, err := store.ListPhotosByAlbum(db, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(photos) != 1 {
		t.Fatalf("去重后应只有 1 张照片, got %d", len(photos))
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

func TestPhotoUploadUnknownAlbum(t *testing.T) {
	s, db := newTestServer(t)
	seedOwner(t, db, "admin", "correct-password")
	cookie := loginOwner(t, s, "admin", "correct-password")

	rr := uploadPhoto(t, s, cookie, 999, testJPEG(t, 100, 100))
	if rr.Code != http.StatusNotFound {
		t.Fatalf("上传到不存在相册应 404, got %d", rr.Code)
	}
}

func sha256Of(data []byte) []byte {
	h := sha256.New()
	h.Write(data)
	return h.Sum(nil)
}
