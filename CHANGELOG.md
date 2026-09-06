# Changelog

All notable changes to RoundMemo are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-09-06

### Added

- Gyroscope viewer rebuilt on W3C-standard quaternion orientation with
  per-frame smoothing: stable in portrait, landscape and near-upright holds,
  view follows phone movement one-to-one
- Recenter offset applied in world frame: enabling gyroscope no longer jumps,
  reset (button / double-click / Esc) eases back to the default heading while
  staying in gyroscope mode, photo switches enter at the device's current heading
- Gyroscope toggle button visibility follows sensor API availability; enabling
  on sensor-less devices times out and falls back with a toast
- Optional self-signed HTTPS dev server (`DEV_HTTPS=1`) for on-device sensor
  testing, which requires a secure context

### Fixed

- `/img` delivery now accepts a valid admin session; admin pages previously
  got 404 thumbnails because only visitor sessions and signed URLs were honored
- `album_ids` of photos not in any album is serialized as `[]` instead of
  `null`, which crashed the admin photo pool page

## [1.0.0] - 2026-08-07

First stable release. A private, self-hostable 360° panorama memorial album:
import photos, organize them into albums and groups, share with guests via
grants, and browse with a full-screen panorama viewer or a GPS-clustered map.

### Added

- Backend skeleton: chi router + SQLite (modernc, pure Go) + TOML config
- Data model: owners, albums, photos, groups, grants, sessions
- Owner login and album/group CRUD
- Photo import: HTTP upload and server-directory scan, EXIF extraction,
  thumbnail generation, filesystem storage
- Grant-based access control: share links with a numeric code, per-grant
  enable/switch/expiry/usage cap/revocation, session cookies that survive refresh
- Authenticated image distribution with expiring URL signatures
- Photo metadata editing (shot time, location, location name)
- Visitor frontend with an equirectangular panorama viewer: drag, wheel zoom,
  pinch, gyroscope on supported mobile devices
- Cinematic light entry page with a three-chapter scroll narrative
- Owner admin UI: login, albums, groups, grants, import, sessions
- Photo pool model: photos are uploaded into a pool and picked into multiple
  albums (many-to-many), removing from an album no longer deletes the original
- Browse page polish and site-wide animations
- Backup/restore: `.rmbackup` archive bundles a consistent DB snapshot
  (data-only or data + originals)
- Custom photo location name, shown in timeline and viewer with coordinate fallback
- Liquid-glass docks and sliding tab indicators
- Map view with configurable tile source (AMap / OpenStreetMap / custom),
  GCJ-02 ↔ WGS-84 coordinate conversion, GPS clustering, high-DPR tiles
- Photo-switch fade-through transition with a branded "entering this moment"
  overlay in the viewer

### Fixed

- Viewer not re-rendering on photo switch (per-frame dirty flag was never set)
- View reset now also resets zoom (camera FOV)
- Visitor dock floating with page content on scroll
- Refresh on a protected page landing back at the entry
- Entry code card hidden while the mobile keyboard is open
- GCJ-02 conversion offset in the map (misused Baidu BD-09 constant)
- Street names invisible in dark mode (map tile brightness filter)
- Blurry map text on high-DPR phones (adaptive high-resolution tiles)
- Old photo "jumping" before the switch transition
- Shot time derived from filename when EXIF lacks it
- Android photo-sphere timestamp parsing

### Changed

- Entry page moved to a light warm-paper palette (supersedes the earlier
  dark-first design direction)
- Photos no longer belong to a single album; they live in a pool
- Viewer back button uses history.back() to return to the source page
- Default map source is the AMap style-8 clean road network
