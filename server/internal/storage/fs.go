package storage

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// fsStorage 把 key 映射为数据根目录下的文件路径。
// key 由内容哈希派生（无用户可控片段），但仍做越界防护。
type fsStorage struct {
	root string
}

func NewFS(root string) (Storage, error) {
	if err := os.MkdirAll(root, 0o750); err != nil {
		return nil, fmt.Errorf("创建存储目录: %w", err)
	}
	return &fsStorage{root: root}, nil
}

func (f *fsStorage) path(key string) (string, error) {
	clean := filepath.Clean(filepath.FromSlash(key))
	if clean == "." || strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
		return "", fmt.Errorf("非法存储 key: %q", key)
	}
	return filepath.Join(f.root, clean), nil
}

func (f *fsStorage) Put(_ context.Context, key string, r io.Reader, _ int64) error {
	path, err := f.path(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	out, err := os.Create(path)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, r); err != nil {
		return err
	}
	return out.Sync()
}

// Get 返回 os.File（支持 Seek），图片分发可做范围请求。
func (f *fsStorage) Get(_ context.Context, key string) (io.ReadCloser, error) {
	path, err := f.path(key)
	if err != nil {
		return nil, err
	}
	return os.Open(path)
}

func (f *fsStorage) Delete(_ context.Context, key string) error {
	path, err := f.path(key)
	if err != nil {
		return err
	}
	return os.Remove(path)
}
