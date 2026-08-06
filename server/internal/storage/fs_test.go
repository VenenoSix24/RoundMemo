package storage

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestFSRoundtrip(t *testing.T) {
	root := t.TempDir()
	st, err := NewFS(root)
	if err != nil {
		t.Fatal(err)
	}

	content := []byte("panorama-bytes")
	key := KeyFor("abcdef123456")
	if err := st.Put(context.Background(), key, bytes.NewReader(content), int64(len(content))); err != nil {
		t.Fatal(err)
	}

	rc, err := st.Get(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	got, err := io.ReadAll(rc)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, content) {
		t.Fatalf("读取内容不符: %q", got)
	}

	// 路径约定：photos/<前2>/<sha>
	if _, err := os.Stat(filepath.Join(root, "photos", "ab", "abcdef123456")); err != nil {
		t.Fatalf("落盘路径不符: %v", err)
	}

	if err := st.Delete(context.Background(), key); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Get(context.Background(), key); err == nil {
		t.Fatal("删除后应读取失败")
	}
}

func TestFSRejectsTraversal(t *testing.T) {
	st, err := NewFS(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Put(context.Background(), "../evil", bytes.NewReader([]byte("x")), 1); err == nil {
		t.Fatal("越界 key 应被拒绝")
	}
}

func TestThumbKeyFormat(t *testing.T) {
	if got := ThumbKey("abc", 1024); got != "thumbs/abc_1024.jpg" {
		t.Fatalf("缩略图 key 格式不符: %s", got)
	}
}
