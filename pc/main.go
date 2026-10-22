// 낚시배 빈자리 — PC 버전
//
// 실행하면 이 PC에서만 열리는 작은 웹 서버(127.0.0.1)를 띄우고 기본 브라우저로 캘린더를 엽니다.
// 브라우저는 다른 사이트를 직접 읽지 못하게 막혀 있어서, 이 프로그램이 네 선사 예약 화면을 대신 받아 줍니다.
//   - 받아 오는 곳은 네 선사(+ 처음 실행 때 웹 캘린더의 마지막 결과)로 고정
//   - 사이트마다 요청은 한 번에 하나, 0.3초 간격
//   - 결과·설정은 이 PC의 사용자 폴더에 저장 (Windows: %APPDATA%\fishing-seats-pc)
//   - 캘린더 탭을 모두 닫으면 몇 분 뒤 스스로 끝남
package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

//go:embed web
var webFS embed.FS

const addr = "127.0.0.1:47321"

var allowed = map[string]bool{
	"lukina.sunsang24.com":      true,
	"dyfishing.sunsang24.com":   true,
	"khanfishing.com":           true,
	"jnaksi.com":                true,
	"raw.githubusercontent.com": true,
}

var boatsAll = []string{"루키나 2호", "루키나호", "팀에프원", "팀에프투", "고트호", "와이파이호", "욜로호", "시크릿호", "베스트1호", "베스트3호", "제트호", "왕만두호", "모비딕호", "마루호", "스모키호", "로또호"}

var (
	dataDir  string
	client   = &http.Client{Timeout: 30 * time.Second}
	hostMu   = map[string]*sync.Mutex{}
	hostLast = map[string]time.Time{}
	mapMu    sync.Mutex
	lastPing = time.Now()
	pingMu   sync.Mutex
	stripRe  = regexp.MustCompile(`(?is)<script\b.*?</script>|<style\b.*?</style>|<!--.*?-->`)
	storeOK  = regexp.MustCompile(`^(seats|settings|watch-state)$`)
)

