package api

import (
	"database/sql"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"roundmemo/internal/config"
	"roundmemo/internal/storage"
	"roundmemo/internal/version"
)

// Server 持有各 handler 共享的依赖。所有状态显式传入，便于测试注入。
type Server struct {
	db      *sql.DB
	cfg     *config.Config
	logger  *slog.Logger
	storage storage.Storage
}

func NewServer(db *sql.DB, cfg *config.Config, logger *slog.Logger, st storage.Storage) *Server {
	return &Server{db: db, cfg: cfg, logger: logger, storage: st}
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

	r.Route("/api/admin", func(r chi.Router) {
		// 常规管理动作：20s 超时兜底。
		r.Group(func(r chi.Router) {
			r.Use(middleware.Timeout(20 * time.Second))
			r.Post("/login", s.handleAdminLogin)

			r.Group(func(r chi.Router) {
				r.Use(s.requireAdmin)
				r.Get("/albums", s.handleListAlbums)
				r.Post("/albums", s.handleCreateAlbum)
				r.Patch("/albums/{id}", s.handleUpdateAlbum)
				r.Delete("/albums/{id}", s.handleDeleteAlbum)
				r.Patch("/photos/{id}", s.handleUpdatePhoto)

				r.Get("/groups", s.handleListGroups)
				r.Post("/groups", s.handleCreateGroup)
				r.Patch("/groups/{id}", s.handleUpdateGroup)
				r.Delete("/groups/{id}", s.handleDeleteGroup)
				r.Post("/groups/{id}/albums", s.handleBindAlbums)
				r.Delete("/groups/{id}/albums/{albumId}", s.handleUnbindAlbum)
			})
		})

		// 导入/上传：不做超时，批量大文件可能远超 20s（开发文档 §15 风险项）。
		r.Group(func(r chi.Router) {
			r.Use(s.requireAdmin)
			r.Post("/albums/{id}/photos", s.handleUploadPhotos)
			r.Post("/import/local", s.handleImportLocal)
		})
	})

	return r
}

func (s *Server) internalError(w http.ResponseWriter, err error) {
	s.logger.Error("内部错误", "err", err)
	writeError(w, http.StatusInternalServerError, "服务器内部错误")
}
