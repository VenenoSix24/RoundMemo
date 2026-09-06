package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"roundmemo/internal/store"
)

// optionalField 解析"缺省/置 null/设值"三种语义的 JSON 字段：
// 缺省表示不改，null 表示清空，值表示设置。
type optionalField[T any] struct {
	present bool
	clear   bool
	value   T
}

func (o *optionalField[T]) UnmarshalJSON(data []byte) error {
	o.present = true
	if string(data) == "null" {
		o.clear = true
		return nil
	}
	return json.Unmarshal(data, &o.value)
}

type photoJSON struct {
	ID           int64    `json:"id"`
	AlbumIDs     []int64  `json:"album_ids"`
	SHA256       string   `json:"sha256"`
	Width        *int     `json:"width"`
	Height       *int     `json:"height"`
	ShotAt       *int64   `json:"shot_at"`
	GPSLat       *float64 `json:"gps_lat"`
	GPSLng       *float64 `json:"gps_lng"`
	DeviceMake   string   `json:"device_make"`
	DeviceModel  string   `json:"device_model"`
	Title        *string  `json:"title"`
	Description  *string  `json:"description"`
	LocationName *string  `json:"location_name"`
	Filename     string   `json:"filename"`
}

func toPhotoJSON(p *store.Photo, albumIDs []int64) photoJSON {
	// 未入任何相册的照片 albumIDs 为 nil，须序列化为 [] 而非 null，避免前端读 length 崩溃。
	if albumIDs == nil {
		albumIDs = []int64{}
	}
	return photoJSON{
		ID:           p.ID,
		AlbumIDs:     albumIDs,
		SHA256:       p.SHA256,
		Width:        p.Width,
		Height:       p.Height,
		ShotAt:       p.ShotAt,
		GPSLat:       p.GPSLat,
		GPSLng:       p.GPSLng,
		DeviceMake:   p.DeviceMake,
		DeviceModel:  p.DeviceModel,
		Title:        p.Title,
		Description:  p.Description,
		LocationName: p.LocationName,
		Filename:     p.Filename,
	}
}

// albumIDsMap 批量查询一组照片各自的所属相册，避免 N+1。
func (s *Server) albumIDsMap(photos []store.Photo) (map[int64][]int64, error) {
	out := map[int64][]int64{}
	if len(photos) == 0 {
		return out, nil
	}
	rows, err := s.db.Query(`SELECT photo_id, album_id FROM album_photos`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var pid, aid int64
		if err := rows.Scan(&pid, &aid); err != nil {
			return nil, err
		}
		out[pid] = append(out[pid], aid)
	}
	return out, rows.Err()
}

// handleUpdatePhoto 编辑照片元数据：标题、描述、地点名、拍摄时间、GPS 坐标。
// 字段缺省不改、null 清空、值设置；GPS 两个坐标必须成对给出。
func (s *Server) handleUpdatePhoto(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的照片 id")
		return
	}

	var req struct {
		Title        *string                `json:"title"`
		Description  *string                `json:"description"`
		LocationName optionalField[string]  `json:"location_name"`
		ShotAt       optionalField[int64]   `json:"shot_at"`
		GPSLat       optionalField[float64] `json:"gps_lat"`
		GPSLng       optionalField[float64] `json:"gps_lng"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if req.GPSLat.present != req.GPSLng.present {
		writeError(w, http.StatusBadRequest, "gps_lat 与 gps_lng 必须同时提供或同时清空")
		return
	}

	patch := store.PhotoPatch{Title: req.Title, Description: req.Description}
	if req.LocationName.present {
		if req.LocationName.clear {
			patch.ClearLocationName = true
		} else {
			patch.LocationName = &req.LocationName.value
		}
	}
	if req.ShotAt.present {
		if req.ShotAt.clear {
			patch.ClearShotAt = true
		} else {
			patch.ShotAt = &req.ShotAt.value
		}
	}
	if req.GPSLat.present {
		if req.GPSLat.clear {
			patch.ClearGPSLat, patch.ClearGPSLng = true, true
		} else {
			patch.GPSLat, patch.GPSLng = &req.GPSLat.value, &req.GPSLng.value
		}
	}

	if err := store.UpdatePhoto(s.db, id, patch); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "照片不存在")
			return
		}
		s.internalError(w, err)
		return
	}
	photo, err := store.GetPhoto(s.db, id)
	if err != nil {
		s.internalError(w, err)
		return
	}
	albumIDs, err := store.AlbumIDsForPhoto(s.db, photo.ID)
	if err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toPhotoJSON(photo, albumIDs))
}
