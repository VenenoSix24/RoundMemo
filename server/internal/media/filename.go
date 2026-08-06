package media

import (
	"fmt"
	"regexp"
	"time"
)

// 手机全景导出有时剥掉 EXIF 时间、只保留在文件名里。支持两种常见格式：
//
//	YYYY-MM-DD_HH-MM-SS（相机导出）
//	IMG_YYYYMMDD_HHMMSS...PHOTOSPHERE.jpg（Android 谷歌相机全景）
var (
	shotAtDashRe = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})`)
	shotAtImgRe  = regexp.MustCompile(`IMG_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})`)
)

// ParseShotAtFromFilename 从导出文件名提取拍摄时间，作为 EXIF 缺失时的兜底。
// 按服务端本地时区解析（文件名时间戳通常为设备本地时间），无匹配或时间明显
// 不合理时返回 nil，回落到 created_at。
func ParseShotAtFromFilename(name string) *time.Time {
	if m := shotAtDashRe.FindStringSubmatch(name); m != nil {
		return parseShotAt(m[1], m[2], m[3], m[4], m[5], m[6])
	}
	if m := shotAtImgRe.FindStringSubmatch(name); m != nil {
		return parseShotAt(m[1], m[2], m[3], m[4], m[5], m[6])
	}
	return nil
}

func parseShotAt(y, mo, d, h, mi, s string) *time.Time {
	t, err := time.ParseInLocation("2006-01-02 15:04:05",
		fmt.Sprintf("%s-%s-%s %s:%s:%s", y, mo, d, h, mi, s), time.Local)
	if err != nil {
		return nil
	}
	if t.Year() < 1990 || t.After(time.Now().Add(24*time.Hour)) {
		return nil
	}
	return &t
}
