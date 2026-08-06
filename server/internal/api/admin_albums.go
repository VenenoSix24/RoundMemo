package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"roundmemo/internal/store"
)

type albumJSON struct {
	ID           int64   `json:"id"`
	Title        string  `json:"title"`
	Description  *string `json:"description"`
	CoverPhotoID *int64  `json:"cover_photo_id"`
	CoverSHA     string  `json:"cover_sha"`
	SortKey      string  `json:"sort_key"`
	CreatedAt    int64   `json:"created_at"`
	UpdatedAt    int64   `json:"updated_at"`
}

func toAlbumJSON(a *store.Album) albumJSON {
	return albumJSON{
		ID:           a.ID,
		Title:        a.Title,
		Description:  a.Description,
		CoverPhotoID: a.CoverPhotoID,
		SortKey:      a.SortKey,
		CreatedAt:    a.CreatedAt,
		UpdatedAt:    a.UpdatedAt,
	}
}

func (s *Server) handleListAlbums(w http.ResponseWriter, _ *http.Request) {
	albums, err := store.ListAlbums(s.db)
	if err != nil {
		s.internalError(w, err)
		return
	}
	out := make([]albumJSON, 0, len(albums))
	for i := range albums {
		out = append(out, toAlbumJSON(&albums[i]))
	}
	writeJSON(w, http.StatusOK, map[string]any{"albums": out})
}

func (s *Server) handleCreateAlbum(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title       string  `json:"title"`
		Description *string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if req.Title == "" {
		writeError(w, http.StatusBadRequest, "相册标题不能为空")
		return
	}

	id, err := store.CreateAlbum(s.db, req.Title, req.Description)
	if err != nil {
		s.internalError(w, err)
		return
	}
	album, err := store.GetAlbum(s.db, id)
	if err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, toAlbumJSON(album))
}

func (s *Server) handleUpdateAlbum(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的相册 id")
		return
	}

	var req struct {
		Title       *string `json:"title"`
		Description *string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if req.Title != nil && *req.Title == "" {
		writeError(w, http.StatusBadRequest, "相册标题不能为空")
		return
	}

	if err := store.UpdateAlbum(s.db, id, req.Title, req.Description); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "相册不存在")
			return
		}
		s.internalError(w, err)
		return
	}
	album, err := store.GetAlbum(s.db, id)
	if err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toAlbumJSON(album))
}

func (s *Server) handleDeleteAlbum(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的相册 id")
		return
	}
	if err := store.DeleteAlbum(s.db, id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "相册不存在")
			return
		}
		s.internalError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
