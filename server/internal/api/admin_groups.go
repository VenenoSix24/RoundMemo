package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"roundmemo/internal/store"
)

type groupJSON struct {
	ID        int64   `json:"id"`
	Name      string  `json:"name"`
	AlbumIDs  []int64 `json:"album_ids"`
	CreatedAt int64   `json:"created_at"`
}

func (s *Server) toGroupJSON(g *store.Group) (groupJSON, error) {
	albumIDs, err := store.AlbumIDsForGroup(s.db, g.ID)
	if err != nil {
		return groupJSON{}, err
	}
	return groupJSON{ID: g.ID, Name: g.Name, AlbumIDs: albumIDs, CreatedAt: g.CreatedAt}, nil
}

func (s *Server) handleListGroups(w http.ResponseWriter, _ *http.Request) {
	groups, err := store.ListGroups(s.db)
	if err != nil {
		s.internalError(w, err)
		return
	}
	out := make([]groupJSON, 0, len(groups))
	for i := range groups {
		gj, err := s.toGroupJSON(&groups[i])
		if err != nil {
			s.internalError(w, err)
			return
		}
		out = append(out, gj)
	}
	writeJSON(w, http.StatusOK, map[string]any{"groups": out})
}

func (s *Server) handleCreateGroup(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "分组名称不能为空")
		return
	}

	id, err := store.CreateGroup(s.db, req.Name)
	if err != nil {
		s.internalError(w, err)
		return
	}
	group, err := store.GetGroup(s.db, id)
	if err != nil {
		s.internalError(w, err)
		return
	}
	gj, err := s.toGroupJSON(group)
	if err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, gj)
}

func (s *Server) handleUpdateGroup(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的分组 id")
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "分组名称不能为空")
		return
	}

	if err := store.UpdateGroupName(s.db, id, req.Name); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "分组不存在")
			return
		}
		s.internalError(w, err)
		return
	}
	group, err := store.GetGroup(s.db, id)
	if err != nil {
		s.internalError(w, err)
		return
	}
	gj, err := s.toGroupJSON(group)
	if err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, gj)
}

func (s *Server) handleDeleteGroup(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的分组 id")
		return
	}
	if err := store.DeleteGroup(s.db, id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "分组不存在")
			return
		}
		s.internalError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleBindAlbums(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的分组 id")
		return
	}
	if _, err := store.GetGroup(s.db, id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "分组不存在")
			return
		}
		s.internalError(w, err)
		return
	}

	var req struct {
		AlbumIDs []int64 `json:"album_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if len(req.AlbumIDs) == 0 {
		writeError(w, http.StatusBadRequest, "album_ids 不能为空")
		return
	}

	if err := store.BindAlbums(s.db, id, req.AlbumIDs); err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"bound": len(req.AlbumIDs)})
}

func (s *Server) handleUnbindAlbum(w http.ResponseWriter, r *http.Request) {
	groupID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的分组 id")
		return
	}
	albumID, err := strconv.ParseInt(chi.URLParam(r, "albumId"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的相册 id")
		return
	}
	if err := store.UnbindAlbum(s.db, groupID, albumID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "绑定关系不存在")
			return
		}
		s.internalError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
