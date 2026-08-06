package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"roundmemo/internal/media"
	"roundmemo/internal/storage"
	"roundmemo/internal/store"
)

// handleListAllPhotos 后台「照片」tab：照片池全量列表（含所属相册，供按相册筛）。
func (s *Server) handleListAllPhotos(w http.ResponseWriter, _ *http.Request) {
	photos, err := store.ListAllPhotos(s.db)
	if err != nil {
		s.internalError(w, err)
		return
	}
	idsMap, err := s.albumIDsMap(photos)
	if err != nil {
		s.internalError(w, err)
		return
	}
	out := make([]photoJSON, 0, len(photos))
	for i := range photos {
		out = append(out, toPhotoJSON(&photos[i], idsMap[photos[i].ID]))
	}
	writeJSON(w, http.StatusOK, map[string]any{"photos": out})
}

// handleDeletePhoto 删除照片：清相册封面引用 + 删存储文件 + 删行。
func (s *Server) handleDeletePhoto(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的照片 id")
		return
	}
	photo, err := store.DeletePhoto(s.db, id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "照片不存在")
			return
		}
		s.internalError(w, err)
		return
	}
	// 清理存储文件（尽力而为，漏删最多留孤儿文件，不影响数据一致性）
	ctx := context.Background()
	_ = s.storage.Delete(ctx, photo.StorageKey)
	_ = s.storage.Delete(ctx, storage.ThumbKey(photo.SHA256, media.ThumbPreview))
	_ = s.storage.Delete(ctx, storage.ThumbKey(photo.SHA256, media.ThumbList))
	w.WriteHeader(http.StatusNoContent)
}
