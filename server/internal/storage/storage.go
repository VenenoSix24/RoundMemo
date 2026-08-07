package storage

import (
	"context"
	"fmt"
	"io"
)

// Storage 是内容寻址的键值存储抽象。MVP 只实现 fs；将来接 S3 兼容存储
// 只加适配器，业务层不感知。
type Storage interface {
	Put(ctx context.Context, key string, r io.Reader, size int64) error
	Get(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
}

// KeyFor 返回原图存储 key：photos/<sha前2>/<sha>。
func KeyFor(sha string) string {
	return fmt.Sprintf("photos/%s/%s", sha[:2], sha)
}

// ThumbKey 返回缩略图存储 key：thumbs/<sha>_<size>.jpg。
func ThumbKey(sha string, size int) string {
	return fmt.Sprintf("thumbs/%s_%d.jpg", sha, size)
}
