# 연안부두 낚시배 빈자리

인천 연안부두 20인승 낚시배 16척(루키나·동양낚시마트·칸피싱·제일바다낚시)의 날짜별 빈자리와 인천 물때·고저차를 한 달 단위 캘린더로 보여줍니다.

- 웹 캘린더: https://sclee00.github.io/calendar/ (`index.html`)
- 데이터: `data/seats.json`, 물때·고저차: `data/tide.json` (국립해양조사원 자료, 바다타임 인천)
- **확인(수집)은 아이폰에서**: 칸피싱·제일바다낚시는 해외 접속을 막아서 GitHub 서버로는 읽을 수 없습니다. 아이폰의 Scriptable 앱이 한국 통신망으로 네 선사 예약 화면을 직접 읽습니다(`scriptable/fishing.js`). 정해진 시간마다 자동으로 확인하지 않습니다. 실행하면 이번 달부터 3개월만 확인하고, 캘린더를 그 뒤 달로 넘기면 그 달만 추가로 확인합니다.

## 아이폰 설치 (처음 한 번)

1. App Store에서 **Scriptable**(무료)을 설치합니다.
2. Scriptable을 열고 오른쪽 위 **+** 를 눌러 새 스크립트를 만듭니다.
3. 위쪽 제목을 눌러 이름을 **낚시배 빈자리** 로 바꿉니다(웹의 '지금 확인' 버튼이 이 이름으로 찾습니다).
4. `scriptable/loader.js` 내용을 그대로 붙여 넣고 **Done**.
5. 스크립트를 한 번 눌러 실행합니다. 캘린더가 뜨고 위쪽에 "확인 중"이 표시된 뒤 새 결과로 바뀝니다.
6. (선택) 처음 실행할 때 "웹 캘린더에도 올릴까요?"가 나옵니다. GitHub 토큰을 넣으면 확인 결과가 웹 캘린더에도 반영됩니다. 아이폰에서만 볼 거면 '아이폰에서만'.
7. 홈 화면 아이콘: 스크립트를 길게 눌러 Share → **Add to Home Screen**.

### GitHub 토큰 만들기 (웹 반영을 원할 때만)

GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token
- Repository access: **Only select repositories** → `calendar`
- Permissions → Repository permissions → **Contents: Read and write**
- 만들어진 `github_pat_…` 값을 복사해 Scriptable 첫 실행 때 붙여 넣습니다(아이폰 키체인에만 저장됨).
- 나중에 넣거나 바꾸려면 Scriptable에서 스크립트를 다시 만들 필요 없이, 키체인 항목을 지우는 짧은 스크립트로 `Keychain.remove("fishing_github_asked")`를 실행한 뒤 다시 실행하면 됩니다.

## 그 밖의 파일

- `scripts/scrape.mjs`, `.github/workflows/update.yml`: GitHub에서 수동으로 돌리는 수집기(루키나·동양만 읽힘). 자동 일정은 없습니다.
