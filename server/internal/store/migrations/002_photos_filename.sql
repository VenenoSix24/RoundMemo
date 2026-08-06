-- 照片增加原始文件名：未设标题时前端用文件名兜底展示（需求：管理端没设置标题就显示文件名）。
ALTER TABLE photos ADD COLUMN filename TEXT;
