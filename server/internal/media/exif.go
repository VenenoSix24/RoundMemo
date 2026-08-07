package media

import (
	"io"
	"time"

	"github.com/rwcarlsen/goexif/exif"
)

// Metadata 从 EXIF 提取的拍摄信息，对应 photos 表的时间/GPS/设备列。
type Metadata struct {
	ShotAt      *time.Time
	GPSLat      *float64
	GPSLng      *float64
	DeviceMake  string
	DeviceModel string
}

// ParseEXIF 解析图片元数据。缺 EXIF 或解析失败返回 nil 而非错误，
// 因为无元数据的照片不应阻断导入。
func ParseEXIF(r io.Reader) *Metadata {
	x, err := exif.Decode(r)
	if err != nil {
		return nil
	}
	md := &Metadata{}
	if t, err := x.DateTime(); err == nil {
		md.ShotAt = &t
	}
	if lat, lng, err := x.LatLong(); err == nil {
		md.GPSLat, md.GPSLng = &lat, &lng
	}
	if tag, err := x.Get(exif.Make); err == nil {
		md.DeviceMake, _ = tag.StringVal()
	}
	if tag, err := x.Get(exif.Model); err == nil {
		md.DeviceModel, _ = tag.StringVal()
	}
	return md
}
