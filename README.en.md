![圆忆 RoundMemo](.github/assets/cover.png)


# RoundMemo

A self-hosted album for organizing and sharing 360° panorama photos.

Upload photos to a pool first, then organize them into albums and groups. Each group can share access via a link and a numeric passcode, so family and friends can view everything without signing up. Comes with a panorama viewer, a map of where photos were taken, backup and restore, and more.

[English](README.en.md) | [简体中文](README.md)

[![CI](https://img.shields.io/github/actions/workflow/status/VenenoSix24/RoundMemo/ci.yml?label=CI)](https://github.com/VenenoSix24/RoundMemo/actions/workflows/ci.yml)
![Version](https://img.shields.io/badge/version-v1.2.0-8b5cf6)
![License](https://img.shields.io/badge/license-AGPL--3.0-blue)

## Features

- **Photo pool**: photos live in a single pool and can be added to multiple albums; removing one from an album never touches the original
- **Albums & groups**: albums attach to groups, and groups are accessed through a share link plus a numeric passcode
- **Sharing controls**: toggle shares on or off, set expiry dates, cap the number of accesses, and sign individual devices out
- **Panorama viewer**: renders equirectangular panoramas with drag, scroll, pinch, and phone gyroscope support
- **Viewer effects**: auto rotate and a "little planet" intro — photos open from a tiny-planet view and unfold into the full panorama
- **Photo details**: photos are sorted newest first with shooting date and location badges; title, description, and location name show up in the viewer
- **Map**: GPS-based markers with automatic clustering, working with AMap, OpenStreetMap, or any custom tile source
- **Backup & restore**: single-file `.rmbackup` archives, plus a full system-level backup script
- **Self-hosted**: a single Go binary deployed with systemd and Caddy

## Screenshots

<table>
  <tr>
    <td><img src=".github/assets/user-1.png" alt="Visitor albums" /></td>
    <td><img src=".github/assets/user-2.png" alt="Visitor panorama viewer" /></td>
  </tr>
  <tr>
    <td align="center">Visitor side · Album list</td>
    <td align="center">Visitor side · Panorama viewer</td>
  </tr>
  <tr>
    <td><img src=".github/assets/admin-1.png" alt="Admin photo pool" /></td>
    <td><img src=".github/assets/admin-2.png" alt="Admin settings" /></td>
  </tr>
  <tr>
    <td align="center">Admin · Photo pool</td>
    <td align="center">Admin · Share page</td>
  </tr>
</table>

## Tech Stack

- **Backend**: Go, chi, SQLite
- **Database**: SQLite via modernc, no CGO
- **Frontend**: Vite, TypeScript, Three.js, Leaflet
- **Deployment**: systemd + Caddy

## Development

Requirements:

- Go ≥ 1.26
- Node.js ≥ 20

### Backend

From the `server/` directory:

```bash
cp ../config.example.toml ../config.toml
go run ./cmd/roundmemo -config ../config.toml
```

### Frontend

```bash
cd web
npm ci
npm run dev
```

`storage.data_dir` is resolved relative to the working directory by default. If you start the server from elsewhere, use an absolute path in `config.toml`.

When debugging over plain `http://127.0.0.1`, set:

```toml
secure_cookies = false
```

Otherwise browsers reject Secure cookies over HTTP.

### Creating the Owner Account

On first use, run from the `server/` directory:

```bash
go run ./cmd/roundmemo -config ../config.toml owner create <username>
```

## Deployment

An install script ships with the project and handles deployment on a lightweight VPS:

```bash
sudo bash deploy/install.sh --domain pano.example.com
```

The script walks you through configuration, or you can pass parameters to skip some of the prompts.

| Flag | Description |
| --- | --- |
| `--domain <domain>` | Public domain; also sets `public_base_url` |
| `--data-dir <path>` | Data directory, defaults to `/opt/roundmemo/data` |
| `--listen <addr>` | Listen address, defaults to `127.0.0.1:8787` |
| `--no-caddy` | Install only the binary and systemd unit, skip Caddy |
| `--dry-run` | Print what would run without touching the system |
| `--yes` | Skip interactive confirmations; requires the flags above |

The install process:

1. Builds the backend binary and frontend `dist`
2. Installs into `/opt/roundmemo/`
3. Creates a `roundmemo` system user
4. Generates `config.toml` on first install only
5. Installs the systemd unit and starts the service
6. Configures Caddy with automatic HTTPS via Let's Encrypt

Re-running the script:

- An existing `config.toml` is never overwritten
- The upgrade path kicks in
- The binary, frontend `dist`, and systemd unit get updated
- One `.bak` copy of the previous binary and `dist` is kept

Creating the Owner account:

```bash
sudo -u roundmemo /opt/roundmemo/roundmemo owner create <username>
```

The script does not install Go, Node.js, or Caddy for you. If a dependency is missing, it prints the install command and exits.

## Backup & Restore

### System-level backup

`deploy/backup.sh` creates a complete backup, including:

- A consistent SQLite snapshot
- Original photos
- Thumbnails
- The image signing key

Example:

```bash
bash deploy/backup.sh --dest /var/backups/roundmemo --keep 7
```

Run it daily via cron, and sync the archives to another machine for offsite redundancy.

### In-app backup

The owner admin panel has a "Backup & Restore" page that produces `.rmbackup` files.

An archive can be downloaded directly, or restored on a different machine to migrate an entire RoundMemo instance.

## Configuration

The main configuration lives in `config.toml`.

| Key | Description |
| --- | --- |
| `server.listen` | Listen address; Caddy reverse-proxies here by default |
| `server.public_base_url` | Public base URL used to build share links |
| `server.secure_cookies` | Set `true` behind HTTPS; `false` for local HTTP debugging |
| `storage.data_dir` | Data directory holding originals, thumbnails, and the database |
| `security.code_rate_per_hour` | Passcode attempt limit per IP per hour |
| `security.session_ttl_days` | Visitor session lifetime |
| `security.admin_session_ttl_days` | Owner session lifetime |
| `security.img_sig_ttl_seconds` | Image URL signature lifetime |

## Roadmap

### v1.2.0

Shipped:

- Photo pool
- Albums and group-based grants
- Panorama viewer
- Map view
- Backup & restore
- Admin panel
- Liquid glass UI
- Gyroscope control
- Auto rotate
- Little planet intro

### Planned

- S3-compatible object storage
- Desktop / mobile apps

### Long term

- Static file encryption
- Tiled deep-zoom LOD for the viewer
- Multi-instance deployment

## Engineering

- Conventional Commits
- GitHub Flow
- CI runs `gofmt`, `go vet`, `go test`, `go build`
- Frontend runs TypeScript type checking and a Vite build

## License

RoundMemo is licensed under [AGPL-3.0](LICENSE).
