package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"

	"github.com/go-chi/chi/v5"

	"roundmemo/internal/media"
	"roundmemo/internal/storage"
	"roundmemo/internal/store"
)

// maxUploadBytes 单次上传上限。覆盖大尺寸全景（如 8K equirectangular），
// 靠 MaxBytesReader 流式限制，不整读进内存。
const maxUploadBytes = 512 << 20

type importResult struct {
	Filename string `json:"filename"`
	Status   string `json:"status"` // added | duplicate | error
	PhotoID  *int64 `json:"photo_id,omitempty"`
	Error    string `json:"error,omitempty"`
}

func (s *Server) handleUploadPhotos(w http.ResponseWriter, r *http.Request) {
	albumID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的相册 id")
		return
	}
	if _, err := store.GetAlbum(s.db, albumID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "相册不存在")
			return
		}
		s.internalError(w, err)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	reader, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "请求须为 multipart/form-data")
		return
	}

	results := []importResult{}
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			writeError(w, http.StatusBadRequest, "解析上传内容失败")
			return
		}
		filename := part.FileName()
		if filename == "" {
			part.Close()
			continue
		}
		results = append(results, s.importStream(albumID, filename, part))
		part.Close()
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

// importStream 处理单张图片：流式落临时文件 → sha256 → EXIF → 缩略图 →
// 去重 → 落存储 → 写库。逐文件顺序执行，控制 1H1G 的瞬时内存峰值。
func (s *Server) importStream(albumID int64, filename string, r io.Reader) importResult {
	fail := func(err error) importResult {
		return importResult{Filename: filename, Status: "error", Error: err.Error()}
	}

	tmp, err := os.CreateTemp("", "rm-import-*")
	if err != nil {
		return fail(err)
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()

	h := sha256.New()
	size, err := io.Copy(io.MultiWriter(tmp, h), r)
	if err != nil {
		return fail(err)
	}
	sum := hex.EncodeToString(h.Sum(nil))

	// 内容寻址去重：命中则不重复落盘/写库
	if existing, err := store.GetPhotoBySHA(s.db, sum); err == nil {
		id := existing.ID
		return importResult{Filename: filename, Status: "duplicate", PhotoID: &id}
	} else if !errors.Is(err, store.ErrNotFound) {
		return fail(err)
	}

	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		return fail(err)
	}
	info, err := media.Process(tmp)
	if err != nil {
		return fail(fmt.Errorf("图片解码失败: %w", err))
	}
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		return fail(err)
	}
	md := media.ParseEXIF(tmp)

	photo := &store.Photo{
		AlbumID:     albumID,
		StorageKey:  storage.KeyFor(sum),
		SHA256:      sum,
		ByteSize:    size,
		Width:       &info.Width,
		Height:      &info.Height,
		DeviceMake:  deviceMake(md),
		DeviceModel: deviceModel(md),
		Filename:    filename,
	}
	if md != nil {
		if md.ShotAt != nil {
			ts := md.ShotAt.Unix()
			photo.ShotAt = &ts
		}
		photo.GPSLat = md.GPSLat
		photo.GPSLng = md.GPSLng
	}
	// 部分手机全景导出剥掉 EXIF 时间，仅文件名带时间戳：此处兜底。
	if photo.ShotAt == nil {
		if t := media.ParseShotAtFromFilename(filename); t != nil {
			ts := t.Unix()
			photo.ShotAt = &ts
		}
	}

	// 先落存储再写库：写库失败最多留孤儿文件（无引用），
	// 反过来则会产生指向缺失文件的 DB 行，影响更坏。
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		return fail(err)
	}
	if err := s.writeStorage(photo, tmp, info); err != nil {
		return fail(err)
	}
	created, isNew, err := store.CreatePhoto(s.db, photo)
	if err != nil {
		return fail(err)
	}
	if !isNew {
		id := created.ID
		return importResult{Filename: filename, Status: "duplicate", PhotoID: &id}
	}
	_ = store.SetAlbumCover(s.db, albumID, created.ID)

	id := created.ID
	return importResult{Filename: filename, Status: "added", PhotoID: &id}
}

func deviceMake(md *media.Metadata) string {
	if md != nil {
		return md.DeviceMake
	}
	return ""
}

func deviceModel(md *media.Metadata) string {
	if md != nil {
		return md.DeviceModel
	}
	return ""
}

func (s *Server) writeStorage(photo *store.Photo, raw io.Reader, info *media.ImageInfo) error {
	if err := s.storage.Put(context.Background(), photo.StorageKey, raw, photo.ByteSize); err != nil {
		return err
	}
	if err := s.storage.Put(context.Background(), storage.ThumbKey(photo.SHA256, media.ThumbPreview),
		bytes.NewReader(info.Preview), int64(len(info.Preview))); err != nil {
		return err
	}
	return s.storage.Put(context.Background(), storage.ThumbKey(photo.SHA256, media.ThumbList),
		bytes.NewReader(info.List), int64(len(info.List)))
}

// handleListAlbumPhotos 后台相册照片列表（含 filename，供信息管理与封面设置）。
func (s *Server) handleListAlbumPhotos(w http.ResponseWriter, r *http.Request) {
	albumID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的相册 id")
		return
	}
	if _, err := store.GetAlbum(s.db, albumID); err != nil {
		writeError(w, http.StatusNotFound, "相册不存在")
		return
	}
	photos, err := store.ListPhotosByAlbum(s.db, albumID)
	if err != nil {
		s.internalError(w, err)
		return
	}
	out := make([]photoJSON, 0, len(photos))
	for i := range photos {
		out = append(out, toPhotoJSON(&photos[i]))
	}
	writeJSON(w, http.StatusOK, map[string]any{"photos": out})
}

// handleSetAlbumCover 手动设置相册封面（覆盖当前封面）。
func (s *Server) handleSetAlbumCover(w http.ResponseWriter, r *http.Request) {
	albumID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的相册 id")
		return
	}
	var req struct {
		PhotoID int64 `json:"photo_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if req.PhotoID == 0 {
		writeError(w, http.StatusBadRequest, "photo_id 不能为空")
		return
	}
	if _, err := store.GetAlbum(s.db, albumID); err != nil {
		writeError(w, http.StatusNotFound, "相册不存在")
		return
	}
	photo, err := store.GetPhoto(s.db, req.PhotoID)
	if err != nil {
		writeError(w, http.StatusNotFound, "照片不存在")
		return
	}
	if photo.AlbumID != albumID {
		writeError(w, http.StatusBadRequest, "照片不属于该相册")
		return
	}
	if err := store.SetAlbumCoverForce(s.db, albumID, req.PhotoID); err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
