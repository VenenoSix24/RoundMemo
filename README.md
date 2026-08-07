# RoundMemo

**A private, self-hostable online 360° photo memorial album.**

Import photos taken with a 360 camera, organize them into albums and groups,
and share them with family and friends via a link and a numeric code — so they
can relive those moments in the panorama viewer or on a map of where the photos
were taken.

[English](README.md) | [简体中文](README.zh.md)

![CI](https://github.com/VenenoSix24/RoundMemo/actions/workflows/ci.yml/badge.svg)
![Version](https://img.shields.io/badge/version-v1.0.0-8b5cf6)
![License](https://img.shields.io/badge/license-AGPL--3.0-blue)

---

## Features

- **Photo pool** — upload photos into a pool, then pick them into any number of
  albums; removing from an album never deletes the original
- **Groups & grants** — albums are bound into groups; each group gets a share
  link plus a numeric code, with per-grant enable/switch, expiry, usage cap and
  revocation
- **Panorama viewer** — equirectangular rendering with drag, wheel zoom, pinch,
  and gyroscope control
- **Map view** — GPS-clustered map with configurable tile source
  (AMap / OpenStreetMap / custom) and automatic coordinate conversion
- **Backup & restore** — a one-file `.rmbackup` archive with a consistent DB
  snapshot, plus a system-level full backup script
- **Self-hosted** — a single Go binary, served behind Caddy with automatic HTTPS

## Tech Stack

- **Backend** — Go, chi router, SQLite via modernc (pure Go, no CGO)
- **Frontend** — Vite, TypeScript, Three.js, Leaflet
- **Deployment** — systemd + Caddy

## Quick Start (local development)

Requirements: Go ≥ 1.26, Node.js ≥ 20.

```bash
# 1. Backend (run from server/): copy the config template, start the server
cp ../config.example.toml ../config.toml
go run ./cmd/roundmemo -config ../config.toml

# 2. Frontend dev server
cd web && npm ci && npm run dev
```

`storage.data_dir` is resolved relative to the working directory — if you run
the server from elsewhere, point `data_dir` at an absolute path in `config.toml`.

For local `http://127.0.0.1` debugging, set `secure_cookies = false` in
`config.toml` (the browser rejects Secure cookies over plain HTTP).

Create the owner account the first time (run from `server/`):

```bash
go run ./cmd/roundmemo -config ../config.toml owner create <username>
```

## Deployment

The deploy kit installs on a 1H1G VPS:

```bash
sudo bash deploy/install.sh --domain pano.example.com
```

The script walks you through the steps (or use flags to pre-fill them):

| Flag | Meaning |
|---|---|
| `--domain <domain>` | Public domain; also sets `public_base_url` to `https://<domain>` |
| `--data-dir <path>` | Data directory (default `/opt/roundmemo/data`) |
| `--listen <addr>` | Listen address (default `127.0.0.1:8787`, proxied by Caddy) |
| `--no-caddy` | Install binary + systemd only, skip Caddy |
| `--dry-run` | Print every write operation without touching the system |
| `--yes` | Skip all interactive prompts (use with the flags above) |

What it does:

1. Builds the backend binary (version injected via `ldflags`) and the frontend `dist`
2. Installs to `/opt/roundmemo/`, creates a `roundmemo` system user
3. Generates `config.toml` only on first install — an existing config is never
   overwritten; re-running runs an upgrade that updates only the binary, `dist`
   and the unit file (the previous binary and dist are each kept as one `.bak`)
4. Installs the systemd unit and starts the service
5. Writes your domain into the Caddy site config (automatic HTTPS via Let's Encrypt)

Then create the owner account on the server:

```bash
sudo -u roundmemo /opt/roundmemo/roundmemo owner create <username>
```

The script does **not** auto-install Go, Node or Caddy — it prints the install
command for whatever is missing and exits, so it never installs anything else
in the background.

## Backup & Restore

- **System-level** (`deploy/backup.sh`) — a full backup: a consistent SQLite
  snapshot taken via `.backup`, plus originals, thumbnails and the
  image-signing key, packed into a timestamped archive.

  ```bash
  bash deploy/backup.sh --dest /var/backups/roundmemo --keep 7
  ```

  Add a cron entry to run it daily; rsync the archives off-machine for off-site
  redundancy.

- **In-app** — the Owner admin "Backup" page creates a single `.rmbackup`
  archive that can be downloaded and restored from the UI, including on a fresh
  machine.

## Configuration

| Key | Meaning |
|---|---|
| `server.listen` | Listen address; Caddy proxies here |
| `server.public_base_url` | Public base URL used to generate share links |
| `server.secure_cookies` | Must be `true` under HTTPS, `false` for local `http://` |
| `storage.data_dir` | Runtime data root (originals, thumbnails, database) |
| `security.code_rate_per_hour` | Numeric-code attempt rate limit per IP per hour |
| `security.session_ttl_days` | Visitor session lifetime (days) |
| `security.admin_session_ttl_days` | Owner session lifetime (days) |
| `security.img_sig_ttl_seconds` | Image-distribution signature lifetime (seconds) |

## Roadmap

**Shipped in v1.0.0** — photo pool, groups & grants, panorama viewer,
map view, backup/restore, admin UI, liquid-glass interface.

**Up next**

- S3-compatible object storage
- Gyroscope polish
- Desktop / mobile evaluation

**Longer term**

- Static file encryption
- High-resolution tiled LOD for the viewer
- Multi-instance deployment

## Engineering

- Conventional Commits, GitHub Flow
- CI runs `gofmt`, `go vet`, `go test`, `go build`, and a frontend type-check +
  Vite build

## License

[AGPL-3.0](LICENSE) — a strong copyleft license: if you run RoundMemo as a
service, modifications you make to it must be made available under the same
license.
