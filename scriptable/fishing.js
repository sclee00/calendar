// 연안부두 낚시배 빈자리 — 아이폰 Scriptable 본체
// 이 파일은 GitHub(sclee00/calendar)에 두고, Scriptable의 짧은 실행 코드(scriptable/loader.js)가 받아서 실행한다.
// 아이폰이 한국 통신망으로 네 선사 예약 화면을 직접 읽으므로 칸피싱·제일바다낚시의 해외 접속 차단에 걸리지 않는다.
// 자동으로 반복 확인하지 않는다. 실행(아이콘·"지금 확인")할 때 사이트마다 한 번, 요청은 1.2초 간격으로 하나씩.

const REPO = "sclee00/calendar";
const PAGE = "https://sclee00.github.io/calendar/";
const RAW = `https://raw.githubusercontent.com/${REPO}/main/`;
// 기본 선사. 설정 → 선사 관리에서 선사를 더하거나 빼면 settings.sites에 저장되고 그 목록을 쓴다.
// kind: ss = 선상24(○○.sunsang24.com), tf = 칸피싱·제일과 같은 예약 프로그램(index.php?mid=bk), bus = 시크릿 버스(낚시 버스 규칙)
const DEFAULT_SITES = [
  { id: "lukina", label: "루키나", kind: "ss", host: "lukina.sunsang24.com", boats: ["루키나 2호", "루키나호"] },
  { id: "dy", label: "동양낚시마트", kind: "ss", host: "dyfishing.sunsang24.com", boats: ["팀에프원", "팀에프투", "고트호"] },
  { id: "khan", label: "칸피싱", kind: "tf", step: 8, host: "khanfishing.com", boats: ["와이파이호", "욜로호", "시크릿호", "베스트1호", "베스트3호", "제트호", "왕만두호"] },
  { id: "jeil", label: "제일바다낚시", kind: "tf", step: 4, host: "jnaksi.com", boats: ["모비딕호", "마루호", "스모키호", "로또호"] },
  { id: "secret", label: "시크릿 버스", kind: "bus", step: 8, host: "secretbus.thefishing.kr", boats: ["전국 시크릿 블랙", "전국 시크릿 레드", "전국 시크릿 3호"] }, // 시크릿 피싱 클럽(낚시 버스)
];
let SITES = [], KEEP = [], NOTICE_SITES = [];
// 선사 목록 적용: boats는 이름 목록(SITES[].boats)과 자세한 정보(SITES[].info: 이름·아이콘 글자·배 번호)로 나눠 둔다
function applySites(list) {
  const ok = Array.isArray(list) && list.some((x) => x && x.host && Array.isArray(x.boats) && x.boats.length);
  const src = ok ? list.filter((x) => x && x.host && Array.isArray(x.boats) && x.boats.length) : DEFAULT_SITES;
  SITES = src.map((x) => {
    const info = x.boats.map((b) => (typeof b === "string" ? { name: b } : b)).filter((b) => b && b.name);
    return { id: x.id, label: x.label || x.host, kind: x.kind === "ss" || x.kind === "bus" ? x.kind : "tf", host: x.host, step: x.step || (x.kind === "ss" ? undefined : 4), info, boats: info.map((b) => b.name) };
  });
  KEEP = SITES.flatMap((x) => x.boats);
  NOTICE_SITES = SITES.map((x) => x.kind === "ss"
    ? { id: x.id, label: x.label, kind: "ss", list: `https://${x.host}/ship/event_list` }
    : { id: x.id, label: x.label, kind: "tf", home: `https://${x.host}/` });
}
applySites(DEFAULT_SITES);
// 읽는 규칙이 바뀌면 올림 → 앱을 열 때 '최근 결과라 건너뛰기'를 하지 않고 새로 확인
const PARSE_V = 10;
// 읽는 규칙이 바뀐 뒤 처음이면, 출조 버스는 예전 규칙으로 받아 둔 결과를 버린다 (새로 확인할 때까지 옛 아이콘이 남지 않게)
function dropStale(d) {
  if (!d || d.pv === PARSE_V) return d;
  const bus = SITES.filter((s) => s.kind === "bus").flatMap((s) => s.boats);
  for (const M of Object.values(d.months || {})) for (const n of bus) {
    if (M.boats) delete M.boats[n];
    if (M.reopen) delete M.reopen[n];
    if (M.opened) delete M.opened[n];
  }
  return d;
}

const GAP = 300; // 한 사이트 안에서 요청 사이 간격(ms). 사이트마다 요청은 하나씩만 보낸다
const TOKEN_KEY = "fishing_github_token";
const ASKED_KEY = "fishing_github_asked";

const fm = FileManager.local();
const DIR = fm.joinPath(fm.documentsDirectory(), "fishing-seats");
if (!fm.fileExists(DIR)) fm.createDirectory(DIR, true);
const CACHE = fm.joinPath(DIR, "seats.json");
const SETTINGS = fm.joinPath(DIR, "settings.json");
const loadSettings = () => { try { return JSON.parse(fm.readString(SETTINGS)) || {}; } catch (e) { return {}; } };
applySites(loadSettings().sites);
const saveSettings = (o) => fm.writeString(SETTINGS, JSON.stringify(o));

const pad = (n) => String(n).padStart(2, "0");

const todayKST = () => { const t = new Date(Date.now() + 9 * 3600e3); return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]; };

const isPast = (y, m, d) => { const [ty, tm, td] = todayKST(); return y * 10000 + m * 100 + d < ty * 10000 + tm * 100 + td; }; // 오늘 이전 날짜는 확인하지 않음
const sleep = (ms) => new Promise((r) => Timer.schedule(ms, false, r));
const daysIn = (y, m) => new Date(y, m, 0).getDate();
const ymKey = (y, m) => `${y}-${pad(m)}`;
const kstIso = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace(/\.\d+Z$/, "+09:00");

function monthsAhead() {
  const kst = new Date(Date.now() + 9 * 3600e3), out = [];
  for (let i = 0; i < 13; i++) {
    const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + i, 1));
    out.push([d.getUTCFullYear(), d.getUTCMonth() + 1]);
  }
  return out;
}

async function get(url) {
  await sleep(GAP);
  const r = new Request(url);
  r.headers = { "Accept-Language": "ko-KR,ko;q=0.9" };
  r.timeoutInterval = 30;
  const t = await r.loadString();
  const code = r.response && r.response.statusCode;
  if (code && code >= 400) throw new Error(`HTTP ${code}`);
  // 분석에 필요 없는 스크립트·스타일·주석을 덜어내 WebView로 넘기는 양을 줄인다
  return t.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
}

