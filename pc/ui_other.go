//go:build !windows

package main

import "errors"

// Mac·리눅스: 지금처럼 Chrome/Edge '앱 창'으로 연다
func runUI(u string) {
	openBrowser(u)
	select {}
}

func allowForeground()        {}
func autostartState() string  { return "unsupported" }
func setAutostart(bool) error { return errors.New("이 운영체제에서는 지원하지 않아요") }
