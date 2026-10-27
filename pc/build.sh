#!/usr/bin/env bash
# PC 버전 만들기: 캘린더 화면(../index.html)을 복사해 PC용으로 고치고, Windows·Mac 실행 파일을 만든다.
set -euo pipefail
cd "$(dirname "$0")"
python3 - <<'PY'
import re
s = open("../index.html", encoding="utf-8").read()
# 아이폰 앱의 fishing:// 주소 이동 → PC 본체(host.js) 호출
s, n = re.subn(r'location\.href=("fishing://[^;}]*?)(?=[;}])', r'window.__host(\1)', s)
assert n == 4, n
s = s.replace("저장한 뒤 아이폰 홈 화면에 Scriptable 위젯을 추가하고, 위젯 설정에서 이 스크립트를 고르면 동작해요. iOS가 위젯을 새로 고치는 때에 맞춰 확인해서, 간격보다 조금 늦어질 수 있어요.",
              "PC 버전은 이 캘린더 탭이 열려 있는 동안만 정해 둔 간격으로 확인하고, 조건에 맞는 자리가 생기면 데스크톱 알림을 띄워요. 처음 켤 때 브라우저가 알림 허용을 물으면 '허용'을 누르세요.")
s = s.replace("'지금 확인'을 누르면 아이폰의 Scriptable 앱이 열리면서 아이폰이 직접 네 선사 예약 화면을 한 번 읽어 옵니다(컴퓨터·Claude 필요 없음).",
              "'지금 확인'을 누르면 이 PC가 직접 네 선사 예약 화면을 한 번 읽어 옵니다(Claude 필요 없음). 결과는 이 PC에만 저장됩니다.")
s = s.replace("<title>", "<title>PC · ", 1)
# 알림 기준에 '예약이 새로 열리면' 추가 (PC 버전만)
o = '<label><input type="radio" name="wMode" value="reopen"> 취소로 다시 열린 자리만</label>'
assert o in s
if 'value="open"' not in s:
    s = s.replace(o, o + '\n          <label><input type="radio" name="wMode" value="open"> 아직 안 열린 예약이 새로 열리면</label>')
open("web/index.html", "w", encoding="utf-8").write(s)
PY
mkdir -p dist
[ -f go.mod ] || go mod init fishing-pc >/dev/null 2>&1
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w -H=windowsgui" -o "dist/fishing-seats.exe" .
GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags "-s -w" -o "dist/fishing-seats-mac-apple" .
GOOS=darwin GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o "dist/fishing-seats-mac-intel" .
go build -trimpath -o dist/fishing-linux .
ls -la dist
