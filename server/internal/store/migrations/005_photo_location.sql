-- 照片自定义地点名：手动录入的地点优先于（未来的）经纬度反查展示。
-- 反查链（阶段规划）：自定义地点 → 经纬度反查 → 无；本迁移只落库，反查不做。
ALTER TABLE photos ADD COLUMN location_name TEXT;
