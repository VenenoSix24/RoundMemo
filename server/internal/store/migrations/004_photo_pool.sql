-- 照片池模型：照片不再属于单一相册，上传一律进"照片池"；
-- 相册通过 album_photos 引用池中照片，一张照片可属多个相册。
-- 回填现有归属后删除 photos.album_id 列（SQLite 3.35+ 支持 DROP COLUMN）。
CREATE TABLE album_photos (
  album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(album_id, photo_id)
);
CREATE INDEX idx_album_photos_photo ON album_photos(photo_id);

-- 回填现有归属：photos.album_id → album_photos
INSERT INTO album_photos(album_id, photo_id, position)
  SELECT album_id, id, 0 FROM photos WHERE album_id IS NOT NULL;

-- 移除旧归属列（先删依赖索引，SQLite 3.35+ 支持 DROP COLUMN）
DROP INDEX IF EXISTS idx_photos_album;
ALTER TABLE photos DROP COLUMN album_id;