// WebView(WebKit) 안에서 DOMParser로 HTML을 읽는 함수. 브라우저용 수집 코드와 같은 규칙.
function fishLabel(t) {
  // 출조 설명에서 어종 이름만 뽑는다 (시크릿 버스용). 긴 이름 우선(돌문어 > 문어, 갑오징어 > 오징어)
  var L = ["돌문어", "문어", "갑오징어", "주꾸미", "쭈꾸미", "한치", "오징어", "쥐노래미", "노래미", "열기", "우럭", "광어", "참돔", "감성돔", "돌돔", "벵에돔", "농어", "민어", "삼치", "방어", "부시리", "대구", "볼락", "갈치", "백조기", "조기", "도다리", "가자미", "고등어", "전갱이", "쏨뱅이", "장대"];
  t = String(t || "");
  var hits = [];
  L.forEach(function (w) { var i = t.indexOf(w); while (i >= 0) { hits.push([i, i + w.length, w]); i = t.indexOf(w, i + 1); } });
  hits = hits.filter(function (a) { return !hits.some(function (b) { return b !== a && b[0] <= a[0] && b[1] >= a[1] && b[2].length > a[2].length; }); });
  hits.sort(function (a, b) { return a[0] - b[0]; });
  var out = [];
  hits.forEach(function (h) { var w = h[2] === "쭈꾸미" ? "주꾸미" : h[2]; if (out.indexOf(w) < 0) out.push(w); });
  return out.slice(0, 4).join("·");
}
// ── 그림으로 된 출조 안내(포스터)에서 어종 읽기 (OCR) ──
// 공지 칸에 글 대신 그림만 있어 어종을 모를 때, 그림 속 글자를 읽어 어종을 찾는다. 한 번 읽은 그림은 결과를 저장해 다시 읽지 않는다.
function ocrSpecies(t) {
  t = String(t || "").replace(/\s+/g, "");
  var F = /광어|우럭|농어|민어|참돔|도미|삼치|부시리|방어|대구|열기|볼락|노래미|백조기|조기|우광|광우|타이라바/;
  var C = /꾸미|쭈꾸|주꾸|쭈갑|갑쭈|갑오|문어|한치|오징어/; // OCR이 '쭈'를 잘못 읽어도 '꾸미'로 잡힌다
  var pick = function (s) { var f = s.search(F), c = s.search(C); if (f < 0 && c < 0) return "u"; if (f < 0) return "j"; if (c < 0) return "f"; return f < c ? "f" : "j"; };
  var near = (t.match(/대상어종[^가-힣]{0,3}([가-힣]{2,8})/) || [])[1] || "";
  var a = pick(near);
  return a !== "u" ? a : pick(t);
}
// 화면(WebView·브라우저) 안에서 도는 OCR 엔진: tesseract.js(한국어)를 처음 쓸 때만 받아 온다
function ocrEngine() {
  window.__ocrText = function (src) {
    var load = window.Tesseract ? Promise.resolve() : new Promise(function (ok, no) {
      var s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
      s.onload = ok; s.onerror = function () { no(new Error("OCR 엔진을 받지 못함")); }; document.head.appendChild(s);
    });
    var run = load.then(function () {
      if (!window.__ocrW) window.__ocrW = Tesseract.createWorker("kor", 1, { langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/kor/4.0.0" })
        .then(function (w) { return w.setParameters({ tessedit_pageseg_mode: "11" }).then(function () { return w; }); });
      return window.__ocrW;
    }).then(function (w) {
      return new Promise(function (ok, no) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = function () { no(new Error("그림을 읽지 못함")); }; i.src = src; })
        .then(function (img) {
          var W = img.naturalWidth || 800, H = img.naturalHeight || 400;
          var o = document.createElement("canvas"); o.width = W; o.height = H; o.getContext("2d").drawImage(img, 0, 0);
          // 두 번째로 읽을 그림: 2배 키우고 흑백으로 (장식 글씨가 조금 더 잘 읽힘)
          var k = Math.min(2, 1600 / W), c = document.createElement("canvas"); c.width = Math.round(W * k); c.height = Math.round(H * k);
          var g = c.getContext("2d"); g.drawImage(img, 0, 0, c.width, c.height);
          var d = g.getImageData(0, 0, c.width, c.height), p = d.data;
          for (var j = 0; j < p.length; j += 4) { var v = 0.299 * p[j] + 0.587 * p[j + 1] + 0.114 * p[j + 2] > 150 ? 255 : 0; p[j] = p[j + 1] = p[j + 2] = v; }
          g.putImageData(d, 0, 0);
          // 먼저 원래 그림을 읽고, 어종 말이 안 보일 때만 흑백 그림을 한 번 더 읽는다 (시간 절약)
          return w.recognize(o).then(function (a) {
            if (/꾸미|쭈꾸|주꾸|갑오|문어|한치|오징어|광어|우럭|참돔|도미|농어|민어|삼치|방어|대구|우광|광우/.test(a.data.text.replace(/\s+/g, ""))) return a.data.text;
            return w.recognize(c).then(function (b) { return a.data.text + "\n" + b.data.text; });
          });
        });
    });
    var limit = new Promise(function (_, no) { setTimeout(function () { no(new Error("OCR 시간 초과(45초)")); }, 45000); });
    return Promise.race([run, limit]);
  };
}
function classifySpecies(primary, fallback) {
  // 어종 분류: f = 물고기(광어·우럭 등), j = 주꾸미·갑오징어 등 두족류, u = 어종 미표기
  // primary(어종 칸)를 먼저 보고, 비어 있거나 모르는 말이면 fallback(공지·행 글자)에서 찾는다. 둘 다 없으면 추측하지 않고 u.
  const FISH = /광어|우럭|농어|민어|참돔|도미|타이라바|백조기|조기|삼치|부시리|방어|대구|열기|볼락|노래미|놀래미|우럭광어|광우|우광|외수질|다운샷|지깅|라이트지깅|침선|생미끼|선상낚시|원투|흘림|외줄/;
  const CEPH = /주꾸미|쭈꾸미|쭈구미|쭈갑|갑쭈|쭈[.·ㆍ]?갑|갑[.·ㆍ]?쭈|갑오징어|갑오|문어|한치|오징어|에기|쭈낚/;
  const pick = (t) => {
    t = String(t || "").replace(/\s+/g, "");
    if (!t) return "u";
    const f = t.search(FISH), c = t.search(CEPH);
    if (f < 0 && c < 0) return "u";
    if (f < 0) return "j";
    if (c < 0) return "f";
    return f < c ? "f" : "j"; // 둘 다 있으면 먼저 적힌 쪽
  };
  const a = pick(primary);
  return a !== "u" ? a : pick(fallback);
}

// ── 선사 공지사항: 앱을 열 때 확인해서 새 공지가 있으면 알림 (처음 한 번은 지금 공지만 기억) ──
// (공지사항을 볼 선사 목록 NOTICE_SITES는 applySites가 선사 목록에서 만든다)
// 페이지 안(DOM)에서 쓰는 분석기. kind: ss(선상24 공지 목록) · home(첫 화면에서 공지 게시판 찾기) · board(게시판 글 목록)
function noticeParse(kind, html, base) {
  var doc = new DOMParser().parseFromString(html, "text/html");
  var clean = function (t) { return String(t || "").replace(/\s+/g, " ").trim(); };
  var abs = function (h) { try { return new URL(h, base); } catch (e) { return null; } };
  var out = [], seen = {};
  if (kind === "ss") {
    doc.querySelectorAll('a[href*="/ship/event_detail/"]').forEach(function (a) {
      var u = abs(a.getAttribute("href")), t = clean(a.textContent);
      if (!u || !t || seen[u.pathname]) return;
      seen[u.pathname] = 1; out.push({ key: u.pathname, url: u.href, title: t.replace(/^\[+/, "[") });
    });
    return out;
  }
  if (kind === "home") {
    var links = Array.prototype.slice.call(doc.querySelectorAll("a[href]")).filter(function (a) {
      var h = a.getAttribute("href") || ""; return /공지/.test(clean(a.textContent)) && !/^(javascript|#)/i.test(h);
    });
    links.sort(function (a, b) { return (/공지사항/.test(clean(b.textContent)) ? 1 : 0) - (/공지사항/.test(clean(a.textContent)) ? 1 : 0); });
    var u0 = links.length ? abs(links[0].getAttribute("href")) : null;
    return u0 ? [{ key: "board", url: u0.href, title: clean(links[0].textContent) }] : [];
  }
  var b = abs(base), mid = b && b.searchParams.get("mid");
  doc.querySelectorAll("a[href]").forEach(function (a) {
    var h = a.getAttribute("href") || "";
    if (/^(javascript|#)/i.test(h)) return;
    var u = abs(h);
    if (!u || !b || u.host !== b.host) return;
    if (mid && u.searchParams.get("mid") !== mid) return;
    var ids = [];
    u.searchParams.forEach(function (v, k) { if (!/^(mid|page|p|category|sort|order|search|keyword|mode|year|month|day)$/i.test(k) && /^\d{2,}$/.test(v)) ids.push(k + "=" + v); });
    if (!ids.length) return;
    var t = clean(a.textContent);
    if (t.length < 2 || /^\d+$/.test(t)) return;
    var key = u.pathname + "?" + (mid ? "mid=" + mid + "&" : "") + ids.sort().join("&");
    if (seen[key]) return;
    seen[key] = 1; out.push({ key: key, url: u.href, title: t });
  });
  return out;
}
// parse(kind, html, base) → 목록, getText(url) → html, state: { seen:{site:[key]}, board:{site:url} }
async function checkNotices(parse, getText, state) {
  state = state || {};
  const seenAll = state.seen || {}, board = state.board || {};
  const sites = [], fresh = [];
  await Promise.all(NOTICE_SITES.map(async (s) => {
    const r = { id: s.id, label: s.label, items: [], error: "" };
    try {
      let list = [];
      if (s.kind === "ss") list = await parse("ss", await getText(s.list), s.list);
      else {
        let url = board[s.id];
        if (url) { try { list = await parse("board", await getText(url), url); } catch (e) { list = []; } }
        if (!list.length) { // 게시판 주소를 (다시) 찾는다
          const h = await parse("home", await getText(s.home), s.home);
          if (h.length) { url = h[0].url; board[s.id] = url; list = await parse("board", await getText(url), url); }
        }
      }
      const before = seenAll[s.id];
      const known = new Set(before || []);
      list.forEach((n) => { n.isNew = !!before && !known.has(n.key); if (n.isNew) fresh.push({ site: s.label, title: n.title, url: n.url }); });
      // 새 공지를 위로
      r.items = [...list.filter((n) => n.isNew), ...list.filter((n) => !n.isNew)].slice(0, 8);
      seenAll[s.id] = [...new Set([...(before || []), ...list.map((n) => n.key)])].slice(-400);
      if (!list.length) r.error = "목록 없음";
    } catch (e) { r.error = e.message || "실패"; }
    sites.push(r);
  }));
  sites.sort((a, b) => NOTICE_SITES.findIndex((x) => x.id === a.id) - NOTICE_SITES.findIndex((x) => x.id === b.id));
  return { sites, fresh, state: { seen: seenAll, board, at: kstIso(), sites } };
}

const NOTICE_STATE = fm.joinPath(DIR, "notices.json");

// 선사 추가: 예약 페이지에서 배 이름(과 배 번호)을 찾는다. ss = 선상24 일정표, tf = 예약 목록의 '선박선택'
function fishFind(kind, html) {
  var doc = new DOMParser().parseFromString(html, "text/html");
  var clean = function (t) { return String(t || "").replace(/\s+/g, " ").trim(); };
  var out = {}, order = [];
  var add = function (n, pa) { n = clean(n).replace(/\s*\(.*$/, ""); if (!n || n.length > 20) return ""; if (!out[n]) { out[n] = { name: n }; order.push(n); } if (pa && !out[n].pa) out[n].pa = pa; return n; };
  if (kind === "ss") {
    doc.querySelectorAll('table[class^="ship_unit"] .ship_info .title').forEach(function (e) { add(e.textContent); });
  } else {
    doc.querySelectorAll("select option").forEach(function (o) {
      var v = o.getAttribute("value") || "", t = clean(o.textContent);
      if (!/^\d{2,}$/.test(v) || !/[가-힣A-Za-z]/.test(t)) return;
      var base = t.replace(/\s*(오전|오후|야간|새벽|주간|1부|2부)$/, "");
      var key = add(base, t === base ? +v : 0);
      if (key && !out[key].pa && !out[key].pa2) out[key].pa2 = +v;
    });
    if (!order.length) doc.querySelectorAll("tr").forEach(function (r) {
      var tds = Array.prototype.filter.call(r.children, function (c) { return c.tagName === "TD"; });
      var sp = tds.length >= 3 && tds[0].querySelector("span");
      if (sp) add((sp.innerHTML.split(/<br\s*\/?>/i)[0] || "").replace(/<[^>]+>/g, ""));
    });
  }
  return { title: clean((doc.querySelector("title") || {}).textContent), boats: order.map(function (n) { var b = out[n]; return { name: n, pa: b.pa || b.pa2 || 0 }; }) };
}

const parserSrc = () => `
window.__fishFind = ${fishFind.toString()};
window.__noticeParse = ${noticeParse.toString()};
(${ocrEngine.toString()})();
window.__fishParse = function (kind, html, y, m) {
  const KEEP = ${JSON.stringify(KEEP)};
  const sq = s => (s || "").replace(/\\s+/g, "");
  const norm = s => { s = sq(s).replace(/\\(.*$/, ""); return KEEP.find(k => s === sq(k) || s.startsWith(sq(k))) || null; };
  const fishLabel = ${fishLabel.toString()};
  const spc = ${classifySpecies.toString()};
  const stc = t => { t = sq(t); const mm = t.match(/남은자리(\\d+)/); if (mm) return +mm[1]; if (/예약마감|예약완료|마감/.test(t)) return 0; if (/기상|취소|점검|휴무|휴항/.test(t)) return "x"; return null; };
  const doc = new DOMParser().parseFromString(html, "text/html");
  const rows = []; let found = 0;
  if (kind === "ss") {
    doc.querySelectorAll('table[class^="ship_unit"]').forEach(t => {
      const name = norm(t.querySelector(".ship_info .title")?.textContent || "");
      const sd = t.querySelector("[data-sdate]")?.dataset.sdate; if (!name || !sd) return;
      const [yy, mo, dd] = sd.split("-").map(Number); if (mo !== m) return;
      const st = stc((t.querySelector(".remain") || t.querySelector(".ship_info2") || {}).textContent);
      if (st !== null) found++;
      const no = +((t.querySelector(".btn_user_reservation, .btn_ship_reservation, [data-schedule_no]") || {}).dataset?.schedule_no || 0) || null;
      rows.push([dd, name, st, spc(t.querySelector("#fish")?.textContent, (t.querySelector(".fishspecies")?.textContent || "") + " " + (t.querySelector(".small_event")?.textContent || "")), no]);
    });
  } else {
    let day = null;
    doc.querySelectorAll("tr").forEach(r => {
      const a = r.querySelector("a[name]"); if (a && /^\\d{8}$/.test(a.name)) { day = a.name; return; }
      const tds = [...r.children].filter(c => c.tagName === "TD");
      if (!day || tds.length < 3 || !tds[0].querySelector("span")) return;
      const name = norm(tds[0].textContent.replace(/예약하기/, "")); if (!name) return;
      const mo = +day.slice(4, 6), dd = +day.slice(6); if (mo !== m) return;
      const last = tds[tds.length - 1];
      const alt = [...last.querySelectorAll("img")].map(i => i.alt).join(" ") + " " + last.textContent;
      let kind2 = ""; tds[1].querySelectorAll('img[alt="낚시종류"]').forEach(i => { kind2 = i.closest("tr").textContent; });
      const rowText = tds[0].textContent + " " + [...tds[1].querySelectorAll("img")].map(i => i.alt || "").join(" ") + " " + tds[1].textContent;
      // 출조 버스만: 장소·일정 안내는 있는데 예약창이 아직 안 열린(상태 칸이 빈) 일정 → "w"(점선 아이콘)
      let st = stc(alt); if (st === null && kind === "bus" && tds[1].textContent.trim()) st = "w";
      // 출조 버스만: 예약창(자리)은 열렸는데 출조 설명이 비어 있으면 표시하지 않음
      if (kind === "bus" && typeof st === "number" && st > 0 && !tds[1].textContent.trim() && !tds[1].querySelector("img")) st = null;
      const sp0 = spc(kind2, rowText);
      // 어종을 글로 못 찾으면 공지 칸의 그림(포스터) 주소를 넘겨 그림 속 글자로 찾게 한다
      const ims = sp0 === "u" ? [...tds[1].querySelectorAll("img")].map(i => i.getAttribute("src") || "").filter(x => x && !/myfishmap|_core.module/.test(x)).slice(0, 2) : null;
      rows.push([dd, name, st, sp0, null, kind === "bus" ? fishLabel(kind2 || tds[1].textContent) : "", ims]); found++;
    });
  }
  return { rows, found };
};
true;`;

async function scrapeSite(parser, site, monthList, progress, ocr) {
  const out = {}, need = [];
  const put = (y, m, d, name, s, sp, no, fn) => {
    if (!name || s === null || isPast(y, m, d)) return; // 오늘 이후만
    const k = ymKey(y, m), L = daysIn(y, m);
    out[k] = out[k] || {};
    const b = (out[k][name] = out[k][name] || { s: Array(L).fill(null), sp: Array(L).fill("j") });
    b.s[d - 1] = s; b.sp[d - 1] = sp;
    if (no) { b.no = b.no || Array(L).fill(null); b.no[d - 1] = no; }
    if (fn) { b.fn = b.fn || Array(L).fill(""); b.fn[d - 1] = fn; } // 시크릿 버스: 설명에서 뽑은 어종 이름
  };
  const parse = (html, y, m) => parser(site.kind, html, y, m);
  let seen = false;
  for (const [y, m] of monthList) {
    await progress(`${site.host} ${m}월`);
    if (site.kind === "ss") {
      const res = await parse(await get(`https://${site.host}/ship/schedule_fleet/${y}${pad(m)}`), y, m);
      res.rows.forEach(([d, n, s, sp, no]) => put(y, m, d, n, s, sp, no));
      if (res.found) seen = true; else if (seen) break; // 예약이 열린 마지막 달 다음에서 멈춤
    } else {
      let found = 0;
      const [ty, tm, td] = todayKST(), d0 = y === ty && m === tm ? td : 1; // 이번 달은 오늘부터
        for (let d = d0; d <= daysIn(y, m); d += site.step || 4) { // 칸피싱은 한 페이지에 8일, 제일은 4일
        const res = await parse(await get(`https://${site.host}/index.php?mid=bk&year=${y}&month=${pad(m)}&day=${pad(d)}`), y, m);
        res.rows.forEach(([dd, n, s, sp, , fn, ims]) => { put(y, m, dd, n, s, sp, null, fn); if (sp === "u" && ims && ims.length) need.push([ymKey(y, m), n, dd, ims]); });
        found += res.found;
      }
      if (found) seen = true; else if (seen) break;
    }
  }
  // 어종을 모르는 날: 공지 그림(포스터)에서 읽어 본다 (같은 그림은 한 번만)
  if (ocr && need.length) {
    const abs = (x) => /^https?:/.test(x) ? x : `https://${site.host}${x.startsWith("/") ? "" : "/"}${x}`;
    let told = false;
    for (const [k, n, d, ims] of need) {
      const b = out[k] && out[k][n];
      if (!b || b.s[d - 1] === null || b.sp[d - 1] !== "u") continue;
      for (const x of ims) {
        if (!told) { told = true; await progress(`${site.host} 그림 속 어종 읽는 중`); }
        const sp = await ocr(abs(x));
        if (sp && sp !== "u") { b.sp[d - 1] = sp; break; }
      }
    }
  }
  for (const k in out) for (const n in out[k]) out[k][n].sp = out[k][n].sp.join("");
  // 이번 달을 확인했는데 배가 하나도 없으면 사이트 문제로 보고 이전 값을 유지
  const cur = ymKey(...monthsAhead()[0]);
  if (!Object.keys(out).length && monthList.some(([y, m]) => ymKey(y, m) === cur)) throw new Error("읽은 배가 없음");
  return out;
}

// 이전 결과와 비교해 "취소로 다시 열린 자리"를 표시 (GitHub 수집 스크립트와 같은 규칙)
function merge(old, results, errors, sources, checked) {
  const oldMonths = (old && old.months) || {};
  const months = { ...oldMonths }; // 이번에 확인하지 않은 달은 그대로 둔다
  const reopened = [], newlyOpened = [];
  const keys = new Set(checked);
  for (const k of [...keys].sort()) {
    const prev = oldMonths[k] || { boats: {}, reopen: {} };
    const boats = {}, reopen = {}, opened = {};
    const monthSeen = !!oldMonths[k]; // 전에 확인한 달이어야 '새로 열림'을 판단
    for (const site of SITES) {
      const fresh = results[site.id];
      for (const name of site.boats) {
        if (!fresh) {
          if (prev.boats && prev.boats[name]) boats[name] = prev.boats[name];
          if (prev.reopen && prev.reopen[name]) reopen[name] = prev.reopen[name];
          if (prev.opened && prev.opened[name]) opened[name] = prev.opened[name];
          continue;
        }
        const nb = fresh[k] && fresh[k][name];
        if (!nb) continue;
        boats[name] = nb;
        const ob = (prev.boats && prev.boats[name] && prev.boats[name].s) || [];
        const pr = (prev.reopen && prev.reopen[name]) || "";
        let flags = "";
        nb.s.forEach((v, i) => {
          const was = pr[i] === "1";
          const on = typeof v === "number" && v > 0 && (ob[i] === 0 || was);
          if (on && !was) reopened.push(`${k.slice(5)}/${pad(i + 1)} ${name} ${v}석`);
          flags += on ? "1" : "0";
        });
        if (flags.includes("1")) reopen[name] = flags;
        // 새로 열린 예약: 전에는 일정이 없던(빈칸) 날에 자리가 생김
        const pb = prev.boats && prev.boats[name] && prev.boats[name].s, po = (prev.opened && prev.opened[name]) || "";
        let of = "";
        nb.s.forEach((v, i) => {
          const was = po[i] === "1";
          const on = typeof v === "number" && v > 0 && flags[i] !== "1" && (was || (monthSeen && (!pb || pb[i] == null || pb[i] === "w")));
          if (on && !was) newlyOpened.push(`${k.slice(5)}/${pad(i + 1)} ${name} ${v}석`);
          of += on ? "1" : "0";
        });
        if (of.includes("1")) opened[name] = of;
      }
    }
    // 아직 예약이 안 열린 달도 '확인했음'으로 남겨 둔다 (나중에 열리면 '새로 열림'으로 표시)
    if (Object.keys(boats).length || Object.values(results).some(Boolean)) months[k] = { boats, reopen, opened }; else delete months[k];
  }
  return { updatedAt: kstIso(), pv: PARSE_V, ok: errors.length === 0, errors, reopened, opened: newlyOpened, sources, months };
}

async function loadJSON(url) {
  try { return await new Request(url).loadJSON(); } catch (e) { return null; }
}

// 웹 캘린더에도 올리기(선택). 토큰이 있으면 data/seats.json을 GitHub에 저장.
async function askToken() {
  if (Keychain.contains(TOKEN_KEY) || Keychain.contains(ASKED_KEY)) return;
  const a = new Alert();
  a.title = "웹 캘린더에도 올릴까요?";
  a.message = "확인 결과를 sclee00.github.io/calendar 에도 반영하려면 GitHub 토큰이 필요해요. 'calendar' 저장소의 Contents 읽기·쓰기 권한만 있는 토큰을 붙여 넣으세요. 나중에 하려면 '아이폰에서만'을 누르세요.";
  a.addSecureTextField("github_pat_…", "");
  a.addAction("저장");
  a.addCancelAction("아이폰에서만");
  const i = await a.presentAlert();
  if (i === 0 && a.textFieldValue(0).trim()) Keychain.set(TOKEN_KEY, a.textFieldValue(0).trim());
  else Keychain.set(ASKED_KEY, "1");
}

async function upload(data) {
  if (!Keychain.contains(TOKEN_KEY)) return null;
  const token = Keychain.get(TOKEN_KEY);
  const api = `https://api.github.com/repos/${REPO}/contents/data/seats.json`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const g = new Request(api); g.headers = headers;
  const cur = await g.loadJSON();
  if (g.response.statusCode === 401) throw new Error("토큰이 맞지 않음");
  const p = new Request(api);
  p.method = "PUT"; p.headers = { ...headers, "Content-Type": "application/json" };
  p.body = JSON.stringify({
    message: `아이폰 확인 ${data.updatedAt.slice(5, 16).replace("T", " ")}`,
    content: Data.fromString(JSON.stringify(data)).toBase64String(),
    sha: cur && cur.sha,
  });
  const res = await p.loadJSON();
  const code = p.response.statusCode;
  if (code >= 300) throw new Error((res && res.message) || `HTTP ${code}`);
  return true;
}


// ───────────────────────── 빈자리 알림(위젯·단축어 자동화) ─────────────────────────
// 켜 두면 홈 화면 위젯이 새로 고쳐질 때 정해 둔 조건의 날짜만 확인하고, 맞는 자리가 생기면 알림을 보낸다.
const WATCH_STATE = fm.joinPath(DIR, "watch-state.json");
// 알림 소리 (설정 → 빈자리 알림 → 알림 소리). Scriptable이 가진 소리 이름, 'off'면 소리 없음
const SOUNDS = ["default", "piano_success", "event", "complete", "accept", "alert", "failure", "popup", "piano_error"];
function alertSound() { const k = ((loadSettings().watch || {}).sound) || "default"; return k === "off" ? null : SOUNDS.includes(k) ? k : "default"; }
const spOf2 = (c) => (c === "f" ? "f" : c === "u" ? "u" : "j");
const strip = (h) => (h || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

// WebView 없이 쓰는 분석기(위젯·단축어에서는 화면 요소를 못 쓸 수 있어서)
function regexParse(kind, html, y, m) {
  const sq = (s) => (s || "").replace(/\s+/g, "");
  const norm = (s) => { s = sq(s).replace(/\(.*$/, ""); return KEEP.find((k) => s === sq(k) || s.startsWith(sq(k))) || null; };
  const spc = classifySpecies;
  const stc = (t) => { t = sq(t); const mm = t.match(/남은자리(\d+)/); if (mm) return +mm[1]; if (/예약마감|예약완료|마감/.test(t)) return 0; if (/기상|취소|점검|휴무|휴항/.test(t)) return "x"; return null; };
  const rows = []; let found = 0;
  if (kind === "ss") {
    html.split(/<table[^>]+class="ship_unit/).slice(1).forEach((c) => {
      const name = norm(strip((c.match(/class="title"[^>]*>([\s\S]*?)<\/div>/) || [])[1]));
      const sd = (c.match(/data-sdate="(\d{4})-(\d{2})-(\d{2})"/) || []);
      if (!name || !sd[0] || +sd[2] !== m) return;
      const rem = c.match(/class="remain"[\s\S]*?<\/li>/);
      const info = c.match(/class="ship_info2"[\s\S]*?<\/td>/);
      const st = stc(strip(rem ? rem[0] : info ? info[0] : ""));
      if (st !== null) found++;
      rows.push([+sd[3], name, st, spc(strip((c.match(/id="fish"[^>]*>([\s\S]*?)<\/div>/) || [])[1]), strip((c.match(/class="small_event"[\s\S]*?<\/li>/) || [""])[0]))]);
    });
  } else {
    const parts = html.split(/<a name="(\d{8})"/);
    for (let i = 1; i < parts.length; i += 2) {
      const day = parts[i], sec = parts[i + 1] || "";
      if (+day.slice(4, 6) !== m) continue;
      const spans = [...sec.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map((x) => ({ i: x.index, name: norm(strip(x[1])) })).filter((x) => x.name);
      spans.forEach((sp, j) => {
        const seg = sec.slice(sp.i, j + 1 < spans.length ? spans[j + 1].i : sec.length);
        const cells = seg.split(/<\/td>/i);
        const last = cells.length > 1 ? cells[cells.length - 2] : seg;
        const alt = [...last.matchAll(/alt="([^"]*)"/g)].map((x) => x[1]).join(" ") + " " + strip(last);
        const kind2 = strip((seg.match(/alt="낚시종류"[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/) || [])[1]);
        const rowText = [...seg.matchAll(/alt="([^"]*)"/g)].map((x) => x[1]).join(" ") + " " + strip(seg);
        let st = stc(alt); if (st === null && kind === "bus" && /지\s*역|[가-힣]+항|★/.test(strip(seg))) st = "w"; // 출조 버스: 장소·일정 안내는 있는데 예약창 안 열림
        if (kind === "bus" && typeof st === "number" && st > 0 && cells.length > 2 && !strip(cells[1]) && !/<img/i.test(cells[1]) && !/지\s*역|[가-힣]+항|★/.test(strip(seg))) st = null; // 출조 버스: 자리만 열리고 설명 없음 → 표시 안 함
        const sp0 = spc(kind2, rowText);
        const ims = sp0 === "u" ? [...seg.matchAll(/<img[^>]+src="([^"]+)"/g)].map((x) => x[1]).filter((x) => !/myfishmap|_core.module/.test(x)).slice(0, 2) : null;
        rows.push([+day.slice(6), sp.name, st, sp0, null, kind === "bus" ? fishLabel(kind2 || strip(seg)) : "", ims]); found++;
      });
    }
  }
  return { rows, found };
}

async function makeParser() {
  try { // 가능하면 화면에 띄우지 않는 WebView의 DOM 분석기를 쓴다
    const wv = new WebView();
    await wv.loadHTML("<!doctype html><p>");
    await wv.evaluateJavaScript(parserSrc());
    const ok = await wv.evaluateJavaScript(`typeof __fishParse==="function"`);
    if (ok) { const f = (kind, html, y, m) => wv.evaluateJavaScript(`__fishParse(${JSON.stringify(kind)}, ${JSON.stringify(html)}, ${y}, ${m})`); f.wv = wv; return f; }
  } catch (e) {}
  return async (kind, html, y, m) => regexParse(kind, html, y, m);
}

// 선사 추가: 사용자가 넣은 주소로 어떤 예약 프로그램인지 알아내고 배 목록을 찾는다
async function findSite(input, evalJs) {
  try {
    let t = String(input || "").trim();
    if (!/^https?:\/\//i.test(t)) t = "https://" + t;
    const host = (/^https?:\/\/([^/?#]+)/i.exec(t) || [])[1];
    if (!host || !/\./.test(host)) return { ok: false, error: "주소를 알아볼 수 없어요" };
    const h = host.toLowerCase().replace(/^www\./, "");
    const kind = /\.sunsang24\.com$/.test(h) ? "ss" : "tf";
    const [ty, tm, td] = todayKST();
    const pages = kind === "ss"
      ? [`https://${h}/ship/schedule_fleet/${ty}${pad(tm)}`, ...[1].map((i) => { const d = new Date(Date.UTC(ty, tm - 1 + i, 1)); return `https://${h}/ship/schedule_fleet/${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}`; })]
      : [`https://${h}/index.php?mid=bk&year=${ty}&month=${pad(tm)}&day=${pad(td)}`];
    const boats = [], seen = new Set(); let title = "";
    for (const url of pages) {
      let html; try { html = await get(url); } catch (e) { continue; }
      const r = await evalJs(`__fishFind(${JSON.stringify(kind)}, ${JSON.stringify(html)})`);
      if (!r) continue;
      title = title || r.title;
      (r.boats || []).forEach((b) => { if (!seen.has(b.name)) { seen.add(b.name); boats.push(b); } });
    }
    if (!boats.length) return { ok: false, host: h, kind, error: kind === "ss" ? "선상24 일정표에서 배를 찾지 못했어요" : "예약 목록(index.php?mid=bk)에서 배를 찾지 못했어요. 이 예약 프로그램을 쓰지 않는 사이트일 수 있어요" };
    const owner = {}; SITES.forEach((x) => x.boats.forEach((n) => { owner[n] = x.label; }));
    return { ok: true, host: h, kind, step: kind === "ss" ? undefined : 4, label: (title.split(/[|:\-–]/).map((x) => x.trim()).find((x) => x && !/예약|reserv|일정/i.test(x)) || "").slice(0, 20) || h, boats: boats.map((b) => ({ ...b, taken: owner[b.name] && !SITES.some((x) => x.host === h && x.boats.includes(b.name)) ? owner[b.name] : "" })), have: (SITES.find((x) => x.host === h) || {}).boats || [] };
  } catch (e) { return { ok: false, error: e.message || String(e) }; }
}

// OCR 결과 저장: 그림 주소 → 어종. evalJs가 없으면(자동화 실행) 저장된 결과만 쓰고 새로 읽지 않는다
const OCR_CACHE = fm.joinPath(DIR, "ocr.json");
function makeOcr(evalJs) {
  let cache = {}; try { cache = JSON.parse(fm.readString(OCR_CACHE)) || {}; } catch (e) {}
  for (const k in cache) if (k !== "_fail" && !(cache[k] && cache[k].ms)) delete cache[k]; // 첫 버전에서 저장한 결과는 다시 읽는다
  const save = () => { try { fm.writeString(OCR_CACHE, JSON.stringify(cache)); } catch (e) {} };
  // 실패하면 6시간 동안은 다시 시도하지 않는다 (확인이 매번 길어지지 않게)
  const OCR_V = 2; // 고친 뒤에는 예전 실패 기록을 무시하고 바로 다시 시도
  const failRecent = cache._fail && cache._fail.v === OCR_V && Date.now() - cache._fail.ms < 6 * 3600e3;
  let fresh = 0, broken = !!failRecent, spent = 0;
  const stats = { read: 0, sp: { j: 0, f: 0, u: 0 }, err: failRecent ? cache._fail.err : "", skipped: 0 };
  const fail = (err) => { broken = true; stats.err = err; cache._fail = { err, v: OCR_V, ms: Date.now(), at: kstIso() }; save(); console.log("OCR 실패: " + err); };
  const f = async (url) => {
    if (cache[url] && url !== "_fail") return cache[url].sp;
    if (!evalJs) return null;
    if (broken || fresh >= 6 || spent > 90e3) { stats.skipped++; return null; } // 한 번에 새 그림은 6장·90초까지
    fresh++;
    const t0 = Date.now();
    try {
      const r = new Request(url); r.timeoutInterval = 20;
      const data = await r.load();
      const mime = /\.png/i.test(url) ? "image/png" : /\.gif/i.test(url) ? "image/gif" : /\.webp/i.test(url) ? "image/webp" : "image/jpeg";
      const text = await evalJs(`__ocrText(${JSON.stringify("data:" + mime + ";base64," + data.toBase64String())}).then(function(t){completion(String(t))},function(e){completion("!ERR "+(e&&e.message||e))}); 0`);
      spent += Date.now() - t0;
      if (typeof text !== "string" || text.startsWith("!ERR")) { fail(String(text || "응답 없음").replace(/^!ERR /, "")); return null; }
      const sp = ocrSpecies(text);
      stats.read++; stats.sp[sp] = (stats.sp[sp] || 0) + 1;
      delete cache._fail;
      cache[url] = { sp, t: text.replace(/\s+/g, " ").slice(0, 160), ms: Date.now() - t0, at: kstIso() };
      const keys = Object.keys(cache); if (keys.length > 300) keys.slice(0, keys.length - 300).forEach((x) => delete cache[x]);
      save();
      return sp;
    } catch (e) { spent += Date.now() - t0; fail(String(e.message || e)); return null; }
  };
  // 확인 결과 문구에 붙일 요약
  f.summary = () => {
    if (!stats.read && !stats.err) return "";
    if (stats.read) return `그림 속 어종 ${stats.read}장 읽음(쭈꾸미류 ${stats.sp.j}·물고기 ${stats.sp.f}·모름 ${stats.sp.u})` + (stats.err ? ` · 일부 실패: ${stats.err}` : "");
    return `그림 속 어종 읽기 실패(6시간 뒤 다시 시도): ${stats.err}`;
  };
  return f;
}

function watchDays(cfg) {
  const kst = new Date(Date.now() + 9 * 3600e3);
  const today = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
  const from = cfg.from ? new Date(cfg.from + "T00:00:00Z") : today;
  const to = cfg.to ? new Date(cfg.to + "T00:00:00Z") : new Date(Math.max(from, today) + 30 * 864e5); // 끝 날짜를 비우면 시작일부터 30일
  const dows = Array.isArray(cfg.dows) && cfg.dows.length ? cfg.dows : [0, 1, 2, 3, 4, 5, 6];
  const out = [];
  for (let d = new Date(Math.max(from, today)); d <= to && out.length < 93; d = new Date(d.getTime() + 864e5)) {
    if (dows.includes(d.getUTCDay())) out.push([d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]);
  }
  return out;
}

// ── 빈자리 알림 규칙: 종류(빈자리·취소로 다시 열림·새로 열림)마다 조건을 따로 ──
const RULE_KINDS = [["reopen", "취소로 다시 열린 자리"], ["open", "예약이 새로 열림"], ["any", "빈자리"]];
function watchRules(cfg) {
  cfg = cfg || {};
  if (cfg.rules && typeof cfg.rules === "object") return cfg.rules;
  // 예전 설정(조건 하나 + 기준 선택)을 종류별 규칙으로 바꿔 읽음
  const base = { from: cfg.from || "", to: cfg.to || "", dows: cfg.dows, min: cfg.min, sp: cfg.sp, boats: cfg.boats };
  const modes = Array.isArray(cfg.modes) ? cfg.modes : cfg.mode && cfg.mode !== "any" ? String(cfg.mode).split("+") : [];
  const r = {};
  (modes.length ? modes : ["any"]).forEach((m) => { r[m] = { on: true, ...base }; });
  return r;
}
function ruleOf(r) {
  const days = watchDays(r);
  return {
    days, want: new Set(days.map(([y, m, d]) => `${ymKey(y, m)}|${d}`)),
    boats: Array.isArray(r.boats) && r.boats.length ? r.boats : KEEP,
    sps: Array.isArray(r.sp) && r.sp.length ? r.sp : ["j", "f", "u"],
    min: Math.max(1, +r.min || 1),
    sig: JSON.stringify([r.from || "", r.to || "", r.dows || [], r.boats || [], r.sp || [], +r.min || 1]),
  };
}
// 켜 둔 규칙들에 필요한 페이지만 받아서 배·날짜별 상태를 모은다
async function watchCollect(rules, parse) {
  const active = Object.values(rules).filter((r) => r && r.on).map(ruleOf);
  const boats = new Set(active.flatMap((r) => r.boats));
  const days = new Map();
  active.forEach((r) => r.days.forEach((x) => days.set(x.join("-"), x)));
  const rows = [], errors = [];
  await Promise.all(SITES.filter((s) => s.boats.some((b) => boats.has(b))).map(async (site) => {
    try {
      const pages = new Map();
      for (const [y, m, d] of days.values()) {
        if (site.kind === "ss") pages.set(`${y}${pad(m)}`, [y, m, `https://${site.host}/ship/schedule_fleet/${y}${pad(m)}`]);
        else { const st = site.step || 4, d0 = 1 + st * Math.floor((d - 1) / st); pages.set(`${y}${pad(m)}${d0}`, [y, m, `https://${site.host}/index.php?mid=bk&year=${y}&month=${pad(m)}&day=${pad(d0)}`]); }
      }
      for (const [y, m, url] of pages.values()) {
        const res = await parse(site.kind, await get(url), y, m);
        for (const [d, name, s, sp, no] of res.rows) {
          if (!days.has(`${y}-${m}-${d}`)) continue;
          rows.push({ key: `${ymKey(y, m)}|${name}|${d}`, ym: ymKey(y, m), y, m, d, name, s, sp, no });
        }
      }
    } catch (e) { errors.push(`${site.host}: ${e.message}`); }
  }));
  const monthKeys = [...new Set([...days.values()].map(([y, m]) => ymKey(y, m)))];
  return { rows, errors, monthKeys };
}
// 알림 확인에서 받은 날짜들을 캘린더 결과에도 넣는다 (먼 달도 메인 배너·깜빡임에 바로 보이게)
// 처음 보는 달은 '확인했음'만 남기고, 전에 본 달에서 비어 있던 날에 자리가 생기면 '새로 열림'으로 표시
function applyWatchRows(data, rows, monthKeys) {
  const out = JSON.parse(JSON.stringify(data || { months: {} }));
  out.months = out.months || {};
  const first = new Set();
  for (const k of monthKeys || []) if (!out.months[k]) { out.months[k] = { boats: {}, reopen: {}, opened: {} }; first.add(k); }
  const setFlag = (F, name, i, L, on) => {
    const a = String(F[name] || "").padEnd(L, "0").slice(0, L).split(""); a[i] = on ? "1" : "0";
    const v = a.join(""); if (v.includes("1")) F[name] = v; else delete F[name];
  };
  const fresh = { reopened: [], opened: [] };
  for (const h of rows) {
    const M = out.months[h.ym];
    if (!M || h.s === null || h.s === undefined) continue;
    M.boats = M.boats || {}; M.reopen = M.reopen || {}; M.opened = M.opened || {};
    const L = daysIn(h.y, h.m), i = h.d - 1;
    const b = M.boats[h.name] || (M.boats[h.name] = { s: Array(L).fill(null), sp: "j".repeat(L) });
    const before = b.s[i], v = h.s, pos = typeof v === "number" && v > 0;
    const wasR = String(M.reopen[h.name] || "")[i] === "1", wasO = String(M.opened[h.name] || "")[i] === "1";
    const onR = pos && (before === 0 || wasR);
    const onO = pos && !onR && (wasO || (!first.has(h.ym) && (before == null || before === "w")));
    if (onR && !wasR) fresh.reopened.push(`${h.ym.slice(5)}/${pad(h.d)} ${h.name} ${v}석`);
    if (onO && !wasO) fresh.opened.push(`${h.ym.slice(5)}/${pad(h.d)} ${h.name} ${v}석`);
    b.s[i] = v;
    const sp = String(b.sp || "").padEnd(L, "j").slice(0, L).split(""); sp[i] = h.sp || "j"; b.sp = sp.join("");
    if (h.no) { b.no = b.no || Array(L).fill(null); b.no[i] = h.no; }
    setFlag(M.reopen, h.name, i, L, onR); setFlag(M.opened, h.name, i, L, onO);
  }
  return { data: out, fresh };
}
// 규칙마다 새로 알릴 자리를 고른다. 한 번 알린 자리는 다시 마감(또는 기준 아래)됐다가 열릴 때까지 다시 안 알림
function watchDecide(rules, rows, state) {
  state = state || {};
  const prev = state.prev || {}, sigs = state.sigs || {}, notified = state.notified && !Array.isArray(state.notified) ? state.notified : {};
  const seen = {};
  rows.forEach((r) => { seen[r.key] = r.s; });
  const fresh = [], hits = new Set(), newSigs = {}, newNot = {};
  for (const [type, label] of RULE_KINDS) {
    const r = rules[type];
    if (!r || !r.on) continue;
    const R = ruleOf(r);
    const baseline = sigs[type] !== R.sig; // 조건을 바꾼 직후 첫 확인
    newSigs[type] = R.sig;
    const N = baseline || typeof notified[type] !== "object" ? {} : { ...notified[type] };
    for (const k of Object.keys(N)) if (k in seen && !(typeof seen[k] === "number" && seen[k] >= R.min)) delete N[k];
    for (const h of rows) {
      if (!R.boats.includes(h.name) || !R.want.has(`${h.ym}|${h.d}`) || !R.sps.includes(spOf2(h.sp))) continue;
      if (!(typeof h.s === "number" && h.s >= R.min)) continue;
      if (type === "any") hits.add(h.key); // '빈자리 있음' 조건에 지금 맞는 자리 수 (취소·새로 열림은 새로 생긴 것만 셈)
      const ok = type === "any" ? true : type === "reopen" ? prev[h.key] === 0 : !baseline && typeof prev[h.key] !== "number";
      if (ok && !N[h.key]) { N[h.key] = 1; fresh.push({ type, label, h }); }
    }
    newNot[type] = N;
  }
  return { fresh, hits: hits.size, state: { prev: { ...prev, ...seen }, sigs: newSigs, notified: newNot, at: kstIso() } };
}
// 알림 종류별로 따로 센다: 새로 알린 수, 그리고 지금 상태(취소로 다시 열림·새로 열림은 아직 확인 안 한 표시, 빈자리는 자리 있는 곳)
function ruleCounts(rules, res, data) {
  const out = [];
  for (const [type] of RULE_KINDS) {
    const r = rules[type];
    if (!r || !r.on) continue;
    const R = ruleOf(r);
    const fresh = res.fresh.filter((f) => f.type === type).length;
    let now = 0;
    if (type === "any") now = res.hits;
    else if (!data) now = null; // 캘린더 결과가 없으면 지금 상태는 모름
    else {
      const F = type === "reopen" ? "reopen" : "opened";
      for (const [mk, M] of Object.entries((data && data.months) || {})) {
        const flags = (M && M[F]) || {}, B = (M && M.boats) || {};
        for (const [name, f] of Object.entries(flags)) {
          const b = B[name];
          if (!b || !R.boats.includes(name)) continue;
          String(f).split("").forEach((c, i) => {
            const s = b.s[i];
            if (c === "1" && typeof s === "number" && s >= R.min && R.want.has(`${mk}|${i + 1}`) && R.sps.includes(spOf2((b.sp || "")[i]))) now++;
          });
        }
      }
    }
    out.push({ type, fresh, now });
  }
  return out;
}
function countsText(c) {
  const name = { reopen: "취소로 다시 열린 자리", open: "새로 열린 예약", any: "빈자리 있음" };
  return c.map((x) => `${name[x.type]}: 새로 ${x.fresh}곳` + (x.now === null ? "" : ` · 조건 안에 ${x.now}곳`)).join(" / ");
}
function watchMessage(fresh) {
  const WDN = ["일", "월", "화", "수", "목", "금", "토"];
  const fmt = (h) => `${h.m}/${h.d}(${WDN[new Date(Date.UTC(h.y, h.m - 1, h.d)).getUTCDay()]}) ${h.name} ${h.s}석`;
  const title = RULE_KINDS.map(([t, label]) => [label, fresh.filter((f) => f.type === t).length]).filter(([, n]) => n).map(([l, n]) => `${l} ${n}곳`).join(" · ");
  const tag = { reopen: "[취소] ", open: "[새로] ", any: "" };
  const lines = [], done = new Set();
  fresh.forEach((f) => { if (!done.has(f.h.key)) { done.add(f.h.key); lines.push(tag[f.type] + fmt(f.h)); } });
  return { title, body: lines.slice(0, 6).join("\n") + (lines.length > 6 ? `\n외 ${lines.length - 6}곳` : ""), lines };
}

async function watch() {
  const cfg = (loadSettings().watch) || {};
  const rules = watchRules(cfg);
  const w = new ListWidget();
  w.backgroundColor = new Color("#f3f5f7");
  w.url = "scriptable:///run/" + encodeURIComponent(Script.name());
  const line = (t, size, color, bold) => { const x = w.addText(t); x.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size); x.textColor = new Color(color); x.lineLimit = 2; return x; };
  line("낚시배 빈자리", 13, "#1f5f99", true);
  const done = (hours) => { w.refreshAfterDate = new Date(Date.now() + hours * 3600e3); if (config.runsInWidget) Script.setWidget(w); };
  if (!cfg.on || !Object.values(rules).some((r) => r && r.on)) { line("알림 꺼짐", 12, "#6a7983"); line("앱의 설정에서 켤 수 있어요", 10, "#6a7983"); done(6); return "알림 꺼짐"; }

  const parse = await makeParser();
  const { rows, errors, monthKeys } = await watchCollect(rules, parse);
  let state = {}; try { state = JSON.parse(fm.readString(WATCH_STATE)) || {}; } catch (e) {}
  const res = watchDecide(rules, rows, state);
  fm.writeString(WATCH_STATE, JSON.stringify(res.state));
  // 받은 날짜들을 캘린더 결과에도 넣어 둔다 (앱을 열면 먼 달도 메인 배너에 바로 보임)
  let counts = ruleCounts(rules, res, null);
  try {
    const cache = JSON.parse(fm.readString(CACHE));
    if (cache) { const u = applyWatchRows(cache, rows, errors.length ? [] : monthKeys).data; fm.writeString(CACHE, JSON.stringify(u)); counts = ruleCounts(rules, res, u); }
  } catch (e) {}
  const msg = watchMessage(res.fresh);
  if (res.fresh.length) {
    const n = new Notification();
    n.title = msg.title; n.body = msg.body;
    n.openURL = "scriptable:///run/" + encodeURIComponent(Script.name());
    n.sound = alertSound();
    await n.schedule();
  }
  const now = new Date(Date.now() + 9 * 3600e3);
  line(`${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())} 확인`, 11, "#18232c");
  const short = { reopen: "취소", open: "새로 열림", any: "빈자리" };
  counts.forEach((x) => line(`${short[x.type]} 새로 ${x.fresh}` + (x.now === null ? "" : ` · 조건 안 ${x.now}`), 10, "#18232c"));
  msg.lines.slice(0, 3).forEach((t) => line(t, 11, "#13a06e", true));
  if (errors.length) line("일부 사이트 확인 실패", 10, "#e0473a");
  done(Math.max(10 / 60, (+cfg.interval || 60) / 60));
  return countsText(counts);
}

// ───────────────── 앱을 열지 않고 확인 (단축어 '개인용 자동화'로 정해 둔 시각에 실행) ─────────────────
// 설정한 기간(1~12개월)을 확인해 결과를 저장하고(앱을 열면 바로 보임), 웹 캘린더에도 올린다.
// 빈자리 알림을 켜 두었으면 그 조건으로 알리고, 꺼 두었으면 새로 생긴 자리(취소로 다시 열림·새로 열림)를 알린다.

// ───────────────── 내 예약 ─────────────────
// 키 형식 "YYYY-MM|배 이름|일". 직접 표시한 것(settings.mine) + 아이폰 캘린더에서 읽은 것
const MINE_TAG = (k) => `[fishing:${k}]`;
const keyDate = (k) => { const [mk, , d] = k.split("|"); return new Date(+mk.slice(0, 4), +mk.slice(5) - 1, +d); };
async function calFind(k) {
  const s0 = keyDate(k), e0 = new Date(s0.getTime() + 864e5);
  const evs = await CalendarEvent.between(s0, e0);
  return evs.find((x) => (x.notes || "").includes(MINE_TAG(k)));
}
async function calAdd(k) {
  try {
    if (await calFind(k)) return;
    const [, name] = k.split("|");
    const e = new CalendarEvent();
    e.title = `🎣 ${name} 출조`;
    e.isAllDay = true;
    e.startDate = keyDate(k); e.endDate = keyDate(k);
    e.notes = `낚시배 빈자리 앱에서 추가 ${MINE_TAG(k)}`;
    try { e.calendar = await Calendar.defaultForEvents(); } catch (x) {}
    await e.save();
  } catch (e) { console.error(e); }
}
async function calRemove(k) { try { const ev = await calFind(k); if (ev) await ev.remove(); } catch (e) { console.error(e); } }
// 아이폰 캘린더에서 배 이름이 들어간 일정 → 내 예약 (앱이 직접 넣은 일정은 제외)
async function calRead() {
  try {
    const now = new Date(), s0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const evs = await CalendarEvent.between(s0, new Date(s0.getTime() + 400 * 864e5));
    const sq = (t) => String(t || "").replace(/\s+/g, "");
    const out = new Set();
    for (const ev of evs) {
      if ((ev.notes || "").includes("[fishing:")) continue;
      const t = sq(ev.title);
      const name = KEEP.slice().sort((a, b) => sq(b).length - sq(a).length).find((n) => t.includes(sq(n)));
      if (!name) continue;
      const d = ev.startDate;
      out.add(`${d.getFullYear()}-${pad(d.getMonth() + 1)}|${name}|${d.getDate()}`);
    }
    return [...out];
  } catch (e) { return []; }
}
function mineKeys(settings, calKeys) {
  const calOn = !settings.mineCal || settings.mineCal.read !== false;
  return [...new Set([...(settings.mine || []), ...(calOn ? (calKeys || settings.mineCalKeys || []) : [])])];
}
// 내 예약 배가 이번 확인에서 '출조 취소'로 바뀐 것
function mineCancelled(oldData, newData, keys) {
  const st = (d, k) => { const [mk, name, day] = k.split("|"); const b = d && d.months && d.months[mk] && d.months[mk].boats && d.months[mk].boats[name]; return b ? b.s[+day - 1] : undefined; };
  return keys.filter((k) => st(newData, k) === "x" && st(oldData, k) !== "x");
}
const mineText = (k) => { const [mk, name, d] = k.split("|"); const dt = keyDate(k); return `${+mk.slice(5)}/${d}(${"일월화수목금토"[dt.getDay()]}) ${name}`; };
async function notifyMine(cancelled, settings) {
  for (const k of cancelled) {
    const n = new Notification();
    n.title = "내 예약 출조 취소"; n.body = mineText(k) + " — 사이트에서 확인하세요"; n.sound = alertSound();
    n.openURL = "scriptable:///run/" + encodeURIComponent(Script.name());
    await n.schedule();
  }
  // 출조 전날 알림 (하루 한 번)
  const t = new Date(Date.now() + 9 * 3600e3), tm = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1));
  const tk = `${tm.getUTCFullYear()}-${pad(tm.getUTCMonth() + 1)}|`, td = tm.getUTCDate();
  const done = settings.mineReminded || {};
  const due = mineKeys(settings).filter((k) => k.startsWith(tk) && +k.split("|")[2] === td && !done[k]);
  for (const k of due) {
    const n = new Notification();
    n.title = "내일 출조"; n.body = mineText(k) + " · 준비물·날씨 확인하세요"; n.sound = alertSound();
    n.openURL = "scriptable:///run/" + encodeURIComponent(Script.name());
    await n.schedule();
    done[k] = 1;
  }
  if (due.length) saveSettings({ ...loadSettings(), mineReminded: done });
}

async function backgroundCheck() {
  const settings = loadSettings();
  const ahead = Number.isInteger(settings.ahead) && settings.ahead >= 1 && settings.ahead <= 12 ? settings.ahead : 1;
  const list = monthsAhead().slice(0, ahead);
  let old = fm.fileExists(CACHE) ? JSON.parse(fm.readString(CACHE)) : null;
  const web = await loadJSON(RAW + "data/seats.json?t=" + Date.now());
  if (!old || (web && web.updatedAt > old.updatedAt)) old = web || old || { months: {} };
  old = dropStale(old);
  const parser = await makeParser();
  const bgOcr = makeOcr(null); // 자동화 실행은 시간이 짧아 새로 읽지 않고, 앱에서 읽어 둔 결과만 쓴다
  const results = {}, errors = [], sources = { ...(old.sources || {}) };
  await Promise.all(SITES.map(async (site) => {
    try { results[site.id] = await scrapeSite(parser, site, list, () => null, bgOcr); sources[site.id] = kstIso(); }
    catch (e) { errors.push(`${site.host}: ${e.message}`); }
  }));
  const data = merge(old, results, errors, sources, list.map(([y, m]) => ymKey(y, m)));
  try { await notifyMine(mineCancelled(old, data, mineKeys(settings)), settings); } catch (e) {}
  fm.writeString(CACHE, JSON.stringify(data));
  try { await upload(data); } catch (e) {}
  let out = `${list.map(([, m]) => m + "월").join("·")} 확인` + (errors.length ? ` (일부 실패 ${errors.length}곳)` : "");
  if (settings.watch && settings.watch.on) {
    try { out += " · " + (await watch()); } catch (e) { out += " · 알림 확인 오류"; }
  } else {
    const items = [...data.reopened.map((x) => "취소로 다시 열림 · " + x), ...(data.opened || []).map((x) => "새로 열림 · " + x)];
    if (items.length) {
      const n = new Notification();
      n.title = `새로 생긴 자리 ${items.length}곳`;
      n.body = items.slice(0, 6).join("\n") + (items.length > 6 ? `\n외 ${items.length - 6}곳` : "");
      n.sound = alertSound();
      n.openURL = "scriptable:///run/" + encodeURIComponent(Script.name());
      await n.schedule();
    }
    out += ` · 새로 생긴 자리 ${items.length}곳`;
  }
  return out;
}

const LOADING = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;font:16px -apple-system,sans-serif;display:grid;place-items:center;height:100vh;background:#f3f5f7;color:#18232c"><div id="m">낚시배 빈자리 불러오는 중…</div></body>`;

// ── 홈 화면 위젯: 작은 달력 ──
// 위젯은 실행 시간이 짧아서 선사 사이트를 읽지 않고, 앱·자동화가 저장해 둔 결과(없으면 웹 캘린더 결과)로 그린다.
// 날짜마다 고른 배들의 남은 자리 합(석, 초록), 내 예약 날(금색 테두리), 오늘(파란 바탕). 누르면 앱이 열린다.
// 위젯 설정의 Parameter: 비우면 이번 달, '다음달'(또는 +1) 다음 달, +2 다다음 달 … (위젯을 여러 개 겹쳐 두고 넘겨 보기)
const widgetOffset = (p) => { p = String(p || ""); if (/다다음/.test(p)) return 2; if (/다음/.test(p)) return 1; const n = parseInt((/[+]?\d+/.exec(p) || [])[0], 10); return Number.isFinite(n) ? Math.max(0, Math.min(11, n)) : 0; };
async function calendarWidget() {
  let data = null; try { data = JSON.parse(fm.readString(CACHE)); } catch (e) {}
  if (!data) data = await loadJSON(RAW + "data/seats.json?t=" + Date.now());
  const settings = loadSettings();
  const mine = new Set((settings.mine || []).map((k) => { const [mk, , d] = k.split("|"); return `${mk}|${+d}`; }));
  const [ty, tm, td] = todayKST();
  // 위젯에 합산할 배 (설정 → 홈 화면 위젯, 중복 선택). 고르지 않았으면 전부
  const pick = Array.isArray(settings.widgetBoats) && settings.widgetBoats.length ? settings.widgetBoats.filter((n) => KEEP.includes(n)) : KEEP;
  const allow = new Set(pick.length ? pick : KEEP);
  // 위젯 위에 합산 중인 배 이름 한 줄 (전부면 '모든 배')
  const names = allow.size >= KEEP.length ? "모든 배" : KEEP.filter((n) => allow.has(n)).join(" · ");
  const boatsOf = (MM) => Object.entries((MM && MM.boats) || {}).filter(([n]) => allow.has(n)).map(([, b]) => b);
  const off = widgetOffset(args.widgetParameter);
  const cdt = new Date(Date.UTC(ty, tm - 1 + off, 1)), cy = cdt.getUTCFullYear(), cm = cdt.getUTCMonth() + 1, cd = off ? 0 : td; // 달력에 그릴 달
  const mk = ymKey(cy, cm), M = (data && data.months && data.months[mk]) || { boats: {} };
  const L = daysIn(cy, cm);
  const cnt = Array(L + 1).fill(0), any = Array(L + 1).fill(false);
  for (const b of boatsOf(M)) (b.s || []).forEach((v, i) => { if (v !== null && v !== undefined) any[i + 1] = true; if (typeof v === "number" && v > 0) cnt[i + 1] += v; });
  const fam = config.widgetFamily || "large";
  const C = { bg: "#ffffff", ink: "#1d2b36", mute: "#9aa7b1", sun: "#d64545", sat: "#2f6fde", open: "#1f9d55", today: "#e3eefb", gold: "#e3a21a", head: "#1f5f99" };
  const w = new ListWidget();
  w.backgroundColor = new Color(C.bg);
  w.url = "scriptable:///run/" + encodeURIComponent(Script.name()) + "?ym=" + mk; // 누르면 앱이 그 달로 열림
  w.refreshAfterDate = new Date(Date.now() + 3600e3);
  const txt = (st, t, size, color, bold) => { const x = st.addText(t); x.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size); x.textColor = new Color(color); x.lineLimit = 1; return x; };
  const WD = ["일", "월", "화", "수", "목", "금", "토"];
  const stamp = data && data.updatedAt ? data.updatedAt.slice(5, 16).replace("-", "/").replace("T", " ") : "";

  if (fam === "small") { // 작은 위젯: 오늘부터 6일 목록
    w.setPadding(10, 12, 10, 12);
    txt(w, "낚시배 빈자리", 12, C.head, true);
    const nm = txt(w, names, 9, C.mute); nm.lineLimit = 1; nm.minimumScaleFactor = 0.7;
    w.addSpacer(4);
    for (let i = 0; i < 6; i++) {
      const dt = new Date(Date.UTC(ty, tm - 1, td + i)), y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate();
      const MM = (data && data.months && data.months[ymKey(y, m)]) || { boats: {} };
      let n = 0, seen = false;
      for (const b of boatsOf(MM)) { const v = (b.s || [])[d - 1]; if (v !== null && v !== undefined) seen = true; if (typeof v === "number" && v > 0) n += v; }
      const r = w.addStack(); r.layoutHorizontally(); r.centerAlignContent();
      const wd = dt.getUTCDay();
      txt(r, `${m}/${d} ${WD[wd]}`, 12, wd === 0 ? C.sun : wd === 6 ? C.sat : C.ink, i === 0);
      if (mine.has(`${ymKey(y, m)}|${d}`)) txt(r, " ★", 11, C.gold, true);
      r.addSpacer();
      txt(r, n ? `${n}석` : seen ? "마감" : "–", 12, n ? C.open : C.mute, !!n);
      w.addSpacer(2);
    }
    w.addSpacer();
    if (stamp) txt(w, stamp + " 기준", 8, C.mute);
    return w;
  }

  const big = fam !== "medium";
  const first = new Date(Date.UTC(cy, cm - 1, 1)).getUTCDay(), rows = Math.ceil((first + L) / 7);
  const cw = 44, ch = big ? Math.min(54, Math.floor(280 / rows)) : Math.floor(98 / rows);
  w.setPadding(big ? 12 : 8, 10, big ? 10 : 6, 10);
  const head = w.addStack(); head.layoutHorizontally(); head.centerAlignContent();
  txt(head, `${cy !== ty ? cy + "년 " : ""}${cm}월 빈자리`, big ? 15 : 12, C.head, true);
  head.addSpacer();
  if (stamp) txt(head, stamp + " 기준", big ? 9 : 8, C.mute);
  const nm = txt(w, names, big ? 10 : 8, C.ink); nm.lineLimit = big ? 2 : 1; nm.minimumScaleFactor = 0.7;
  w.addSpacer(big ? 6 : 2);
  const wk = w.addStack(); wk.layoutHorizontally();
  WD.forEach((t, i) => { const c = wk.addStack(); c.size = new Size(cw, big ? 14 : 11); c.centerAlignContent(); const x = txt(c, t, big ? 10 : 8, i === 0 ? C.sun : i === 6 ? C.sat : C.mute, true); x.centerAlignText(); });
  for (let r = 0; r < rows; r++) {
    const row = w.addStack(); row.layoutHorizontally();
    for (let c = 0; c < 7; c++) {
      const d = r * 7 + c - first + 1;
      const cell = row.addStack(); cell.size = new Size(cw, ch); cell.cornerRadius = 7;
      if (d < 1 || d > L) continue;
      const past = d < cd, isMine = mine.has(`${mk}|${d}`);
      if (d === cd) cell.backgroundColor = new Color(C.today);
      if (isMine) { cell.borderColor = new Color(C.gold); cell.borderWidth = 2; }
      const color = past ? C.mute : c === 0 ? C.sun : c === 6 ? C.sat : C.ink;
      if (big) {
        cell.layoutVertically(); cell.centerAlignContent();
        const a = cell.addStack(); a.layoutHorizontally(); a.addSpacer(); txt(a, String(d), 12, color, d === cd); a.addSpacer();
        const b = cell.addStack(); b.layoutHorizontally(); b.addSpacer();
        if (!past && cnt[d]) txt(b, `${cnt[d]}석`, 10, C.open, true); else txt(b, !past && any[d] ? "마감" : " ", 9, C.mute);
        b.addSpacer();
      } else {
        cell.layoutHorizontally(); cell.centerAlignContent(); cell.addSpacer();
        txt(cell, String(d), 10, color, d === cd);
        if (!past && cnt[d]) { cell.addSpacer(2); txt(cell, String(cnt[d]), 9, C.open, true); }
        cell.addSpacer();
      }
    }
  }
  return w;
}

async function run() {
  if (config.runsInWidget && !/알림/.test(String(args.widgetParameter || ""))) {
    // 홈 화면 위젯(기본): 작은 달력. 위젯 설정의 Parameter에 '알림'이라고 적으면 예전처럼 빈자리 알림 위젯.
    try { Script.setWidget(await calendarWidget()); } catch (e) { const w = new ListWidget(); w.addText("낚시배 빈자리"); w.addText("오류: " + e.message); Script.setWidget(w); }
    return;
  }
  if (!config.runsInWidget && !config.runsInApp) {
    // 단축어 자동화(앱을 열지 않고 실행): 캘린더 결과를 새로 받아 두고, 알림 조건도 확인
    let out = "";
    try { out = await backgroundCheck(); } catch (e) { out = "오류: " + e.message; }
    Script.setShortcutOutput(out);
    return;
  }
  if (config.runsInWidget) {
    // 위젯: 화면 없이 조건만 확인하고 알림
    const settings = loadSettings();
    if (config.runsInWidget || (settings.watch && settings.watch.on)) {
      let out = "";
      try { out = await watch(); } catch (e) {
        const w = new ListWidget(); w.addText("낚시배 빈자리"); w.addText("오류: " + e.message);
        if (config.runsInWidget) Script.setWidget(w);
        out = "오류: " + e.message;
      }
      Script.setShortcutOutput(out);
      return;
    }
    // 단축어에서 '앱에서 실행'이 꺼진 경우 → Scriptable 앱을 열어 다시 실행
    try { Safari.open("scriptable:///run/" + encodeURIComponent(Script.name())); } catch (e) {}
    Script.setShortcutOutput("단축어의 Run Script 동작에서 '앱에서 실행(Run In App)'을 켜 주세요.");
    return;
  }
  // 앱이 아직 떠 있는 상태에서 홈 아이콘을 다시 누르면, 이전 화면이 닫히는 도중에 새 화면을
  // 띄우려다 빈 화면이 될 수 있다 → 이전 실행이 살아 있으면 잠깐 기다리고, 화면이 바로 닫혀 버리면 다시 띄운다
  const ALIVE = fm.joinPath(DIR, "alive.txt");
  let prevAlive = false;
  try { prevAlive = fm.fileExists(ALIVE) && Date.now() - +fm.readString(ALIVE) < 4000; } catch (e) {}
  if (prevAlive) await sleep(1500);
  let wv, shown;
  for (let i = 0; i < 3; i++) {
    wv = new WebView();
    // 1) 바로 '불러오는 중' 화면을 띄운다 (빈 화면 방지)
    await wv.loadHTML(LOADING);
    let closed = false;
    shown = wv.present(true).then(() => { closed = true; });
    await sleep(prevAlive ? 700 : 350);
    if (!closed) break; // 제대로 떠 있음
    await sleep(800);   // 바로 닫혔으면(이전 화면과 겹침) 다시 시도
  }
  let viewOpen = true;
  shown.then(() => { viewOpen = false; });
  const beat = () => { if (!viewOpen) return; try { fm.writeString(ALIVE, String(Date.now())); } catch (e) {} Timer.schedule(1500, false, beat); };
  beat();
  const say = (t) => { console.log(t); return wv.evaluateJavaScript(`(function(){var m=document.getElementById("m");if(m)m.textContent=${JSON.stringify(t)};return 1})()`).catch(() => null); };
  try {
    await main(wv, say, shown);
  } catch (e) {
    console.error(e);
    await say("오류: " + (e && e.message ? e.message : e));
    const a = new Alert();
    a.title = "실행 중 오류";
    a.message = String(e && e.message ? e.message : e);
    a.addAction("확인");
    await a.presentAlert();
  }
  await shown;
  // 화면을 닫은 뒤에도 Scriptable이 몇 초 더 정리하므로, 그동안 다시 열면 기다렸다 띄우도록 닫은 시각을 남긴다
  try { fm.writeString(ALIVE, String(Date.now())); } catch (e) {}
}

async function main(wv, say, wvClosed) {
  // 마지막 결과(아이폰에 저장된 것, 없으면 웹 캘린더의 것)로 캘린더를 먼저 띄운다
  let old = null; try { old = fm.fileExists(CACHE) ? JSON.parse(fm.readString(CACHE)) : null; } catch (e) {}
  // 빨리 띄우기: 아이폰에 저장된 결과가 있으면 그걸로 바로 그리고, 웹 캘린더 결과는 뒤에서 받아 더 새것이면 바꿔 넣는다
  const webP = loadJSON(RAW + "data/seats.json?t=" + Date.now());
  if (!old) { await say("마지막 결과 불러오는 중…"); old = (await webP) || { months: {} }; }
  old = dropStale(old);
  const settings = loadSettings();
  const okAhead = (n) => Number.isInteger(n) && n >= 1 && n <= 12;
  let ahead = okAhead(settings.ahead) ? settings.ahead : 1; // 처음 열 때 확인할 기간(기본 1개월, 설정에서 1~12개월)
  const all = monthsAhead();
  let first = all.slice(0, ahead);
  const checked = new Set(first.map(([y, m]) => ymKey(y, m)));

  // 캘린더 화면도 아이폰에 저장해 둔 것으로 바로 띄우고, 새 화면은 뒤에서 받아 다음 실행부터 쓴다
  const PAGE_FILE = fm.joinPath(DIR, "page.html");
  const okHtml = (h) => !!h && h.includes("<head>") && h.includes("</body>");
  const pageP = new Request(PAGE + "?t=" + Date.now()).loadString().then((h) => { if (okHtml(h)) { try { fm.writeString(PAGE_FILE, h); } catch (e) {} return h; } return null; }, () => null);
  let html = null; try { if (fm.fileExists(PAGE_FILE)) html = fm.readString(PAGE_FILE); } catch (e) {}
  if (!okHtml(html)) { await say("캘린더 화면 받는 중…"); html = await pageP; }
  if (!okHtml(html)) throw new Error("캘린더 화면을 받지 못했습니다. 인터넷 연결을 확인하세요.");
  // 아이폰 캘린더에서 읽은 내 예약 (기본 켜짐): 화면은 지난번 결과로 먼저 그리고, 다 읽으면 바꿔 넣는다
  const calOn = !settings.mineCal || settings.mineCal.read !== false;
  const calKeys = calOn ? (settings.mineCalKeys || []) : [];
  const injectNow = () => `<script>window.__inScriptable=true;window.__sites=${JSON.stringify(SITES.map(({ info, ...x }) => ({ ...x, boats: info })))};window.__seatsData=${JSON.stringify(old)};window.__checked=${JSON.stringify([...checked])};window.__ahead=${ahead};window.__webUp=${Keychain.contains(TOKEN_KEY)};window.__startYm=${JSON.stringify(((args.queryParameters || {}).ym || "").slice(0, 7))};window.__mode=${JSON.stringify(settings.mode === "normal" ? "normal" : "fast")};window.__wboats=${JSON.stringify(loadSettings().widgetBoats || null)};window.__watch=${JSON.stringify(loadSettings().watch || null)};window.__boatsAll=${JSON.stringify(KEEP)};window.__mine=${JSON.stringify(loadSettings().mine || [])};window.__mineCal=${JSON.stringify(calKeys)};window.__mineOpt=${JSON.stringify(settings.mineCal || {})};</script>`;
  let busy = false;
  const queue = [];
  const js = (code) => wv.evaluateJavaScript(code).catch(() => null);
  const label = (list) => list.map(([y, m]) => `${m}월`).join("·");

  const appParser = (kind, html, y, m) => wv.evaluateJavaScript(`__fishParse(${JSON.stringify(kind)}, ${JSON.stringify(html)}, ${y}, ${m})`);
  async function check(list) {
    const keys = list.map(([y, m]) => ymKey(y, m));
    keys.forEach((k) => checked.add(k));
    await js(`window.__checked=${JSON.stringify([...checked])};__setChecking(true, ${JSON.stringify(label(list) + " 확인하는 중…")})`);
    const results = {}, errors = [], sources = { ...(old.sources || {}) };
    const doing = {};
    const show = () => js(`__setChecking(true, ${JSON.stringify("확인 중: " + Object.values(doing).filter(Boolean).join(", "))})`);
    // 네 사이트를 동시에 확인하되, 한 사이트 안에서는 요청을 하나씩 보낸다
    const groups = SITES.map((x) => [x]);
    // 빠른 모드(기본): 그림 속 어종은 새로 읽지 않고 읽어 둔 결과만 쓴다. 보통 모드: 새 그림도 읽는다
    const ocr = makeOcr(loadSettings().mode === "normal" ? (code) => wv.evaluateJavaScript(code, true) : null);
    await Promise.all(groups.map(async (group, gi) => {
      for (const site of group) {
        try {
          results[site.id] = await scrapeSite(appParser, site, list, (t) => { doing[gi] = t; return show(); }, ocr);
          sources[site.id] = kstIso();
        } catch (e) {
          errors.push(`${site.host}: ${e.message}`);
        }
        doing[gi] = "";
        // 끝난 사이트부터 바로 캘린더에 반영
        await js(`__applySeats(${JSON.stringify(merge(old, results, [], sources, keys))})`);
      }
    }));
    const data = merge(old, results, errors, sources, keys);
    try { await notifyMine(mineCancelled(old, data, mineKeys(loadSettings())), loadSettings()); } catch (e) {}
    fm.writeString(CACHE, JSON.stringify(data));
    old = data;
    await js(`__applySeats(${JSON.stringify(data)})`);
    let msg = errors.length ? `일부 사이트를 읽지 못했습니다: ${errors.join(" / ")}` : "";
    const om = ocr.summary(); if (om) msg += (msg ? " · " : "") + om;
    // 새로 생긴 자리는 아이폰 알림으로도 (앱을 보고 있지 않아도 알림 센터에 남음)
    const newItems = [...data.reopened.map((x) => "취소로 다시 열림 · " + x), ...(data.opened || []).map((x) => "새로 열림 · " + x)];
    if (newItems.length) {
      try {
        const n = new Notification();
        n.title = `새로 생긴 자리 ${newItems.length}곳`;
        n.body = newItems.slice(0, 6).join("\n") + (newItems.length > 6 ? `\n외 ${newItems.length - 6}곳` : "");
        n.sound = alertSound();
        n.openURL = "scriptable:///run/" + encodeURIComponent(Script.name());
        n.schedule();
      } catch (e) {}
    }
    if ((data.opened || []).length) msg = `새로 열린 예약 ${data.opened.length}곳: ${data.opened.slice(0, 6).join(", ")}${data.opened.length > 6 ? " 외" : ""}` + (msg ? " · " + msg : "");
    if (data.reopened.length) msg = `취소로 다시 열린 자리 ${data.reopened.length}곳: ${data.reopened.slice(0, 6).join(", ")}${data.reopened.length > 6 ? " 외" : ""}` + (msg ? " · " + msg : "");
    try { await upload(data); } catch (e) { msg += (msg ? " · " : "") + "웹 캘린더 반영 실패: " + e.message; }
    await js(`__setChecking(false, ${JSON.stringify(msg)})`);
  }
  // 확인 요청은 차례로 처리 (동시에 두 번 돌지 않게)
  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length) { try { await check(queue.shift()); } catch (e) {} }
    busy = false;
  }
  const want = (list) => { if (list.length) { queue.push(list); pump(); } };
  const ymOf = (u) => { const m = /[?&]ym=(\d{4})-(\d{2})/.exec(u); return m ? [+m[1], +m[2]] : null; };

  // 앱을 열 때 알림 조건도 한 번 확인 (캘린더 확인이 끝난 뒤). 결과는 캘린더에도 넣어 먼 달도 배너에 보이게
  async function appWatch() {
    const cfg = loadSettings().watch;
    const rules = watchRules(cfg || {});
    if (!cfg || !cfg.on || !Object.values(rules).some((r) => r && r.on)) return;
    while (busy || queue.length) await sleep(800);
    busy = true;
    try {
      await js(`__setChecking(true, "알림 조건 확인 중…")`);
      const { rows, errors, monthKeys } = await watchCollect(rules, appParser);
      let state = {}; try { state = JSON.parse(fm.readString(WATCH_STATE)) || {}; } catch (e) {}
      const res = watchDecide(rules, rows, state);
      fm.writeString(WATCH_STATE, JSON.stringify(res.state));
      const msg = watchMessage(res.fresh);
      if (res.fresh.length) {
        const n = new Notification();
        n.title = msg.title; n.body = msg.body; n.sound = alertSound();
        n.openURL = "scriptable:///run/" + encodeURIComponent(Script.name());
        await n.schedule();
      }
      old = applyWatchRows(old, rows, errors.length ? [] : monthKeys).data;
      fm.writeString(CACHE, JSON.stringify(old));
      await js(`__applySeats(${JSON.stringify(old)})`);
      const summary = "알림 조건 확인 · " + countsText(ruleCounts(rules, res, old)) + (errors.length ? " (일부 사이트 실패)" : "");
      await js(`__setChecking(false, ${JSON.stringify(res.fresh.length ? `${msg.title}: ${msg.lines.join(", ")} — ${summary}` : summary)})`);
    } catch (e) {
      await js(`__setChecking(false, ${JSON.stringify("알림 조건 확인 중 오류: " + e.message)})`);
    } finally { busy = false; pump(); }
  }

  // 앱을 열 때 선사 공지사항 확인: 새 공지는 아이폰 알림(누르면 그 공지가 열림) + 메인의 '선사 공지사항'
  async function appNotices() {
    let st0 = {}; try { st0 = JSON.parse(fm.readString(NOTICE_STATE)) || {}; } catch (e) {}
    if (st0.sites) await js(`__setNotices(${JSON.stringify(st0.sites.map((x) => ({ ...x, items: (x.items || []).map((n) => ({ ...n, isNew: false })) })))}, 0)`);
    try {
      const parseN = (kind, html, base) => wv.evaluateJavaScript(`__noticeParse(${JSON.stringify(kind)}, ${JSON.stringify(html)}, ${JSON.stringify(base)})`);
      const res = await checkNotices(parseN, get, st0);
      fm.writeString(NOTICE_STATE, JSON.stringify(res.state));
      await js(`__setNotices(${JSON.stringify(res.sites)}, ${res.fresh.length})`);
      for (const n of res.fresh.slice(0, 5)) {
        const x = new Notification();
        x.title = `${n.site} 새 공지`; x.body = n.title; x.sound = alertSound();
        x.openURL = n.url; // 누르면 그 공지가 열림
        await x.schedule();
      }
      if (res.fresh.length > 5) {
        const x = new Notification();
        x.title = `새 공지 ${res.fresh.length}건`; x.body = res.fresh.slice(5).map((n) => `${n.site} · ${n.title}`).join("\n");
        x.openURL = "scriptable:///run/" + encodeURIComponent(Script.name());
        await x.schedule();
      }
    } catch (e) { console.error(e); }
  }

  wv.shouldAllowRequest = (req) => {
    const u = req.url || "";
    if (u.startsWith("fishing://check")) { // 지금 확인: 3개월 + 보고 있는 달(그 뒤라면)
      const list = [...first];
      const v = ymOf(u);
      if (v && !list.some(([y, m]) => y === v[0] && m === v[1]) && ymKey(...v) > ymKey(...first[0])) list.push(v);
      want(list); return false;
    }
    if (u.startsWith("fishing://token")) { // 웹 캘린더에도 올리기: 토큰 넣기·지우기
      (async () => {
        if (/off/.test(u)) { if (Keychain.contains(TOKEN_KEY)) Keychain.remove(TOKEN_KEY); Keychain.set(ASKED_KEY, "1"); return js(`__setWebUp(false,"토큰을 지웠어요")`); }
        const a = new Alert();
        a.title = "GitHub 토큰";
        a.message = "'calendar' 저장소의 Contents 읽기·쓰기 권한만 있는 토큰(github_pat_…)을 붙여 넣으세요.";
        a.addSecureTextField("github_pat_…", "");
        a.addAction("저장");
        a.addCancelAction("취소");
        const i = await a.presentAlert();
        const t = (a.textFieldValue(0) || "").trim();
        if (i !== 0 || !t) return;
        const prev = Keychain.contains(TOKEN_KEY) ? Keychain.get(TOKEN_KEY) : null;
        Keychain.set(TOKEN_KEY, t);
        await js(`__setWebUp(true,"올려 보는 중…")`);
        try { await upload(old); await js(`__setWebUp(true,"웹 캘린더에 올렸어요 (${old.updatedAt ? old.updatedAt.slice(5, 16).replace("T", " ") : ""} 결과)")`); }
        catch (e) { if (prev) Keychain.set(TOKEN_KEY, prev); else Keychain.remove(TOKEN_KEY); await js(`__setWebUp(${!!prev},${JSON.stringify("올리지 못했어요: " + (e.message || e) + " — 토큰과 권한을 확인해 주세요")})`); }
      })();
      return false;
    }
    if (u.startsWith("fishing://sites?find=")) { // 선사 추가: 주소에서 배 찾기
      findSite(decodeURIComponent(u.slice("fishing://sites?find=".length)), (code) => wv.evaluateJavaScript(code)).then((res) => js(`__sitesFound(${JSON.stringify(res)})`));
      return false;
    }
    if (u.startsWith("fishing://sites?save=")) { // 선사 목록 저장 → 화면을 새 목록으로 다시 그리고 다시 확인
      (async () => {
        let list = null;
        try { list = JSON.parse(decodeURIComponent(u.slice("fishing://sites?save=".length))); } catch (e) {}
        saveSettings({ ...loadSettings(), sites: Array.isArray(list) && list.length ? list : null });
        applySites(list);
        await wv.loadHTML(html.replace("<head>", "<head>" + injectNow()), PAGE);
        await wv.evaluateJavaScript(parserSrc());
        checked.clear(); want(first);
      })();
      return false;
    }
    if (u.startsWith("fishing://settings")) { // 설정: 확인 기간·방식 변경
      const wb = (/wboats=([^&]*)/.exec(u) || [])[1];
      if (wb !== undefined) { const list = decodeURIComponent(wb).split("|").filter((x) => KEEP.includes(x)); saveSettings({ ...loadSettings(), widgetBoats: list.length ? list : null }); return false; }
      const md = (/mode=(fast|normal)/.exec(u) || [])[1];
      if (md) { saveSettings({ ...loadSettings(), mode: md }); return false; }
      const n = +((/ahead=(\d+)/.exec(u) || [])[1]);
      if (okAhead(n)) {
        ahead = n; saveSettings({ ...loadSettings(), ahead: n });
        first = all.slice(0, n);
        const more = first.filter(([y, m]) => !checked.has(ymKey(y, m))); // 늘린 만큼만 바로 확인
        if (more.length) want(more);
      }
      return false;
    }
    if (u.startsWith("fishing://mine?")) { // 내 예약 표시/해제
      try {
        const q = (n) => decodeURIComponent((new RegExp("[?&]" + n + "=([^&]*)").exec(u) || [])[1] || "");
        const list = JSON.parse(q("list") || "[]"), key = q("key"), on = q("on") === "1";
        const cur = loadSettings();
        saveSettings({ ...cur, mine: list });
        if (key && cur.mineCal && cur.mineCal.add) (on ? calAdd(key) : calRemove(key)).then(() => js(`__setChecking(false, ${JSON.stringify(on ? "내 예약으로 표시하고 아이폰 캘린더에 추가했어요." : "내 예약을 해제하고 캘린더 일정도 지웠어요.")})`));
      } catch (e) {}
      return false;
    }
    if (u.startsWith("fishing://minecal")) { // 아이폰 캘린더 연동 켜기/끄기
      const add = /add=1/.test(u), read = /read=1/.test(u), cur = loadSettings();
      saveSettings({ ...cur, mineCal: { add, read } });
      (async () => {
        if (add && !(cur.mineCal && cur.mineCal.add)) for (const k of cur.mine || []) await calAdd(k);
        let ck = [];
        if (read) ck = await calRead();
        saveSettings({ ...loadSettings(), mineCalKeys: ck });
        await js(`__setMineCal(${JSON.stringify(ck)})`);
        await js(`__setChecking(false, ${JSON.stringify((add ? "내 예약을 아이폰 캘린더에 추가해요. " : "") + (read ? `아이폰 캘린더에서 내 예약 ${ck.length}건을 찾았어요.` : "캘린더에서 읽기를 껐어요."))})`);
      })();
      return false;
    }
    if (u.startsWith("fishing://watch")) { // 빈자리 알림 설정 저장
      try {
        const cfg = JSON.parse(decodeURIComponent((/cfg=([^&]*)/.exec(u) || [])[1] || "null"));
        if (cfg && typeof cfg === "object") {
          saveSettings({ ...loadSettings(), watch: cfg });
          js(`__setChecking(false, ${JSON.stringify(cfg.on ? "빈자리 알림을 켰어요. 앱을 닫아 둔 동안에도 확인하려면 단축어 자동화(또는 위젯)를 설정하세요." : "빈자리 알림을 껐어요.")})`);
        }
      } catch (e) {}
      return false;
    }
    if (u.startsWith("fishing://sound")) { // 알림 소리 들어 보기: 4초 뒤 그 소리로 알림 하나
      const k = (/k=([a-z_]+)/.exec(u) || [])[1] || "default";
      const n = new Notification();
      n.title = "알림 소리 시험"; n.body = k === "off" ? "소리 없이 이렇게 와요" : "이 소리로 알려요"; n.sound = k === "off" ? null : SOUNDS.includes(k) ? k : "default";
      n.setTriggerDate(new Date(Date.now() + 4000));
      n.schedule();
      js(`__setChecking(false, "4초 뒤 시험 알림이 와요. 홈 화면으로 나가서 들어 보세요. (무음 모드면 소리가 안 나요 — 저장해야 실제 알림에 적용돼요)")`);
      return false;
    }
    if (u.startsWith("fishing://testnote")) { // 미리보기: 실제 아이폰 알림 모양 보기
      let lines = [];
      try { lines = JSON.parse(decodeURIComponent((/d=([^&]*)/.exec(u) || [])[1] || "[]")); } catch (e) {}
      if (!lines.length) lines = ["11/14(토) 루키나호 3석"];
      const samples = [
        [`빈자리 ${Math.min(3, lines.length)}곳`, lines.slice(0, 3)],
        [`취소로 다시 열린 자리 ${Math.min(3, lines.length)}곳`, lines.slice(0, 3)],
        [`예약이 새로 열림 ${Math.max(1, lines.length - 3)}곳`, lines.length > 3 ? lines.slice(3) : lines.slice(0, 1)],
      ];
      samples.forEach(([t, b], i) => {
        const n = new Notification();
        n.title = "[미리보기] " + t; n.body = b.join("\n"); n.sound = alertSound();
        n.openURL = "scriptable:///run/" + encodeURIComponent(Script.name());
        n.setTriggerDate(new Date(Date.now() + 5000 + i * 2500));
        n.schedule();
      });
      js(`__setChecking(false, ${JSON.stringify("5초 뒤 아이폰 알림 예시 3개가 옵니다. 홈 화면이나 잠금 화면으로 나가서 확인해 보세요. (안 오면 설정 → 알림 → Scriptable에서 알림 허용)")})`);
      return false;
    }
    if (u.startsWith("fishing://month")) { // 캘린더를 아직 확인하지 않은 달로 넘김
      const v = ymOf(u);
      if (v && !checked.has(ymKey(...v)) && ymKey(...v) >= ymKey(...first[0])) want([v]);
      return false;
    }
    if (/^https?:/.test(u) && !u.startsWith(PAGE) && !u.startsWith("https://fonts.")) { Safari.open(u); return false; }
    return true;
  };
  await say("캘린더 그리는 중…");
  await wv.loadHTML(html.replace("<head>", "<head>" + injectNow()), PAGE);
  await wv.evaluateJavaScript(parserSrc());
  console.log("캘린더 표시 완료, 확인 시작");
  // 화면 지킴이: 캘린더 화면이 하얗게 비어 버리면(화면을 그리는 부분이 멈추거나 꺼짐) 다시 그린다
  let viewDone = false, bad = 0;
  const guard = async () => {
    if (viewDone) return;
    if (busy) { bad = 0; Timer.schedule(3000, false, guard); return; } // 확인 중에는 화면이 바빠 응답이 늦을 수 있어 건너뜀
    const ok = await Promise.race([
      wv.evaluateJavaScript(`document.getElementById("mtitle")&&document.body.innerText.length>20?1:0`).catch(() => 0),
      sleep(4000).then(() => 0),
    ]);
    bad = ok === 1 ? 0 : bad + 1;
    if (bad >= 2) {
      bad = 0; console.log("빈 화면 감지 → 다시 그림");
      try { await wv.loadHTML(html.replace("<head>", "<head>" + injectNow()), PAGE); await wv.evaluateJavaScript(parserSrc()); await js(`window.__checked=${JSON.stringify([...checked])};__setChecking(false, "")`); } catch (e) {}
    }
    Timer.schedule(3000, false, guard);
  };
  Timer.schedule(3000, false, guard);
  wvClosed.then(() => { viewDone = true; });
  webP.then((web) => {
    if (!web || busy || queue.length || !(web.updatedAt > (old.updatedAt || ""))) return;
    old = dropStale(web);
    js(`__applySeats(${JSON.stringify(old)})`);
  });
  await askToken();
  // 앱을 닫아 둔 동안(자동화) 최근 30분 안에 확인했으면 열 때 다시 확인하지 않는다
  let cached = null; try { cached = JSON.parse(fm.readString(CACHE)); } catch (e) {}
  const age = Date.now() - Date.parse((cached && cached.updatedAt) || 0);
  if (cached && cached.pv === PARSE_V && age < 30 * 60e3 && first.every(([y, m]) => old.months && ymKey(y, m) in old.months)) {
    first.forEach(([y, m]) => checked.add(ymKey(y, m)));
    await js(`window.__checked=${JSON.stringify([...checked])};__setChecking(false, ${JSON.stringify("최근 확인 결과입니다. 새로 확인하려면 '지금 확인'을 누르세요.")})`);
  } else want(first);
  if (calOn) calRead().then(async (ck) => {
    saveSettings({ ...loadSettings(), mineCalKeys: ck });
    await js(`__setMineCal(${JSON.stringify(ck)})`);
  });
  appWatch().then(appNotices, appNotices);
}

module.exports = { run };
