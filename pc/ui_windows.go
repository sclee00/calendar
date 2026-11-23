//go:build windows

package main

// Windows: 크롬 앱 창 대신 이 프로그램이 직접 창을 띄운다 (WebView2 — Windows 10·11에 기본으로 들어 있는 Edge 엔진).
// 창 크기·위치 기억, 작업 표시줄 물고기 아이콘, 윈도우 알림(알림 영역), 윈도우 시작할 때 자동 실행.
// WebView2가 없는 PC에서는 예전처럼 Chrome/Edge 앱 창으로 연다.

import (
	_ "embed"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

//go:embed icon/fish.ico
var fishICO []byte

func init() { runtime.LockOSThread() } // 창은 처음 스레드에서만 다룰 수 있음

var (
	user32                         = windows.NewLazySystemDLL("user32.dll")
	shell32                        = windows.NewLazySystemDLL("shell32.dll")
	pGetWindowRect                 = user32.NewProc("GetWindowRect")
	pSetWindowPos                  = user32.NewProc("SetWindowPos")
	pShowWindow                    = user32.NewProc("ShowWindow")
	pIsIconic                      = user32.NewProc("IsIconic")
	pIsZoomed                      = user32.NewProc("IsZoomed")
	pSetForegroundWindow           = user32.NewProc("SetForegroundWindow")
	pLoadImageW                    = user32.NewProc("LoadImageW")
	pSendMessageW                  = user32.NewProc("SendMessageW")
	pMonitorFromRect               = user32.NewProc("MonitorFromRect")
	pGetSystemMetrics              = user32.NewProc("GetSystemMetrics")
	pAllowSetForegroundWindow      = user32.NewProc("AllowSetForegroundWindow")
	pSetProcessDpiAwarenessContext = user32.NewProc("SetProcessDpiAwarenessContext")
	pFlashWindowEx                 = user32.NewProc("FlashWindowEx")
	pShellNotifyIconW              = shell32.NewProc("Shell_NotifyIconW")
)

type rect struct{ L, T, R, B int32 }

type winState struct {
	X, Y, W, H int32
	Max        bool
}

type notifyIconData struct {
	CbSize           uint32
	HWnd             uintptr
	UID              uint32
	UFlags           uint32
	UCallbackMessage uint32
	HIcon            uintptr
	SzTip            [128]uint16
	DwState          uint32
	DwStateMask      uint32
	SzInfo           [256]uint16
	UVersion         uint32
	SzInfoTitle      [64]uint16
	DwInfoFlags      uint32
	GuidItem         [16]byte
	HBalloonIcon     uintptr
}

type flashInfo struct {
	CbSize    uint32
	Hwnd      uintptr
	DwFlags   uint32
	UCount    uint32
	DwTimeout uint32
}

const runKey, runName = `Software\Microsoft\Windows\CurrentVersion\Run`, "FishingSeats"

var (
	iconBig, iconSmall uintptr
	stMu               sync.Mutex
)

// 화면(host.js)이 쓰기 전에 넣는 코드: 윈도우 알림·바깥 링크·창 배치를 이 프로그램이 맡는다
const nativeJS = `window.__native=true;
(()=>{class N{constructor(t,o){o=o||{};this.title=t;setTimeout(()=>{try{window.__nativeNotify(String(t),String(o.body||""),!!o.silent)}catch(e){}},0)}close(){}}
N.permission="granted";N.requestPermission=(cb)=>{if(cb)cb("granted");return Promise.resolve("granted")};window.Notification=N;
const ext=(u)=>{try{const x=new URL(u,location.href);if(/^https?:$/.test(x.protocol)&&x.host!==location.host){window.__openExternal(x.href);return true}}catch(e){}return false};
const op=window.open;window.open=(u,...a)=>ext(u)?null:op.call(window,u,...a);
document.addEventListener("click",e=>{const a=e.target&&e.target.closest&&e.target.closest("a[href]");if(a&&ext(a.href)){e.preventDefault();e.stopPropagation()}},true);})();`

func hasArg(a string) bool {
	for _, x := range os.Args[1:] {
		if strings.EqualFold(x, a) {
			return true
		}
	}
	return false
}

func runUI(u string) {
	autostart := hasArg("--autostart")
	fixAutostartPath()
	// 창이 가려지거나 내려가 있어도 빈자리 확인 타이머가 느려지지 않게
	_ = os.Setenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows")
	if pSetProcessDpiAwarenessContext.Find() == nil {
		pSetProcessDpiAwarenessContext.Call(^uintptr(3)) // 모니터별 배율(글자가 흐리지 않게)
	}
	st, ok := loadWin()
	w0, h0 := defaultSize()
	if sw, _, _ := pGetSystemMetrics.Call(0); ok && st.W <= int32(sw) {
		w0, h0 = st.W, st.H
	}
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		DataPath:      filepath.Join(dataDir, "webview2"),
		AutoFocus:     true,
		WindowOptions: webview2.WindowOptions{Title: "낚시배 빈자리 현황", Width: uint(w0), Height: uint(h0), Center: true},
	})
	if w == nil {
		log.Println("WebView2를 쓸 수 없어 브라우저 앱 창으로 엽니다")
		openBrowser(u)
		select {}
	}
	nativeUI = true
	hwnd := uintptr(w.Window())
	setIcons(hwnd)
	if ok {
		r := rect{st.X, st.Y, st.X + st.W, st.Y + st.H}
		if m, _, _ := pMonitorFromRect.Call(uintptr(unsafe.Pointer(&r)), 0); m != 0 { // 그 모니터가 아직 있을 때만
			pSetWindowPos.Call(hwnd, 0, uintptr(st.X), uintptr(st.Y), uintptr(st.W), uintptr(st.H), 0x14)
		}
	}
	if autostart {
		pShowWindow.Call(hwnd, 7) // 윈도우 시작 때는 작업 표시줄에 내려 둔 채로
	} else if ok && st.Max {
		pShowWindow.Call(hwnd, 3)
	}
	trayAdd(hwnd)

	_ = w.Bind("__winGet", func() map[string]int32 {
		var r rect
		pGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r)))
		return map[string]int32{"x": r.L, "y": r.T, "w": r.R - r.L, "h": r.B - r.T}
	})
	_ = w.Bind("__winSet", func(x, y, ww, hh float64) bool {
		if z, _, _ := pIsZoomed.Call(hwnd); z != 0 {
			pShowWindow.Call(hwnd, 9)
		}
		pSetWindowPos.Call(hwnd, 0, uintptr(int32(x)), uintptr(int32(y)), uintptr(int32(ww)), uintptr(int32(hh)), 0x4)
		return true
	})
	_ = w.Bind("__nativeNotify", func(title, body string, silent bool) bool {
		trayNotify(hwnd, title, body, silent)
		return true
	})
	_ = w.Bind("__openExternal", func(u string) bool {
		if strings.HasPrefix(u, "https://") || strings.HasPrefix(u, "http://") {
			_ = windows.ShellExecute(0, windows.StringToUTF16Ptr("open"), windows.StringToUTF16Ptr(u), nil, nil, 1)
		}
		return true
	})
	w.Init(nativeJS)
	showWindow = func() {
		w.Dispatch(func() {
			if i, _, _ := pIsIconic.Call(hwnd); i != 0 {
				pShowWindow.Call(hwnd, 9)
			}
			pShowWindow.Call(hwnd, 5)
			pSetForegroundWindow.Call(hwnd)
		})
	}
	go func() {
		for range time.Tick(2 * time.Second) {
			saveWin(hwnd)
		}
	}()
	w.Navigate(u + "?app=1")
	w.Run() // 창을 닫으면(X) 여기서 돌아옴
	trayDel(hwnd)
	os.Exit(0)
}

