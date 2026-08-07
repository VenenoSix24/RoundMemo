package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"roundmemo/internal/store"
)

// 站点设置：浏览器标签页标题与图标。site_title 存 settings 表；
// favicon 二进制存 Storage（key=settings/favicon），公共端点无鉴权服务。

const faviconStorageKey = "settings/favicon"
const maxFaviconBytes = 1 << 20

// mapTileConfig 地图瓦片源。url 为 XYZ 瓦片模板（支持 {x}{y}{z} 与可选 {s} 子域）。
// crs 是照片 GPS 所属坐标系：wgs84（EXIF 标准、绝大多数相机，默认）或 gcj02（少数国内手机照片）。
// 前端据 url 识别瓦片坐标系（高德=gcj02/OSM=wgs84），照片与瓦片坐标系不一致时才转换。
type mapTileConfig struct {
	URL        string `json:"url"`
	Subdomains string `json:"subdomains"` // 逗号分隔；空表示单子域
	CRS        string `json:"crs"`        // 照片 GPS 坐标系：wgs84 | gcj02
}

// defaultMapTile 默认高德简洁路网图（style=8，比标准街道图更素净）：国内可访问、无需 key。
// 照片 EXIF GPS 标准为 WGS-84，叠高德（GCJ-02 瓦片）时前端自动换算。
var defaultMapTile = mapTileConfig{
	URL:        "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
	Subdomains: "1,2,3,4",
	CRS:        "wgs84",
}

func validateMapTile(mt *mapTileConfig) error {
	if mt.URL == "" {
		return errors.New("瓦片地址不能为空")
	}
	if len(mt.URL) > 500 {
		return errors.New("瓦片地址过长")
	}
	if mt.CRS != "wgs84" && mt.CRS != "gcj02" {
		return errors.New("坐标系须为 wgs84 或 gcj02")
	}
	return nil
}

func (s *Server) settingsJSON() map[string]any {
	title, _ := store.GetSetting(s.db, "site_title")
	hasFav, _ := store.GetSetting(s.db, "has_favicon")
	mt := defaultMapTile
	if raw, err := store.GetSetting(s.db, "map_tile"); err == nil && raw != "" {
		var cfg mapTileConfig
		if err := json.Unmarshal([]byte(raw), &cfg); err == nil && validateMapTile(&cfg) == nil {
			mt = cfg
		}
	}
	return map[string]any{"site_title": title, "has_favicon": hasFav == "1", "map_tile": mt}
}

// handleGetPublicSettings 公共设置（无鉴权）：前端据此设标签页标题/图标/地图源。
func (s *Server) handleGetPublicSettings(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.settingsJSON())
}

// handleAdminPutSettings 后台保存站点标题与地图瓦片源（两者可单独或同时更新）。
func (s *Server) handleAdminPutSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SiteTitle string         `json:"site_title"`
		MapTile   *mapTileConfig `json:"map_tile"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if req.SiteTitle == "" && req.MapTile == nil {
		writeError(w, http.StatusBadRequest, "没有要保存的内容")
		return
	}
	if req.SiteTitle != "" {
		if err := store.SetSetting(s.db, "site_title", req.SiteTitle); err != nil {
			s.internalError(w, err)
			return
		}
	}
	if req.MapTile != nil {
		if err := validateMapTile(req.MapTile); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		raw, _ := json.Marshal(req.MapTile)
		if err := store.SetSetting(s.db, "map_tile", string(raw)); err != nil {
			s.internalError(w, err)
			return
		}
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
