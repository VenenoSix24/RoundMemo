package media

import (
	"bytes"
	"image/color"
	"testing"

	"github.com/disintegration/imaging"
)

func testJPEG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := imaging.New(w, h, color.RGBA{R: 128, G: 153, B: 178, A: 255})
	var buf bytes.Buffer
	if err := imaging.Encode(&buf, img, imaging.JPEG); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestProcessGeneratesThumbs(t *testing.T) {
	data := testJPEG(t, 800, 400)
	info, err := Process(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if info.Width != 800 || info.Height != 400 {
		t.Fatalf("尺寸不符: %dx%d", info.Width, info.Height)
	}
	// 全景以宽为长边：1024 预览保持 2:1
	if len(info.Preview) == 0 || len(info.List) == 0 {
		t.Fatal("缩略图不应为空")
	}
	if info.Preview == nil || info.List == nil {
		t.Fatal("缩略图应生成")
	}
}

func TestParseEXIFWithoutMetadata(t *testing.T) {
	data := testJPEG(t, 320, 160)
	if md := ParseEXIF(bytes.NewReader(data)); md != nil {
		t.Fatalf("无 EXIF 的图片应返回 nil, got %+v", md)
	}
}

func TestProcessRejectsNonImage(t *testing.T) {
	if _, err := Process(bytes.NewReader([]byte("not an image"))); err == nil {
		t.Fatal("非图片应报错")
	}
}

func TestParseShotAtFromFilename(t *testing.T) {
	tm := ParseShotAtFromFilename("2026-08-06_12-39-58_168.jpg")
	if tm == nil {
		t.Fatal("应解析出时间")
	}
	if tm.Year() != 2026 || tm.Month() != 8 || tm.Day() != 6 || tm.Hour() != 12 || tm.Minute() != 39 || tm.Second() != 58 {
		t.Fatalf("时间解析不符: %v", tm)
	}

	if ParseShotAtFromFilename("random-name.jpg") != nil {
		t.Fatal("无时间前缀的文件名不应命中")
	}
	if ParseShotAtFromFilename("1970-01-01_00-00-00.jpg") != nil {
		t.Fatal("明显不合理的时间应被拒绝")
	}
}