func defaultSize() (int32, int32) {
	sw, _, _ := pGetSystemMetrics.Call(16) // 작업 영역 너비
	sh, _, _ := pGetSystemMetrics.Call(17)
	w, h := int32(sw)*85/100, int32(sh)*90/100
	if w < 800 {
		w = 800
	}
	if h < 600 {
		h = 600
	}
	return w, h
}

func winFile() string { return filepath.Join(dataDir, "window.json") }

func loadWin() (winState, bool) {
	var s winState
	b, err := os.ReadFile(winFile())
	if err != nil || json.Unmarshal(b, &s) != nil || s.W < 300 || s.H < 300 {
		return s, false
	}
	return s, true
}

// 창 크기·위치를 2초마다 확인해서 바뀌었으면 기억 (최소화 중엔 그대로, 최대화는 표시만)
func saveWin(hwnd uintptr) {
	if i, _, _ := pIsIconic.Call(hwnd); i != 0 {
		return
	}
	stMu.Lock()
	defer stMu.Unlock()
	old, _ := loadWin()
	n := old
	if z, _, _ := pIsZoomed.Call(hwnd); z != 0 {
		n.Max = true
	} else {
		var r rect
		if ok, _, _ := pGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r))); ok == 0 {
			return
		}
		n = winState{r.L, r.T, r.R - r.L, r.B - r.T, false}
	}
	if n != old && n.W >= 300 && n.H >= 300 {
		b, _ := json.Marshal(n)
		_ = os.WriteFile(winFile(), b, 0o644)
	}
}

