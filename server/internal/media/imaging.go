package media

import (
	"bytes"
	"image"
	"io"

	"github.com/disintegration/imaging"
)

// 缩略图最长边。
const (
	ThumbPreview = 1024
	ThumbList    = 256
)

// ImageInfo 缩略图产物与原始尺寸，供写库与落盘。
type ImageInfo struct {
	Width   int
	Height  int
	Preview []byte
	List    []byte
}

// Process 解码原图并按 EXIF 朝向摆正，生成两档 JPEG 缩略图。
func Process(r io.Reader) (*ImageInfo, error) {
	src, err := imaging.Decode(r, imaging.AutoOrientation(true))
	if err != nil {
		return nil, err
	}
	info := &ImageInfo{Width: src.Bounds().Dx(), Height: src.Bounds().Dy()}
	if info.Preview, err = encodeThumb(src, ThumbPreview); err != nil {
		return nil, err
	}
	if info.List, err = encodeThumb(src, ThumbList); err != nil {
		return nil, err
	}
	return info, nil
}

// encodeThumb 保持宽高比，把长边缩到 maxSide。全景图以宽为长边，故优先按宽缩放。
func encodeThumb(src image.Image, maxSide int) ([]byte, error) {
	w, h := src.Bounds().Dx(), src.Bounds().Dy()
	var thumb image.Image
	if w >= h {
		thumb = imaging.Resize(src, maxSide, 0, imaging.Lanczos)
	} else {
		thumb = imaging.Resize(src, 0, maxSide, imaging.Lanczos)
	}
	return encodeJPEG(thumb)
}

func encodeJPEG(img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	if err := imaging.Encode(&buf, img, imaging.JPEG, imaging.JPEGQuality(85)); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