func main() {
	base, err := os.UserConfigDir()
	if err != nil {
		base = "."
	}
	dataDir = filepath.Join(base, "fishing-seats-pc")
	_ = os.MkdirAll(dataDir, 0o755)
	if f, err := os.OpenFile(filepath.Join(dataDir, "log.txt"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644); err == nil {
		log.SetOutput(f)
	}

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		// 이미 실행 중이면 브라우저만 다시 연다
		if r, e := http.Get("http://" + addr + "/api/ping"); e == nil {
			r.Body.Close()
			openBrowser("http://" + addr + "/")
			return
		}
		log.Fatalf("포트 %s를 열 수 없습니다: %v", addr, err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", serveIndex)
	sub, _ := fs.Sub(webFS, "web")
	mux.Handle("/host.js", http.FileServer(http.FS(sub)))
	mux.HandleFunc("/api/ping", func(w http.ResponseWriter, r *http.Request) {
		pingMu.Lock()
		lastPing = time.Now()
		pingMu.Unlock()
		io.WriteString(w, "fishing")
	})
	mux.HandleFunc("/api/fetch", serveFetch)
	mux.HandleFunc("/api/store/", serveStore)

	// 탭이 모두 닫혀 한동안 연락이 없으면 종료 (백그라운드 탭은 1분에 한 번만 연락할 수 있어 넉넉히)
	go func() {
		for range time.Tick(30 * time.Second) {
			pingMu.Lock()
			idle := time.Since(lastPing)
			pingMu.Unlock()
			if idle > 4*time.Minute {
				log.Println("캘린더 탭이 닫혀 종료합니다")
				os.Exit(0)
			}
		}
	}()

	go func() { time.Sleep(300 * time.Millisecond); openBrowser("http://" + addr + "/") }()
	log.Printf("실행 중: http://%s/ (데이터 폴더 %s)", addr, dataDir)
	log.Fatal(http.Serve(ln, mux))
}

// 캘린더 화면: 저장해 둔 결과와 설정을 넣어서 준다
func serveIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	b, _ := webFS.ReadFile("web/index.html")
	seats := readStore("seats")
	if seats == "null" {
		// 처음 실행: 웹 캘린더의 마지막 결과로 먼저 보여 준다 (실패해도 괜찮음)
		if t, err := fetchText("https://raw.githubusercontent.com/sclee00/calendar/main/data/seats.json", false); err == nil && json.Valid([]byte(t)) {
			seats = t
		}
	}
	settings := readStore("settings")
	var st map[string]json.RawMessage
	_ = json.Unmarshal([]byte(settings), &st)
	ahead, watch := "1", "null"
	if v, ok := st["ahead"]; ok {
		ahead = string(v)
	}
	if v, ok := st["watch"]; ok {
		watch = string(v)
	}
	ba, _ := json.Marshal(boatsAll)
	inject := fmt.Sprintf(`<script>window.__inScriptable=true;window.__isPC=true;window.__seatsData=%s;window.__settings=%s;window.__checked=[];window.__ahead=%s;window.__watch=%s;window.__boatsAll=%s;</script>`,
		safeJS(seats), safeJS(settings), ahead, safeJS(watch), ba)
	html := strings.Replace(string(b), "<head>", "<head>"+inject, 1)
	html = strings.Replace(html, "</body>", `<script src="/host.js"></script></body>`, 1)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	io.WriteString(w, html)
}

func safeJS(s string) string {
	if strings.TrimSpace(s) == "" || !json.Valid([]byte(s)) {
		return "null"
	}
	return strings.ReplaceAll(s, "</", `<\/`)
}

// 선사 페이지 대신 받기
func serveFetch(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("url")
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || !allowed[strings.TrimPrefix(u.Hostname(), "www.")] {
		http.Error(w, "허용되지 않은 주소", http.StatusForbidden)
		return
	}
	t, err := fetchText(raw, true)
	if err != nil {
		log.Printf("받기 실패 %s: %v", raw, err)
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	io.WriteString(w, stripRe.ReplaceAllString(t, ""))
}

func fetchText(raw string, paced bool) (string, error) {
	u, _ := url.Parse(raw)
	h := u.Hostname()
	if paced {
		mapMu.Lock()
		m, ok := hostMu[h]
		if !ok {
			m = &sync.Mutex{}
			hostMu[h] = m
		}
		mapMu.Unlock()
		m.Lock()
		defer m.Unlock()
		mapMu.Lock()
		wait := 300*time.Millisecond - time.Since(hostLast[h])
		mapMu.Unlock()
		if wait > 0 {
			time.Sleep(wait)
		}
		defer func() { mapMu.Lock(); hostLast[h] = time.Now(); mapMu.Unlock() }()
	}
	req, _ := http.NewRequest("GET", raw, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36")
	req.Header.Set("Accept-Language", "ko-KR,ko;q=0.9")
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("연결 실패")
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return "", fmt.Errorf("읽기 실패")
	}
	return string(b), nil
}

// 결과·설정 저장
func serveStore(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/api/store/")
	if !storeOK.MatchString(name) {
		http.NotFound(w, r)
		return
	}
	switch r.Method {
	case http.MethodGet:
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, readStore(name))
	case http.MethodPut:
		b, err := io.ReadAll(io.LimitReader(r.Body, 16<<20))
		if err != nil || !json.Valid(b) {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		p := filepath.Join(dataDir, name+".json")
		tmp := p + ".tmp"
		if err := os.WriteFile(tmp, b, 0o644); err == nil {
			_ = os.Rename(tmp, p)
		}
		io.WriteString(w, "ok")
	default:
		http.Error(w, "method", http.StatusMethodNotAllowed)
	}
}

func readStore(name string) string {
	b, err := os.ReadFile(filepath.Join(dataDir, name+".json"))
	if err != nil || !json.Valid(b) {
		return "null"
	}
	return string(b)
}

func openBrowser(u string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", u)
	case "darwin":
		cmd = exec.Command("open", u)
	default:
		cmd = exec.Command("xdg-open", u)
	}
	_ = cmd.Start()
}