func setIcons(hwnd uintptr) {
	p := filepath.Join(dataDir, "fish.ico")
	_ = os.WriteFile(p, fishICO, 0o644)
	pp := windows.StringToUTF16Ptr(p)
	iconBig, _, _ = pLoadImageW.Call(0, uintptr(unsafe.Pointer(pp)), 1, 48, 48, 0x10)
	iconSmall, _, _ = pLoadImageW.Call(0, uintptr(unsafe.Pointer(pp)), 1, 16, 16, 0x10)
	if iconBig != 0 {
		pSendMessageW.Call(hwnd, 0x80, 1, iconBig)
	}
	if iconSmall != 0 {
		pSendMessageW.Call(hwnd, 0x80, 0, iconSmall)
	}
}

func copyUTF16(dst []uint16, s string) {
	u, _ := windows.UTF16FromString(s)
	if len(u) > len(dst) {
		u = append(u[:len(dst)-1], 0)
	}
	copy(dst, u)
}

func trayData(hwnd uintptr) notifyIconData {
	d := notifyIconData{HWnd: hwnd, UID: 1}
	d.CbSize = uint32(unsafe.Sizeof(d))
	return d
}

func trayAdd(hwnd uintptr) {
	d := trayData(hwnd)
	d.UFlags = 0x2 | 0x4 // 아이콘 · 툴팁
	d.HIcon = iconSmall
	copyUTF16(d.SzTip[:], "낚시배 빈자리 현황")
	pShellNotifyIconW.Call(0, uintptr(unsafe.Pointer(&d)))
}

func trayDel(hwnd uintptr) {
	d := trayData(hwnd)
	pShellNotifyIconW.Call(2, uintptr(unsafe.Pointer(&d)))
}

// 윈도우 알림(오른쪽 아래)으로 알리고, 작업 표시줄 아이콘도 깜박인다
func trayNotify(hwnd uintptr, title, body string, silent bool) {
	d := trayData(hwnd)
	d.UFlags = 0x10
	copyUTF16(d.SzInfoTitle[:], title)
	if body == "" {
		body = " "
	}
	copyUTF16(d.SzInfo[:], body)
	d.DwInfoFlags = 0x4 | 0x20 // 물고기 아이콘
	d.HBalloonIcon = iconBig
	if silent {
		d.DwInfoFlags |= 0x10
	}
	pShellNotifyIconW.Call(1, uintptr(unsafe.Pointer(&d)))
	f := flashInfo{Hwnd: hwnd, DwFlags: 0x2 | 0xC}
	f.CbSize = uint32(unsafe.Sizeof(f))
	pFlashWindowEx.Call(uintptr(unsafe.Pointer(&f)))
}

func allowForeground() { pAllowSetForegroundWindow.Call(^uintptr(0)) }

// ── 윈도우 시작할 때 자동 실행 (이 사용자 계정의 '시작 프로그램' 등록) ──
func autostartState() string {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.QUERY_VALUE)
	if err != nil {
		return "0"
	}
	defer k.Close()
	if _, _, err := k.GetStringValue(runName); err != nil {
		return "0"
	}
	return "1"
}

func setAutostart(on bool) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, runKey, registry.SET_VALUE|registry.QUERY_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	if !on {
		if err := k.DeleteValue(runName); err != nil && err != registry.ErrNotExist {
			return err
		}
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	return k.SetStringValue(runName, `"`+exe+`" --autostart`)
}

// 자동 실행을 켜 둔 채 새 버전(다른 파일)을 실행하면 자동 실행도 새 파일로 바꿔 둔다
func fixAutostartPath() {
	if autostartState() != "1" {
		return
	}
	k, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.QUERY_VALUE)
	if err != nil {
		return
	}
	v, _, _ := k.GetStringValue(runName)
	k.Close()
	if exe, err := os.Executable(); err == nil && !strings.Contains(strings.ToLower(v), strings.ToLower(exe)) {
		_ = setAutostart(true)
	}
}
