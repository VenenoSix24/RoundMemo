-- 站点级设置（键值）。site_title / has_favicon 由 Owner 在后台配置，
-- 前端据此设置浏览器标签页标题与图标。
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
