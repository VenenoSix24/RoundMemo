package api

import (
	"database/sql"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"roundmemo/internal/config"
	"roundmemo/internal/storage"
	"roundmemo/internal/version"
)

// Server 持有各 handler 共享的依赖。所有状态显式传入，便于测试注入。
type Server struct {
	db          *sql.DB
	cfg         *config.Config
	logger      *slog.Logger
	storage     storage.Storage
	secret      []byte
	codeLimiter *rateLimiter
}

func NewServer(db *sql.DB, cfg *config.Config, logger *slog.Logger, st storage.Storage, secret []byte) *Server {
	return &Server{
		db: db, cfg: cfg, logger: logger, storage: st, secret: secret,
		codeLimiter: newRateLimiter(time.Hour, cfg.Security.CodeRatePerHour),
	}
}

// Router 组装全量路由与中间件。
func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Logger)

	r.Get("/api/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{
			"status":  "ok",
			"service": "roundmemo",
			"version": version.Version,
		})
	})

	// 访客：双解锁 + 会话 + 可见内容（受会话 group 约束），常规 20s 超时。
	r.Route("/api", func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(middleware.Timeout(20 * time.Second))
			r.Post("/access/code", s.handleUnlockByCode)
			r.Post("/access/token", s.handleUnlockByToken)
			r.Get("/session", s.handleSessionInfo)
			r.Post("/session/revoke", s.handleRevokeSession)

			r.Get("/albums", s.handleVisitorAlbums)
			r.Get("/albums/{id}", s.handleVisitorAlbum)
			r.Get("/photos/{id}", s.handleVisitorPhoto)
			r.Get("/timeline", s.handleVisitorTimeline)
		})
	})

	// 图片鉴权分发：不套超时，大图流式与 Range 不能被切断。
	r.Get("/img/{kind}/{sha}", s.handleImage)

	r.Route("/api/admin", func(r chi.Router) {
		// 常规管理动作：20s 超时兜底。
		r.Group(func(r chi.Router) {
			r.Use(middleware.Timeout(20 * time.Second))
			r.Post("/login", s.handleAdminLogin)

			r.Group(func(r chi.Router) {
				r.Use(s.requireAdmin)
				r.Get("/session", s.handleAdminWhoami)
				r.Post("/logout", s.handleAdminLogout)
				r.Get("/albums", s.handleListAlbums)
				r.Post("/albums", s.handleCreateAlbum)
				r.Patch("/albums/{id}", s.handleUpdateAlbum)
				r.Delete("/albums/{id}", s.handleDeleteAlbum)
				r.Get("/albums/{id}/photos", s.handleListAlbumPhotos)
				r.Post("/albums/{id}/cover", s.handleSetAlbumCover)
				r.Patch("/photos/{id}", s.handleUpdatePhoto)
				r.Post("/account", s.handleAdminAccount)

				r.Get("/groups", s.handleListGroups)
				r.Post("/groups", s.handleCreateGroup)
				r.Patch("/groups/{id}", s.handleUpdateGroup)
				r.Delete("/groups/{id}", s.handleDeleteGroup)
				r.Post("/groups/{id}/albums", s.handleBindAlbums)
				r.Delete("/groups/{id}/albums/{albumId}", s.handleUnbindAlbum)

				r.Get("/grants", s.handleListGrants)
				r.Post("/grants", s.handleCreateGrant)
				r.Patch("/grants/{id}", s.handleUpdateGrant)
				r.Delete("/grants/{id}", s.handleDeleteGrant)
				r.Get("/grants/{id}/sessions", s.handleGrantSessions)
				r.Delete("/sessions/{sid}", s.handleDeleteSession)
			})
		})

		// 导入/上传：不做超时，批量大文件可能远超 20s（开发文档 §15 风险项）。
		r.Group(func(r chi.Router) {
			r.Use(s.requireAdmin)
			r.Post("/albums/{id}/photos", s.handleUploadPhotos)
			r.Post("/import/local", s.handleImportLocal)
		})
	})

	// SPA 静态托管：/api、/img 已在上方注册，这里只兜底前端与深链接。
	s.mountStatic(r)

	return r
}

// mountStatic 服务 web/dist 前端：存在则按静态文件 + SPA 兜底，缺失则给占位提示。
// 生产部署把 dist 与二进制放同目录（web/dist）即可（阶段 8 会处理 embed）。
func (s *Server) mountStatic(r chi.Router) {
	dist := filepath.Join("web", "dist")
	if _, err := os.Stat(dist); err != nil {
		r.Get("/*", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusOK, map[string]string{
				"service": "roundmemo",
				"hint":    "前端未构建，请先 cd web && npm run build",
			})
		})
		return
	}
	r.Get("/*", func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/" {
			http.ServeFile(w, req, filepath.Join(dist, "index.html"))
			return
		}
		clean := filepath.Clean("/" + req.URL.Path)
		full := filepath.Join(dist, clean)
		// 防越界：清理后的路径必须仍位于 dist 内
		if !strings.HasPrefix(full, filepath.Clean(dist)+string(os.PathSeparator)) {
			http.NotFound(w, req)
			return
		}
		if fi, err := os.Stat(full); err == nil && !fi.IsDir() {
			http.ServeFile(w, req, full)
			return
		}
		// SPA 兜底：深链接（/a/1、/p/2、/s/token）刷新时回 index.html
		http.ServeFile(w, req, filepath.Join(dist, "index.html"))
	})
}

func (s *Server) internalError(w http.ResponseWriter, err error) {
	s.logger.Error("内部错误", "err", err)
	writeError(w, http.StatusInternalServerError, "服务器内部错误")
}
