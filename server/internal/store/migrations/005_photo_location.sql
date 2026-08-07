-- 照片自定义地点名：手动录入的地点优先于经纬度反查展示。
-- 反查链：自定义地点 → 经纬度反查 → 无；
ALTER TABLE photos ADD COLUMN location_name TEXT;
