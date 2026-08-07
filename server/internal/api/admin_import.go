package api

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

var imageExts = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".webp": true,
}

// handleImportLocal 扫描服务器本地目录批量导入照片池（开发文档 §8.1 便捷入口，适合一次性放入几十张）。目录路径由 Owner 提供，属受信操作。
func (s *Server) handleImportLocal(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if req.Path == "" {
		writeError(w, http.StatusBadRequest, "path 不能为空")
		return
	}

	files, err := scanImageFiles(req.Path)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无法读取该目录: "+err.Error())
		return
	}

	results := make([]importResult, 0, len(files))
	for _, f := range files {
		name := filepath.Base(f)
		fh, err := os.Open(f)
		if err != nil {
			results = append(results, importResult{Filename: name, Status: "error", Error: err.Error()})
			continue
		}
		results = append(results, s.importStream(name, fh))
		fh.Close()
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func scanImageFiles(dir string) ([]string, error) {
	files := []string{}
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if imageExts[strings.ToLower(filepath.Ext(path))] {
			files = append(files, path)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	// 固定顺序导入
	sort.Strings(files)
	return files, nil
}
