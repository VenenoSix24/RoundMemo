# 圆忆 RoundMemo

**一个私密的、可自托管的在线 360° 全景照片纪念相册。**

用全景相机拍下的瞬间，导入、整理成相册并分组，通过链接 + 数字口令分享给家人、朋友，在全景查看器或拍摄足迹地图里重温曾经的时刻。

[English](README.md) | [简体中文](README.zh.md)

![CI](https://github.com/VenenoSix24/RoundMemo/actions/workflows/ci.yml/badge.svg)
![Version](https://img.shields.io/badge/version-v1.0.0-8b5cf6)
![License](https://img.shields.io/badge/license-AGPL--3.0-blue)

---

## 特性

- **照片池** —— 上传的照片统一进池，再挑选进任意多个相册；从相册移除不影响原图
- **分组与口令授权** —— 相册绑定成分组；每个分组生成分享链接 + 数字口令，可单独开关、设有效期、用量上限、单设备下线
- **全景查看器** —— equirectangular 渲染，支持拖拽 / 滚轮 / 捏合 / 陀螺仪
- **地图视图** —— 按 GPS 聚类的标记地图，瓦片源可配置（高德 / OpenStreetMap / 自定义），自动进行坐标换算
- **备份恢复** —— 单文件 `.rmbackup` 归档，含一致 DB 快照，另有系统层全量备份脚本
- **自托管** —— 单个 Go 二进制，由 Caddy 反代并自动签发 HTTPS

## 技术栈

- **后端** —— Go、chi 路由、SQLite（modernc 纯 Go，无 CGO）
- **前端** —— Vite、TypeScript、Three.js、Leaflet
- **部署** —— systemd + Caddy

## 本地开发

依赖：Go ≥ 1.26、Node.js ≥ 20。

```bash
# 1. 后端（在 server/ 目录内运行）：复制配置模板，启动服务
cp ../config.example.toml ../config.toml
go run ./cmd/roundmemo -config ../config.toml

# 2. 前端 dev server
cd web && npm ci && npm run dev
```

`storage.data_dir` 相对当前工作目录解析——若从别处启动服务，请在 `config.toml` 里把 `data_dir` 改成绝对路径。

本地 `http://127.0.0.1` 调试时，把 `config.toml` 里的 `secure_cookies` 设为 `false`（浏览器会拒收纯 HTTP 下的 Secure cookie）。

首次使用创建 Owner 账号（在 `server/` 目录内运行）：

```bash
go run ./cmd/roundmemo -config ../config.toml owner create <用户名>
```

## 部署

部署套件可在 1H1G VPS 上一键安装：

```bash
sudo bash deploy/install.sh --domain pano.example.com
```

脚本逐步引导（也可用参数预填）：

| 参数 | 含义 |
|---|---|
| `--domain <域>` | 对外域名；同时把 `public_base_url` 设为 `https://<域>` |
| `--data-dir <路径>` | 数据目录（默认 `/opt/roundmemo/data`） |
| `--listen <地址>` | 监听地址（默认 `127.0.0.1:8787`，由 Caddy 反代） |
| `--no-caddy` | 只装二进制 + systemd，跳过 Caddy |
| `--dry-run` | 只打印将执行的操作，不碰系统 |
| `--yes` | 跳过全部交互确认（需配合上述参数） |

脚本：

1. 编译后端二进制（版本号经 `ldflags` 注入）与前端 `dist`
2. 安装到 `/opt/roundmemo/`，创建 `roundmemo` 系统用户
3. **仅在首次安装时**生成 `config.toml` —— 已存在的配置一律不覆盖；重新运行则进行「升级」分支，只更新二进制 / `dist` / unit（旧二进制与旧 dist 各留一份 `.bak`）
4. 安装 systemd unit 并启动服务
5. 将你的域名写入 Caddy 站点配置（Let's Encrypt 自动 HTTPS）

然后在服务器上创建 Owner 账号：

```bash
sudo -u roundmemo /opt/roundmemo/roundmemo owner create <用户名>
```

脚本**不会**自动安装 Go / Node / Caddy —— 缺什么就打印安装命令并退出，不会后台安装其它东西。

## 备份与恢复

- **系统层**（`deploy/backup.sh`）—— 全量备份：使用 SQLite  `.backup` 取一致快照，加上原图、缩略图与图片签名密钥，打包成带时间戳的归档。

  ```bash
  bash deploy/backup.sh --dest /var/backups/roundmemo --keep 7
  ```

  建议加 cron 每日执行；归档 rsync 到异机做异地冗余。

- **应用内** —— Owner 后台「备份恢复」页生成单文件 `.rmbackup` 归档，可在界面下载、恢复，包括迁移到全新机器。

## 配置项

| 键 | 含义 |
|---|---|
| `server.listen` | 监听地址；Caddy 反代到此 |
| `server.public_base_url` | 对外基础 URL，用于生成分享链接 |
| `server.secure_cookies` | HTTPS 下必须 `true`；本地 `http://` 调试设 `false` |
| `storage.data_dir` | 运行时数据根目录（原图 / 缩略图 / 数据库） |
| `security.code_rate_per_hour` | 数字口令尝试限流：每 IP 每小时 |
| `security.session_ttl_days` | 访客会话有效期（天） |
| `security.admin_session_ttl_days` | Owner 会话有效期（天） |
| `security.img_sig_ttl_seconds` | 图片分发签名有效期（秒） |

## 路线图

**v1.0.0 已上线** —— 照片池、分组授权、全景查看器、地图视图、备份恢复、后台管理、液态玻璃界面。

**规划中**

- 接入 S3 兼容对象存储
- 陀螺仪增强
- 桌面 / 移动端评估

**长期**

- 静态文件加密
- 查看器高分辨率分块 LOD
- 多实例部署

## 工程规范

- Conventional Commits、GitHub Flow
- 使用 CI 进行 `gofmt`、`go vet`、`go test`、`go build` 与前端类型检查 + Vite 构建

## License

[AGPL-3.0](LICENSE) —— 强 copyleft：若你将 RoundMemo 作为服务运行，你对其所做修改也必须以相同许可证开源。
