package config

import (
	"fmt"

	"github.com/BurntSushi/toml"
)

// Config 进程级配置。字段缺省时回落默认值，避免每次启动都要写满整个文件。
type Config struct {
	Server   ServerConfig   `toml:"server"`
	Storage  StorageConfig  `toml:"storage"`
	Database DatabaseConfig `toml:"database"`
	Security SecurityConfig `toml:"security"`
}

type ServerConfig struct {
	Listen        string `toml:"listen"`
	PublicBaseURL string `toml:"public_base_url"`
}

type StorageConfig struct {
	Kind    string `toml:"kind"`
	DataDir string `toml:"data_dir"`
}

type DatabaseConfig struct {
	Path string `toml:"path"`
}

type SecurityConfig struct {
	CodeRatePerHour int `toml:"code_rate_per_hour"`
	SessionTTLDays  int `toml:"session_ttl_days"`
	ImgSigTTLSecond int `toml:"img_sig_ttl_seconds"`
}

// Load 读取 TOML 文件并补齐默认值。缺失必填项即报错，不让半配置状态进入运行。
func Load(path string) (*Config, error) {
	cfg := &Config{}
	if _, err := toml.DecodeFile(path, cfg); err != nil {
		return nil, fmt.Errorf("解析配置 %s: %w", path, err)
	}
	cfg.applyDefaults()
	if cfg.Server.Listen == "" {
		return nil, fmt.Errorf("配置缺失: server.listen")
	}
	if cfg.Server.PublicBaseURL == "" {
		return nil, fmt.Errorf("配置缺失: server.public_base_url（用于生成分享链接）")
	}
	return cfg, nil
}

func (c *Config) applyDefaults() {
	if c.Server.Listen == "" {
		c.Server.Listen = "127.0.0.1:8787"
	}
	if c.Storage.Kind == "" {
		c.Storage.Kind = "fs"
	}
	if c.Storage.DataDir == "" {
		c.Storage.DataDir = "./data"
	}
	if c.Database.Path == "" {
		c.Database.Path = c.Storage.DataDir + "/roundmemo.db"
	}
	if c.Security.CodeRatePerHour <= 0 {
		c.Security.CodeRatePerHour = 10
	}
	if c.Security.SessionTTLDays <= 0 {
		c.Security.SessionTTLDays = 30
	}
	if c.Security.ImgSigTTLSecond <= 0 {
		c.Security.ImgSigTTLSecond = 300
	}
}
