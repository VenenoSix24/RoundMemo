package version

// Version 由构建期 ldflags 注入（-X roundmemo/internal/version.Version=v1.0.0）。
// 用 var 而非 const，因为 ldflags 只能改 var；默认 dev，避免开发期顶着一个假版本号。
var Version = "dev"
