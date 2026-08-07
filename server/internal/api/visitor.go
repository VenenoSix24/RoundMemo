package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"roundmemo/internal/store"
)

// handleVisitorAlbums 返回会话可见相册。?group_id=N 时仅返回该分组。
// 无会话或不覆盖时返回空列表而非 404，避免泄露内容存在性。
func (s *Server) handleVisitorAlbums(w http.ResponseWriter, r *http.Request) {
	sess := s.visitorSession(r)
	albums := []albumJSON{}
	if sess != nil {
		now := time.Now().Unix()
		if gidStr := r.URL.Query().Get("group_id"); gidStr != "" {
			gid, err := strconv.ParseInt(gidStr, 10, 64)
			if err != nil {
				writeError(w, http.StatusBadRequest, "无效的 group_id")
				return
			}
			groups, err := store.SessionGroups(s.db, sess.SID, now)
			if err != nil {
				s.internalError(w, err)
				return
			}
			if !containsGroup(groups, gid) {
				writeJSON(w, http.StatusOK, map[string]any{"albums": albums})
				return
			}
			list, err := store.AlbumsForGroup(s.db, gid)
			if err != nil {
				s.internalError(w, err)
				return
			}
			for i := range list {
				a := toAlbumJSON(&list[i])
				coverSHA, err := store.AlbumCoverSHA(s.db, a.ID)
				if err == nil {
					a.CoverSHA = coverSHA
				}
				albums = append(albums, a)
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"albums": albums})
}

func containsGroup(groups []store.GroupSummary, id int64) bool {
	for _, g := range groups {
		if g.ID == id {
			return true
		}
	}
	return false
}

// handleVisitorAlbum 返回相册及照片列表。会话未覆盖该相册一律 404。
func (s *Server) handleVisitorAlbum(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的相册 id")
		return
	}
	sess := s.visitorSession(r)
	if sess == nil {
		writeError(w, http.StatusNotFound, "不存在")
		return
	}
	now := time.Now().Unix()
	ok, err := store.SessionCoversAlbum(s.db, sess.SID, id, now)
	if err != nil {
		s.internalError(w, err)
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "不存在")
		return
	}

	album, err := store.GetAlbum(s.db, id)
	if err != nil {
		writeError(w, http.StatusNotFound, "不存在")
		return
	}
	photos, err := store.ListAlbumPhotos(s.db, id)
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
	writeJSON(w, http.StatusOK, map[string]any{"album": toAlbumJSON(album), "photos": out})
}

// handleVisitorPhoto 返回单张照片元数据。会话未覆盖其所属相册一律 404。
func (s *Server) handleVisitorPhoto(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的照片 id")
		return
	}
	sess := s.visitorSession(r)
	if sess == nil {
		writeError(w, http.StatusNotFound, "不存在")
		return
	}
	photo, err := store.GetPhoto(s.db, id)
	if err != nil {
		writeError(w, http.StatusNotFound, "不存在")
		return
	}
	albumIDs, err := store.AlbumIDsForPhoto(s.db, photo.ID)
	if err != nil {
		s.internalError(w, err)
		return
	}
	ok, err := store.SessionCoversAnyAlbum(s.db, sess.SID, albumIDs, time.Now().Unix())
	if err != nil {
		s.internalError(w, err)
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "不存在")
		return
	}
	writeJSON(w, http.StatusOK, toPhotoJSON(photo, albumIDs))
}

// handleVisitorTimeline 返回会话可见的所有照片，按拍摄时间升序。
func (s *Server) handleVisitorTimeline(w http.ResponseWriter, r *http.Request) {
	photos := []photoJSON{}
	sess := s.visitorSession(r)
	if sess != nil {
		now := time.Now().Unix()
		groups, err := store.SessionGroups(s.db, sess.SID, now)
		if err != nil {
			s.internalError(w, err)
			return
		}
		albumIDs := []int64{}
		seen := map[int64]bool{}
		for _, g := range groups {
			ids, err := store.AlbumIDsForGroup(s.db, g.ID)
			if err != nil {
				s.internalError(w, err)
				return
			}
			for _, id := range ids {
				if !seen[id] {
					seen[id] = true
					albumIDs = append(albumIDs, id)
				}
			}
		}
		list, err := store.ListPhotosByAlbums(s.db, albumIDs)
		if err != nil {
			s.internalError(w, err)
			return
		}
		idsMap, err := s.albumIDsMap(list)
		if err != nil {
			s.internalError(w, err)
			return
		}
		for i := range list {
			photos = append(photos, toPhotoJSON(&list[i], idsMap[list[i].ID]))
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"photos": photos})
}
