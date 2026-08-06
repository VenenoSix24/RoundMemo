package api

import (
	"context"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"roundmemo/internal/auth"
	"roundmemo/internal/media"
	"roundmemo/internal/storage"
	"roundmemo/internal/store"
)

// handleImage 鉴权图片分发（开发文档 §8.3 / decisions/0002 方案 A）。
// 会话来源二选一：cookie/Bearer 会话，或签名 URL（sid+exp+sig）。
// 无论缺会话、无此照片、无权访问，一律 404，不泄露存在性。
func (s *Server) handleImage(w http.ResponseWriter, r *http.Request) {
	kind := chi.URLParam(r, "kind")
	sha := chi.URLParam(r, "sha")
	now := time.Now().Unix()

	key, ok := imageKeyFor(kind, sha)
	if !ok {
		writeError(w, http.StatusNotFound, "不存在")
		return
	}
	photo, err := store.GetPhotoBySHA(s.db, sha)
	if err != nil {
		writeError(w, http.StatusNotFound, "不存在")
		return
	}

	sid := ""
	if sess := s.visitorSession(r); sess != nil {
		sid = sess.SID
	} else if q := r.URL.Query(); q.Get("sid") != "" {
		exp, perr := strconv.ParseInt(q.Get("exp"), 10, 64)
		if perr != nil || exp < now || !auth.VerifyImageSig(s.secret, q.Get("sid"), kind, sha, exp, q.Get("sig")) {
			writeError(w, http.StatusNotFound, "不存在")
			return
		}
		sid = q.Get("sid")
	}
	if sid == "" {
		writeError(w, http.StatusNotFound, "不存在")
		return
	}
	if _, err := store.GetSession(s.db, sid, now); err != nil {
		writeError(w, http.StatusNotFound, "不存在")
		return
	}
	albumIDs, err := store.AlbumIDsForPhoto(s.db, photo.ID)
	if err != nil {
		writeError(w, http.StatusNotFound, "不存在")
		return
	}
	ok, err = store.SessionCoversAnyAlbum(s.db, sid, albumIDs, now)
	if err != nil || !ok {
		writeError(w, http.StatusNotFound, "不存在")
		return
	}

	rc, err := s.storage.Get(context.Background(), key)
	if err != nil {
		writeError(w, http.StatusNotFound, "不存在")
		return
	}
	defer rc.Close()

	// 内容寻址不可变：可永久缓存；os.File 支持 Range 请求与断点续传。
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("Content-Type", "image/jpeg")
	if f, ok := rc.(io.ReadSeeker); ok {
		http.ServeContent(w, r, sha+".jpg", time.Unix(now, 0), f)
		return
	}
	io.Copy(w, rc)
}

func imageKeyFor(kind, sha string) (string, bool) {
	switch kind {
	case "raw":
		return storage.KeyFor(sha), true
	case "thumb1024":
		return storage.ThumbKey(sha, media.ThumbPreview), true
	case "thumb256":
		return storage.ThumbKey(sha, media.ThumbList), true
	}
	return "", false
}
