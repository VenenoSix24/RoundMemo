package main

import (
	"bufio"
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"golang.org/x/term"

	"roundmemo/internal/api"
	"roundmemo/internal/auth"
	"roundmemo/internal/config"
	"roundmemo/internal/storage"
	"roundmemo/internal/store"
	"roundmemo/internal/version"
)

func main() {
	var cfgPath string
	flag.StringVar(&cfgPath, "config", "config.toml", "配置文件路径")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	cfg, err := config.Load(cfgPath)
	if err != nil {
		logger.Error("加载配置失败", "err", err)
		os.Exit(1)
	}

	if err := os.MkdirAll(cfg.Storage.DataDir, 0o750); err != nil {
		logger.Error("准备数据目录失败", "err", err)
		os.Exit(1)
	}

	db, err := store.Open(cfg.Database.Path)
	if err != nil {
		logger.Error("打开数据库失败", "err", err)
		os.Exit(1)
	}
	defer db.Close()

	if err := store.Migrate(db); err != nil {
		logger.Error("数据库迁移失败", "err", err)
		os.Exit(1)
	}

	if args := flag.Args(); len(args) > 0 {
		switch args[0] {
		case "owner":
			if err := runOwnerCmd(db, args[1:]); err != nil {
				fmt.Fprintln(os.Stderr, err)
				os.Exit(1)
			}
			return
		case "help", "-h", "--help":
			printUsage()
			return
		default:
			fmt.Fprintf(os.Stderr, "未知子命令 %q\n", args[0])
			printUsage()
			os.Exit(2)
		}
	}

	st, err := storage.NewFS(cfg.Storage.DataDir)
	if err != nil {
		logger.Error("初始化存储失败", "err", err)
		os.Exit(1)
	}

	// 大上传与图片流式分发不能套全局 Read/WriteTimeout（会切断慢请求），
	// 常规请求的限时由路由层的 chi Timeout 中间件承担。
	srv := &http.Server{
		Addr:              cfg.Server.Listen,
		Handler:           api.NewServer(db, cfg, logger, st).Router(),
		ReadHeaderTimeout: 15 * time.Second,
	}

	// 优雅停机：SIGTERM/SIGINT 后最多等 10s 排空在途请求，避免服务重启打断正在看的全景。
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		logger.Info("roundmemo 启动", "version", version.Version, "addr", cfg.Server.Listen)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("HTTP 服务异常退出", "err", err)
			stop <- syscall.SIGTERM
		}
	}()

	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("优雅停机失败", "err", err)
	}
}

// runOwnerCmd 支持 owner create <username>：交互式设密，建人或改密二合一。
// 密码走终端隐藏输入，不落命令行参数（避免 shell history 泄露）。
func runOwnerCmd(db *sql.DB, args []string) error {
	if len(args) < 2 || args[0] != "create" {
		return fmt.Errorf("用法: roundmemo owner create <username>")
	}
	username := args[1]

	pw1, err := promptPassword("输入密码: ")
	if err != nil {
		return err
	}
	if len(pw1) < 8 {
		return fmt.Errorf("密码至少 8 位")
	}
	pw2, err := promptPassword("确认密码: ")
	if err != nil {
		return err
	}
	if pw1 != pw2 {
		return fmt.Errorf("两次密码不一致")
	}

	hash, err := auth.HashPassword(pw1)
	if err != nil {
		return fmt.Errorf("计算密码哈希: %w", err)
	}
	id, err := store.UpsertOwner(db, username, hash)
	if err != nil {
		return fmt.Errorf("写入 Owner: %w", err)
	}
	fmt.Printf("Owner %q 已就绪 (id=%d)\n", username, id)
	return nil
}

// stdinScanner 在非终端路径下跨多次 promptPassword 复用：
// bufio.Scanner 会一次性把管道内容读进内部缓冲，重复新建会丢行。
var stdinScanner *bufio.Scanner

func promptPassword(prompt string) (string, error) {
	fmt.Fprint(os.Stderr, prompt)
	if term.IsTerminal(int(os.Stdin.Fd())) {
		b, err := term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Fprintln(os.Stderr)
		if err != nil {
			return "", err
		}
		return string(b), nil
	}
	// 非终端（管道/CI）时退化为读一行，便于脚本化。
	if stdinScanner == nil {
		stdinScanner = bufio.NewScanner(os.Stdin)
	}
	if !stdinScanner.Scan() {
		return "", errors.New("未读到密码输入")
	}
	return stdinScanner.Text(), nil
}

func printUsage() {
	fmt.Println(`用法: roundmemo [子命令] -config <path>

子命令:
  owner create <username>   创建或重置 Owner 账号（交互式输密）
  help                     显示本帮助

无子命令时以服务模式运行。`)
}
