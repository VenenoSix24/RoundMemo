package media

import (
	"regexp"
	"time"
)

// 手机全景导出常剥掉 EXIF 时间、只保留在文件名里（如 2026-08-06_12-39-58_168.jpg）。
var shotAtFilenameRe = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})`)

// ParseShotAtFromFilename 从导出文件名提取拍摄时间，作为 EXIF 缺失时的兜底。
// 按服务端本地时区解析（文件名时间戳通常为设备本地时间），无匹配或时间明显
// 不合理时返回 nil，回落到 created_at。
func ParseShotAtFromFilename(name string) *time.Time {
	m := shotAtFilenameRe.FindStringSubmatch(name)
	if m == nil {
		return nil
	}
	t, err := time.ParseInLocation("2006-01-02_15-04-05",
		m[1]+"-"+m[2]+"-"+m[3]+"_"+m[4]+"-"+m[5]+"-"+m[6], time.Local)
	if err != nil {
		return nil
	}
	if t.Year() < 1990 || t.After(time.Now().Add(24*time.Hour)) {
		return nil
	}
	return &t
}
