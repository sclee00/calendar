#!/usr/bin/env bash
# PC 버전 만들기: 캘린더 화면(../index.html)을 복사해 PC용으로 고치고, Windows·Mac 실행 파일을 만든다.
set -euo pipefail
cd "$(dirname "$0")"
python3 - <<'PY'
import re
s = open("../index.html", encoding="utf-8").read()
# 아이폰 앱의 fishing:// 주소 이동 → PC 본체(host.js) 호출
s, n = re.subn(r'location\.href=("fishing://[^;}]*?)(?=[;}])', r'window.__host(\1)', s)
assert n == 15, n
s = s.replace("앱을 닫아 둔 동안에도 확인하려면 단축어 앱의 '자동화'에 이 스크립트를 정해 둔 시각마다 실행하도록 넣어 두세요(그때는 이 간격 대신 자동화 시각에 확인). 홈 화면에 Scriptable 위젯을 두면 iOS가 위젯을 새로 고칠 때도 확인해요.",
              "PC 버전은 이 캘린더 탭이 열려 있는 동안만 정해 둔 간격으로 확인하고, 조건에 맞는 자리가 생기면 데스크톱 알림을 띄워요. 처음 켤 때 브라우저가 알림 허용을 물으면 '허용'을 누르세요.")
s = s.replace("'지금 확인'을 누르면 아이폰의 Scriptable 앱이 열리면서 아이폰이 직접 네 선사 예약 화면을 한 번 읽어 옵니다(컴퓨터·Claude 필요 없음).",
              "'지금 확인'을 누르면 이 PC가 직접 네 선사 예약 화면을 한 번 읽어 옵니다(Claude 필요 없음). 결과는 이 PC에만 저장됩니다.")
s = s.replace("<title>", "<title>PC · ", 1)
open("web/index.html", "w", encoding="utf-8").write(s)
PY
cp icon/fish.png web/icon-180.png # 앱 창·탭 아이콘도 물고기
mkdir -p dist
VER="${PC_VERSION:-$(date +%Y%m%d.%H%M)}"
[ -f go.mod ] || go mod init fishing-pc >/dev/null 2>&1
# Windows 실행 파일 아이콘(물고기): icon/fish.ico → rsrc_windows_amd64.syso (저장소에 함께 넣어 둠, 아이콘을 바꿨을 때만 다시 만듦)
if [ ! -f rsrc_windows_amd64.syso ] || [ icon/fish.ico -nt rsrc_windows_amd64.syso ]; then go run github.com/akavel/rsrc@v0.10.2 -ico icon/fish.ico -o rsrc_windows_amd64.syso; fi
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w -H=windowsgui -X main.version=$VER" -o "dist/fishing-seats.exe" .
GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags "-s -w -X main.version=$VER" -o "dist/fishing-seats-mac-apple" .
GOOS=darwin GOARCH=amd64 go build -trimpath -ldflags "-s -w -X main.version=$VER" -o "dist/fishing-seats-mac-intel" .
go build -trimpath -ldflags "-X main.version=$VER" -o dist/fishing-linux .
ls -la dist
