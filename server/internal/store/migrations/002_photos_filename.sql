-- 照片增加原始文件名：未设标题时前端用文件名兜底展示。
ALTER TABLE photos ADD COLUMN filename TEXT;
