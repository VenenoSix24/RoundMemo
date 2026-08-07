package api

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"roundmemo/internal/store"
)

// 备份恢复 round-trip：创建 db 备份 → 列表 → 下载 → 删除；再验证 full 备份含媒体文件。
func TestBackupLifecycle(t *testing.T) {
	s, db, _ := newTestServerWithRoot(t)
	seedOwner(t, db, "admin", "correct-password")
	cookie := loginOwner(t, s, "admin", "correct-password")

	// 准备一点数据：一个相册 + 一张照片
	doRequest(t, s, http.MethodPost, "/api/admin/albums", `{"title":"旅行"}`, cookie)
	rr := uploadPhoto(t, s, cookie, 1, testJPEG(t, 800, 400))
	if rr.Code != http.StatusOK {
		t.Fatalf("上传照片失败: %d %s", rr.Code, rr.Body.String())
	}

	// 创建 db 备份
	rr = doRequest(t, s, http.MethodPost, "/api/admin/backups", `{"kind":"db"}`, cookie)
	if rr.Code != http.StatusCreated {
		t.Fatalf("创建 db 备份应 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var created struct {
		Name   string `json:"name"`
		Kind   string `json:"kind"`
		Size   int64  `json:"size"`
		Photos int64  `json:"photos"`
		Albums int64  `json:"albums"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Kind != "db" || created.Photos != 1 || created.Albums != 1 {
		t.Fatalf("备份元数据不符: %+v", created)
	}
	if !strings.HasSuffix(created.Name, backupExt) {
		t.Fatalf("备份文件名应以 .rmbackup 结尾: %s", created.Name)
	}

	// 列表应包含
	rr = doRequest(t, s, http.MethodGet, "/api/admin/backups", "", cookie)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), created.Name) {
		t.Fatalf("列表应含新备份, got %d: %s", rr.Code, rr.Body.String())
	}

	// 下载内容应是一个合法 zip（含 manifest.json + roundmemo.db）
	rr = doRequest(t, s, http.MethodGet, "/api/admin/backups/"+created.Name, "", cookie)
	if rr.Code != http.StatusOK {
		t.Fatalf("下载备份应 200, got %d", rr.Code)
	}
	m, err := readManifestFromBytes(rr.Body.Bytes())
	if err != nil {
		t.Fatalf("下载的备份 manifest 无效: %v", err)
	}
	if m.Kind != "db" || m.App != "roundmemo" {
		t.Fatalf("下载备份 manifest 不符: %+v", m)
	}

	// 完整备份应包含照片原图文件
	rr = doRequest(t, s, http.MethodPost, "/api/admin/backups", `{"kind":"full"}`, cookie)
	if rr.Code != http.StatusCreated {
		t.Fatalf("创建 full 备份应 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var full struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &full); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(s.backupsDir(), full.Name)
	if !zipHasPrefix(t, path, "photos/") {
		t.Fatalf("full 备份应包含 photos/ 目录")
	}

	// 删除备份
	rr = doRequest(t, s, http.MethodDelete, "/api/admin/backups/"+created.Name, "", cookie)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("删除备份应 204, got %d", rr.Code)
	}
	if _, err := os.Stat(filepath.Join(s.backupsDir(), created.Name)); !os.IsNotExist(err) {
		t.Fatal("删除后备份文件应不存在")
	}

	// 非法文件名应 404
	rr = doRequest(t, s, http.MethodGet, "/api/admin/backups/..%2Fetc%2Fpasswd", "", cookie)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("路径穿越文件名应 404, got %d", rr.Code)
	}

	// 未登录应 401
	if rr := doRequest(t, s, http.MethodPost, "/api/admin/backups", `{"kind":"db"}`, ""); rr.Code != http.StatusUnauthorized {
		t.Fatalf("未登录创建备份应 401, got %d", rr.Code)
	}
}

// TestRestoreBackup 验证恢复：备份 → 改数据 → 恢复 → 数据回到备份时状态。
func TestRestoreBackup(t *testing.T) {
	s, db, _ := newTestServerWithRoot(t)
	seedOwner(t, db, "admin", "correct-password")
	cookie := loginOwner(t, s, "admin", "correct-password")

	// 初始数据：相册 A
	doRequest(t, s, http.MethodPost, "/api/admin/albums", `{"title":"相册A"}`, cookie)
	rr := doRequest(t, s, http.MethodPost, "/api/admin/backups", `{"kind":"db"}`, cookie)
	if rr.Code != http.StatusCreated {
		t.Fatalf("备份应 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var backup struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &backup); err != nil {
		t.Fatal(err)
	}

	// 备份后再加一个相册 B
	doRequest(t, s, http.MethodPost, "/api/admin/albums", `{"title":"相册B"}`, cookie)

	// 构造恢复请求（multipart 文件 + confirm=RESET）
	buf, contentType := restoreBody(t, filepath.Join(s.backupsDir(), backup.Name), "RESET")
	req := httptest.NewRequest(http.MethodPost, "/api/admin/backups/restore", buf)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Cookie", cookie)
	rr2 := httptest.NewRecorder()
	s.Router().ServeHTTP(rr2, req)
	if rr2.Code != http.StatusOK {
		t.Fatalf("恢复应 200, got %d: %s", rr2.Code, rr2.Body.String())
	}

	// 恢复后：相册 B 应消失，只剩相册 A
	albums, err := store.ListAlbums(s.db)
	if err != nil {
		t.Fatal(err)
	}
	if len(albums) != 1 || albums[0].Title != "相册A" {
		t.Fatalf("恢复后应只剩相册A, got: %+v", albums)
	}

	// 恢复后再验证 DB 可写（重开连接正常）
	doRequest(t, s, http.MethodPost, "/api/admin/albums", `{"title":"相册C"}`, cookie)
	albums, _ = store.ListAlbums(s.db)
	if len(albums) != 2 {
		t.Fatalf("恢复后可写校验失败: %+v", albums)
	}
}

// TestRestoreRequiresConfirm 未带正确确认词应拒绝且不改变数据。
func TestRestoreRequiresConfirm(t *testing.T) {
	s, db, _ := newTestServerWithRoot(t)
	seedOwner(t, db, "admin", "correct-password")
	cookie := loginOwner(t, s, "admin", "correct-password")

	doRequest(t, s, http.MethodPost, "/api/admin/albums", `{"title":"原始"}`, cookie)
	rr := doRequest(t, s, http.MethodPost, "/api/admin/backups", `{"kind":"db"}`, cookie)
	var backup struct{ Name string }
	if err := json.Unmarshal(rr.Body.Bytes(), &backup); err != nil {
		t.Fatal(err)
	}

	// 恢复后追加一条（用于验证"确认词错误不生效"）
	doRequest(t, s, http.MethodPost, "/api/admin/albums", `{"title":"错误确认后的新增"}`, cookie)

	buf, contentType := restoreBody(t, filepath.Join(s.backupsDir(), backup.Name), "wrongword")
	req := httptest.NewRequest(http.MethodPost, "/api/admin/backups/restore", buf)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Cookie", cookie)
	rr2 := httptest.NewRecorder()
	s.Router().ServeHTTP(rr2, req)
	if rr2.Code != http.StatusBadRequest {
		t.Fatalf("确认词错误应 400, got %d", rr2.Code)
	}

	albums, _ := store.ListAlbums(s.db)
	if len(albums) != 2 {
		t.Fatalf("确认词错误不应改数据, got: %+v", albums)
	}
}

// restoreBody 构造 multipart 恢复请求体：file=备份文件 + confirm=确认词。
func restoreBody(t *testing.T, backupPath, confirm string) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("file", filepath.Base(backupPath))
	if err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(backupPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write(b); err != nil {
		t.Fatal(err)
	}
	if err := mw.WriteField("confirm", confirm); err != nil {
		t.Fatal(err)
	}
	mw.Close()
	return &buf, mw.FormDataContentType()
}

// readManifestFromBytes 从内存 zip 读 manifest（下载接口返回体的校验用）。
func readManifestFromBytes(b []byte) (*backupManifest, error) {
	zr, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		return nil, err
	}
	for _, f := range zr.File {
		if f.Name != "manifest.json" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		defer rc.Close()
		var m backupManifest
		if err := json.NewDecoder(rc).Decode(&m); err != nil {
			return nil, err
		}
		return &m, nil
	}
	return nil, io.ErrUnexpectedEOF
}

func zipHasPrefix(t *testing.T, zipPath, prefix string) bool {
	t.Helper()
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	for _, f := range zr.File {
		if strings.HasPrefix(f.Name, prefix) {
			return true
		}
	}
	return false
}
