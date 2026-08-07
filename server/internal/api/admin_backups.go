package api

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"roundmemo/internal/auth"
	"roundmemo/internal/store"
	"roundmemo/internal/version"
)

// 备份恢复：把站点数据导出为 .rmbackup 档案包（zip），可迁移到另一台服务器。
// 两种范围：db=仅数据库快照；full=数据库 + 照片原图/缩略图 + favicon + 签名密钥。

type backupManifest struct {
	App       string             `json:"app"`
	Version   string             `json:"version"`
	Kind      string             `json:"kind"`
	CreatedAt int64              `json:"created_at"`
	Counts    store.BackupCounts `json:"counts"`
}

type backupEntry struct {
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	Size      int64  `json:"size"`
	CreatedAt int64  `json:"created_at"`
	Version   string `json:"version"`
	Photos    int64  `json:"photos"`
	Albums    int64  `json:"albums"`
	Groups    int64  `json:"groups"`
	Grants    int64  `json:"grants"`
}

const backupExt = ".rmbackup"

func (s *Server) backupsDir() string {
	return filepath.Join(s.cfg.Storage.DataDir, "backups")
}

func escapeSQLString(s string) string {
	return strings.ReplaceAll(s, "'", "''")
}

// handleCreateBackup 创建备份：POST /api/admin/backups，body {"kind":"db"|"full"}。
func (s *Server) handleCreateBackup(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Kind string `json:"kind"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if req.Kind != "db" && req.Kind != "full" {
		writeError(w, http.StatusBadRequest, "kind 只能是 db 或 full")
		return
	}
	path, m, err := s.createBackup(req.Kind)
	if err != nil {
		s.internalError(w, err)
		return
	}
	fi, err := os.Stat(path)
	if err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, backupEntry{
		Name: filepath.Base(path), Kind: m.Kind, Size: fi.Size(),
		CreatedAt: m.CreatedAt, Version: m.Version,
		Photos: m.Counts.Photos, Albums: m.Counts.Albums,
		Groups: m.Counts.Groups, Grants: m.Counts.Grants,
	})
}

// createBackup 打包备份到 backupsDir，返回文件路径与清单。
func (s *Server) createBackup(kind string) (string, *backupManifest, error) {
	counts, err := store.CountForBackup(s.db)
	if err != nil {
		return "", nil, fmt.Errorf("统计数据量: %w", err)
	}
	m := &backupManifest{
		App: "roundmemo", Version: version.Version, Kind: kind,
		CreatedAt: time.Now().Unix(), Counts: counts,
	}

	// 一致性快照：VACUUM INTO 需要目标文件不存在，放系统临时目录。
	tmpDir, err := os.MkdirTemp("", "roundmemo-snap-*")
	if err != nil {
		return "", nil, err
	}
	defer os.RemoveAll(tmpDir)
	snap := filepath.Join(tmpDir, "snapshot.db")
	if _, err := s.db.Exec("VACUUM INTO '" + escapeSQLString(snap) + "'"); err != nil {
		return "", nil, fmt.Errorf("生成数据库快照: %w", err)
	}

	if err := os.MkdirAll(s.backupsDir(), 0o750); err != nil {
		return "", nil, err
	}
	name := fmt.Sprintf("roundmemo-%d-%s%s", m.CreatedAt, kind, backupExt)
	out, err := os.Create(filepath.Join(s.backupsDir(), name))
	if err != nil {
		return "", nil, err
	}
	defer out.Close()

	zw := zip.NewWriter(out)
	if err := addManifest(zw, m); err != nil {
		zw.Close()
		return "", nil, err
	}
	if err := addFileEntry(zw, "roundmemo.db", snap); err != nil {
		zw.Close()
		return "", nil, err
	}
	if kind == "full" {
		if err := addDirEntries(zw, s.cfg.Storage.DataDir, s.backupsDir()); err != nil {
			zw.Close()
			return "", nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return "", nil, err
	}
	return out.Name(), m, nil
}

func addManifest(zw *zip.Writer, m *backupManifest) error {
	fw, err := zw.Create("manifest.json")
	if err != nil {
		return err
	}
	return json.NewEncoder(fw).Encode(m)
}

func addFileEntry(zw *zip.Writer, name, src string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	fw, err := zw.Create(name)
	if err != nil {
		return err
	}
	_, err = io.Copy(fw, in)
	return err
}

// addDirEntries 把 DataDir 下的照片/缩略图/favicon/密钥递归写入 zip。
// 排除 backups/（防备份套备份）与 sqlite 三件套（快照已单独入包）。
func addDirEntries(zw *zip.Writer, dataDir, backupsDir string) error {
	return filepath.WalkDir(dataDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(dataDir, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		if d.IsDir() {
			if rel == "backups" {
				return filepath.SkipDir
			}
			return nil
		}
		// 排除 sqlite 实时文件（快照已覆盖数据）与临时文件
		if strings.HasSuffix(rel, "-wal") || strings.HasSuffix(rel, "-shm") ||
			strings.HasPrefix(filepath.Base(rel), ".tmp") || filepath.Base(rel) == "roundmemo.db" {
			return nil
		}
		return addFileEntry(zw, filepath.ToSlash(rel), path)
	})
}

// handleListBackups 列出备份：GET /api/admin/backups。
func (s *Server) handleListBackups(w http.ResponseWriter, _ *http.Request) {
	entries, err := os.ReadDir(s.backupsDir())
	if err != nil {
		if os.IsNotExist(err) {
			writeJSON(w, http.StatusOK, map[string]any{"backups": []backupEntry{}})
			return
		}
		s.internalError(w, err)
		return
	}
	out := make([]backupEntry, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), backupExt) {
			continue
		}
		fi, err := e.Info()
		if err != nil {
			continue
		}
		m, err := readManifest(filepath.Join(s.backupsDir(), e.Name()))
		if err != nil {
			// 损坏/旧格式备份跳过，不阻塞列表
			continue
		}
		out = append(out, backupEntry{
			Name: e.Name(), Kind: m.Kind, Size: fi.Size(),
			CreatedAt: m.CreatedAt, Version: m.Version,
			Photos: m.Counts.Photos, Albums: m.Counts.Albums,
			Groups: m.Counts.Groups, Grants: m.Counts.Grants,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"backups": out})
}

func readManifest(path string) (*backupManifest, error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return nil, err
	}
	defer zr.Close()
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
	return nil, errors.New("备份缺少 manifest.json")
}

// handleDownloadBackup 下载备份：GET /api/admin/backups/{name}。
func (s *Server) handleDownloadBackup(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if !validBackupName(name) {
		writeError(w, http.StatusNotFound, "备份不存在")
		return
	}
	path := filepath.Join(s.backupsDir(), name)
	if _, err := os.Stat(path); err != nil {
		writeError(w, http.StatusNotFound, "备份不存在")
		return
	}
	w.Header().Set("Content-Disposition", "attachment; filename="+name)
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeFile(w, r, path)
}

// handleDeleteBackup 删除备份：DELETE /api/admin/backups/{name}。
func (s *Server) handleDeleteBackup(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if !validBackupName(name) {
		writeError(w, http.StatusNotFound, "备份不存在")
		return
	}
	path := filepath.Join(s.backupsDir(), name)
	if _, err := os.Stat(path); err != nil {
		writeError(w, http.StatusNotFound, "备份不存在")
		return
	}
	if err := os.Remove(path); err != nil {
		s.internalError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func validBackupName(name string) bool {
	if name == "" || filepath.Base(name) != name || !strings.HasSuffix(name, backupExt) {
		return false
	}
	return !strings.Contains(name, "..")
}

// handleRestoreBackup 恢复备份：POST /api/admin/backups/restore，
// multipart：file=档案包，confirm=确认词（防止误触破坏性操作）。
func (s *Server) handleRestoreBackup(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(0); err != nil {
		writeError(w, http.StatusBadRequest, "请上传档案包")
		return
	}
	confirm := r.FormValue("confirm")
	if confirm != "RESET" {
		writeError(w, http.StatusBadRequest, "确认词不正确，未执行恢复")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "请选择备份文件")
		return
	}
	defer file.Close()

	// 先落盘再解包，避免 zip bomb 直接打爆内存。
	tmp, err := os.CreateTemp("", "roundmemo-restore-*.rmbackup")
	if err != nil {
		s.internalError(w, err)
		return
	}
	defer os.Remove(tmp.Name())
	if _, err := io.Copy(tmp, file); err != nil {
		tmp.Close()
		s.internalError(w, err)
		return
	}
	tmp.Close()

	// 恢复期间全局互斥：替换运行中的 DB 不允许并发请求介入。
	s.restoreMu.Lock()
	defer s.restoreMu.Unlock()

	staging, err := os.MkdirTemp("", "roundmemo-restore-stage-*")
	if err != nil {
		s.internalError(w, err)
		return
	}
	defer os.RemoveAll(staging)
	if err := unzip(tmp.Name(), staging); err != nil {
		writeError(w, http.StatusBadRequest, "档案包无法解压")
		return
	}
	m, err := readManifestFromDir(staging)
	if err != nil {
		writeError(w, http.StatusBadRequest, "档案包缺少有效 manifest.json")
		return
	}
	if m.App != "roundmemo" {
		writeError(w, http.StatusBadRequest, "不是 RoundMemo 备份包")
		return
	}
	snap := filepath.Join(staging, "roundmemo.db")
	if _, err := os.Stat(snap); err != nil {
		writeError(w, http.StatusBadRequest, "档案包缺少数据库快照")
		return
	}
	if m.Kind != "db" && m.Kind != "full" {
		writeError(w, http.StatusBadRequest, "未知备份类型")
		return
	}

	prevDir, err := s.applyRestore(staging, m.Kind)
	if err != nil {
		s.logger.Error("恢复失败", "err", err)
		writeError(w, http.StatusInternalServerError, "恢复失败，原数据已保留在 "+prevDir)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"restored": true,
		"kind":     m.Kind,
		"prev_dir": prevDir,
	})
}

// applyRestore 执行替换：关闭旧 DB → 现有数据挪到兜底目录 → 移入新文件 → 重开 DB + 迁移。
func (s *Server) applyRestore(staging, kind string) (string, error) {
	dataDir := s.cfg.Storage.DataDir
	ts := time.Now().Format("20060102-150405")
	prevDir := filepath.Join(dataDir, ".restore-prev-"+ts)
	if err := os.MkdirAll(prevDir, 0o750); err != nil {
		return "", err
	}

	dbPath := s.cfg.Database.Path
	if dbPath == "" {
		dbPath = filepath.Join(dataDir, "roundmemo.db")
	}
	// 关闭旧连接，释放 db/wal/shm 文件句柄
	if err := s.db.Close(); err != nil {
		return prevDir, fmt.Errorf("关闭旧数据库: %w", err)
	}
	for _, suf := range []string{"", "-wal", "-shm"} {
		if err := moveIfExists(dbPath+suf, filepath.Join(prevDir, filepath.Base(dbPath)+suf)); err != nil {
			return prevDir, err
		}
	}
	if err := os.Rename(filepath.Join(staging, "roundmemo.db"), dbPath); err != nil {
		return prevDir, fmt.Errorf("移入数据库快照: %w", err)
	}

	if kind == "full" {
		// 照片/缩略图/favicon/密钥整目录替换：先挪旧再移新，失败可回滚。
		for _, sub := range []string{"photos", "thumbs", "settings"} {
			oldSub := filepath.Join(dataDir, sub)
			if _, err := os.Stat(oldSub); err == nil {
				if err := os.Rename(oldSub, filepath.Join(prevDir, sub)); err != nil {
					return prevDir, err
				}
			}
			if err := os.Rename(filepath.Join(staging, sub), oldSub); err != nil {
				return prevDir, fmt.Errorf("移入 %s: %w", sub, err)
			}
		}
		if err := moveIfExists(filepath.Join(dataDir, "secret.key"), filepath.Join(prevDir, "secret.key")); err != nil {
			return prevDir, err
		}
		if err := moveIfExists(filepath.Join(staging, "secret.key"), filepath.Join(dataDir, "secret.key")); err != nil {
			return prevDir, err
		}
	}

	db, err := store.Open(dbPath)
	if err != nil {
		return prevDir, fmt.Errorf("重开数据库: %w", err)
	}
	if err := store.Migrate(db); err != nil {
		db.Close()
		return prevDir, fmt.Errorf("迁移数据库: %w", err)
	}
	s.db = db
	if kind == "full" {
		// 签名密钥可能随备份换过，重载保持内存与落盘一致。
		if sec, err := auth.LoadOrCreateSecret(dataDir); err == nil {
			s.secret = sec
		}
	}
	return prevDir, nil
}

func moveIfExists(src, dst string) error {
	if _, err := os.Stat(src); os.IsNotExist(err) {
		return nil
	}
	if err := os.Rename(src, dst); err != nil {
		return fmt.Errorf("移动 %s: %w", filepath.Base(src), err)
	}
	return nil
}

// readManifestFromDir 读解包目录里的 manifest.json。
func readManifestFromDir(dir string) (*backupManifest, error) {
	path := filepath.Join(dir, "manifest.json")
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var m backupManifest
	if err := json.NewDecoder(f).Decode(&m); err != nil {
		return nil, err
	}
	return &m, nil
}

// unzip 解压到目标目录，防 zip-slip（路径逃逸到目标目录外）。
func unzip(src, dest string) error {
	zr, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer zr.Close()
	for _, f := range zr.File {
		fpath := filepath.Join(dest, f.Name)
		if !strings.HasPrefix(fpath, filepath.Clean(dest)+string(os.PathSeparator)) {
			return errors.New("非法压缩条目路径")
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(fpath, 0o750); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(fpath), 0o750); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.Create(fpath)
		if err != nil {
			rc.Close()
			return err
		}
		_, cerr := io.Copy(out, rc)
		rc.Close()
		out.Close()
		if cerr != nil {
			return cerr
		}
	}
	return nil
}
