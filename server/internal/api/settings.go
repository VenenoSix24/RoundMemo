package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"

	"roundmemo/internal/store"
)

// 站点设置：浏览器标签页标题与图标。site_title 存 settings 表；
// favicon 二进制存 Storage（key=settings/favicon），公共端点无鉴权服务。

const faviconStorageKey = "settings/favicon"
const maxFaviconBytes = 1 << 20

func (s *Server) settingsJSON() map[string]any {
	title, _ := store.GetSetting(s.db, "site_title")
	hasFav, _ := store.GetSetting(s.db, "has_favicon")
	return map[string]any{"site_title": title, "has_favicon": hasFav == "1"}
}

// handleGetPublicSettings 公共设置（无鉴权）：前端据此设标签页标题/图标。
func (s *Server) handleGetPublicSettings(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.settingsJSON())
}

// handleAdminPutSettings 后台保存站点标题。
func (s *Server) handleAdminPutSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SiteTitle string `json:"site_title"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if req.SiteTitle == "" {
		writeError(w, http.StatusBadRequest, "站点标题不能为空")
		return
	}
	if err := store.SetSetting(s.db, "site_title", req.SiteTitle); err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.settingsJSON())
}

// handleAdminUploadFavicon 上传站点图标（单文件 multipart）。
func (s *Server) handleAdminUploadFavicon(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxFaviconBytes)
	reader, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "请求须为 multipart/form-data")
		return
	}
	part, err := reader.NextPart()
	if err != nil {
		writeError(w, http.StatusBadRequest, "缺少图片文件")
		return
	}
	defer part.Close()
	data, err := io.ReadAll(io.LimitReader(part, maxFaviconBytes))
	if err != nil || len(data) == 0 {
		writeError(w, http.StatusBadRequest, "读取图标失败")
		return
	}
	if err := s.storage.Put(context.Background(), faviconStorageKey, bytes.NewReader(data), int64(len(data))); err != nil {
		s.internalError(w, err)
		return
	}
	if err := store.SetSetting(s.db, "has_favicon", "1"); err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.settingsJSON())
}

// handleGetFavicon 公共图标服务。未设置 404。
func (s *Server) handleGetFavicon(w http.ResponseWriter, r *http.Request) {
	rc, err := s.storage.Get(r.Context(), faviconStorageKey)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer rc.Close()
	data, err := io.ReadAll(rc)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", http.DetectContentType(data))
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_, _ = w.Write(data)
}
