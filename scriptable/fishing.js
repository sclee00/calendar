// 연안부두 낚시배 빈자리 — 아이폰 Scriptable 본체
// 이 파일은 GitHub(sclee00/calendar)에 두고, Scriptable의 짧은 실행 코드(scriptable/loader.js)가 받아서 실행한다.
// 아이폰이 한국 통신망으로 네 선사 예약 화면을 직접 읽으므로 칸피싱·제일바다낚시의 해외 접속 차단에 걸리지 않는다.
// 자동으로 반복 확인하지 않는다. 실행(아이콘·"지금 확인")할 때 사이트마다 한 번, 요청은 1.2초 간격으로 하나씩.

const REPO = "sclee00/calendar";
const PAGE = "https://sclee00.github.io/calendar/";
const RAW = `https://raw.githubusercontent.com/${REPO}/main/`;
const SITES = [
  { id: "lukina", kind: "ss", host: "lukina.sunsang24.com", boats: ["루키나 2호", "루키나호"] },
  { id: "dy", kind: "ss", host: "dyfishing.sunsang24.com", boats: ["팀에프원", "팀에프투", "고트호"] },
  { id: "khan", kind: "tf", step: 8, host: "khanfishing.com", boats: ["와이파이호", "욜로호", "시크릿호", "베스트1호", "베스트3호", "제트호", "왕만두호"] },
  { id: "jeil", kind: "tf", step: 4, host: "jnaksi.com", boats: ["모비딕호", "마루호", "스모키호", "로또호"] },
];
const KEEP = SITES.flatMap((s) => s.boats);
const GAP = 300; // 한 사이트 안에서 요청 사이 간격(ms). 사이트마다 요청은 하나씩만 보낸다
const TOKEN_KEY = "fishing_github_token";
const ASKED_KEY = "fishing_github_asked";

const fm = FileManager.local();
const DIR = fm.joinPath(fm.documentsDirectory(), "fishing-seats");
if (!fm.fileExists(DIR)) fm.createDirectory(DIR, true);
const CACHE = fm.joinPath(DIR, "seats.json");
const SETTINGS = fm.joinPath(DIR, "settings.json");
const loadSettings = () => { try { return JSON.parse(fm.readString(SETTINGS)) || {}; } catch (e) { return {}; } };
const saveSettings = (o) => fm.writeString(SETTINGS, JSON.stringify(o));

const pad = (n) => String(n).padStart(2, "0");
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
function classifySpecies(primary, fallback) {
  // 어종 분류: f = 물고기(광어·우럭 등), j = 주꾸미·갑오징어 등 두족류, u = 어종 미표기
  // primary(어종 칸)를 먼저 보고, 비어 있거나 모르는 말이면 fallback(공지·행 글자)에서 찾는다. 둘 다 없으면 추측하지 않고 u.
  const FISH = /광어|우럭|농어|민어|참돔|도미|타이라바|백조기|조기|삼치|부시리|방어|대구|열기|볼락|노래미|놀래미|우럭광어|광우|우광|외수질|다운샷|지깅|라이트지깅|침선|생미끼|선상낚시|원투|흘림|외줄/;
  const CEPH = /주꾸미|쭈꾸미|쭈구미|쭈갑|갑쭈|쭈\.갑|갑\.쭈|갑오징어|갑오|문어|한치|오징어|에기|쭈낚/;
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

const PARSER = `
window.__fishParse = function (kind, html, y, m) {
  const KEEP = ${JSON.stringify(KEEP)};
  const sq = s => (s || "").replace(/\\s+/g, "");
  const norm = s => { s = sq(s).replace(/\\(.*$/, ""); return KEEP.find(k => s === sq(k) || s.startsWith(sq(k))) || null; };
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
      rows.push([dd, name, stc(alt), spc(kind2, rowText)]); found++;
    });
  }
  return { rows, found };
};
true;`;

async function scrapeSite(wv, site, monthList, progress) {
  const out = {};
  const put = (y, m, d, name, s, sp, no) => {
    if (!name || s === null) return;
    const k = ymKey(y, m), L = daysIn(y, m);
    out[k] = out[k] || {};
    const b = (out[k][name] = out[k][name] || { s: Array(L).fill(null), sp: Array(L).fill("j") });
    b.s[d - 1] = s; b.sp[d - 1] = sp;
    if (no) { b.no = b.no || Array(L).fill(null); b.no[d - 1] = no; }
  };
  const parse = async (html, y, m) =>
    wv.evaluateJavaScript(`__fishParse(${JSON.stringify(site.kind)}, ${JSON.stringify(html)}, ${y}, ${m})`);
  let seen = false;
  for (const [y, m] of monthList) {
    await progress(`${site.host} ${m}월`);
    if (site.kind === "ss") {
      const res = await parse(await get(`https://${site.host}/ship/schedule_fleet/${y}${pad(m)}`), y, m);
      res.rows.forEach(([d, n, s, sp, no]) => put(y, m, d, n, s, sp, no));
      if (res.found) seen = true; else if (seen) break; // 예약이 열린 마지막 달 다음에서 멈춤
    } else {
      let found = 0;
      for (let d = 1; d <= daysIn(y, m); d += site.step || 4) { // 칸피싱은 한 페이지에 8일, 제일은 4일
        const res = await parse(await get(`https://${site.host}/index.php?mid=bk&year=${y}&month=${pad(m)}&day=${pad(d)}`), y, m);
        res.rows.forEach(([dd, n, s, sp]) => put(y, m, dd, n, s, sp));
        found += res.found;
      }
      if (found) seen = true; else if (seen) break;
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
  const reopened = [];
  const keys = new Set(checked);
  for (const k of [...keys].sort()) {
    const prev = oldMonths[k] || { boats: {}, reopen: {} };
    const boats = {}, reopen = {};
    for (const site of SITES) {
      const fresh = results[site.id];
      for (const name of site.boats) {
        if (!fresh) {
          if (prev.boats && prev.boats[name]) boats[name] = prev.boats[name];
          if (prev.reopen && prev.reopen[name]) reopen[name] = prev.reopen[name];
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
      }
    }
    if (Object.keys(boats).length) months[k] = { boats, reopen }; else delete months[k];
  }
  return { updatedAt: kstIso(), ok: errors.length === 0, errors, reopened, sources, months };
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
        rows.push([+day.slice(6), sp.name, stc(alt), spc(kind2, rowText)]); found++;
      });
    }
  }
  return { rows, found };
}

async function makeParser() {
  try { // 가능하면 화면에 띄우지 않는 WebView의 DOM 분석기를 쓴다
    const wv = new WebView();
    await wv.loadHTML("<!doctype html><p>");
    await wv.evaluateJavaScript(PARSER);
    const ok = await wv.evaluateJavaScript(`typeof __fishParse==="function"`);
    if (ok) return (kind, html, y, m) => wv.evaluateJavaScript(`__fishParse(${JSON.stringify(kind)}, ${JSON.stringify(html)}, ${y}, ${m})`);
  } catch (e) {}
  return async (kind, html, y, m) => regexParse(kind, html, y, m);
}

function watchDays(cfg) {
  const kst = new Date(Date.now() + 9 * 3600e3);
  const today = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
  const from = cfg.from ? new Date(cfg.from + "T00:00:00Z") : today;
  const to = cfg.to ? new Date(cfg.to + "T00:00:00Z") : new Date(today.getTime() + 30 * 864e5);
  const dows = Array.isArray(cfg.dows) && cfg.dows.length ? cfg.dows : [0, 1, 2, 3, 4, 5, 6];
  const out = [];
  for (let d = new Date(Math.max(from, today)); d <= to && out.length < 93; d = new Date(d.getTime() + 864e5)) {
    if (dows.includes(d.getUTCDay())) out.push([d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]);
  }
  return out;
}

async function watch() {
  const cfg = (loadSettings().watch) || {};
  const w = new ListWidget();
  w.backgroundColor = new Color("#f3f5f7");
  w.url = "scriptable:///run/" + encodeURIComponent(Script.name());
  const line = (t, size, color, bold) => { const x = w.addText(t); x.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size); x.textColor = new Color(color); x.lineLimit = 2; return x; };
  line("낚시배 빈자리", 13, "#1f5f99", true);
  const done = (hours) => { w.refreshAfterDate = new Date(Date.now() + hours * 3600e3); if (config.runsInWidget) Script.setWidget(w); };
  if (!cfg.on) { line("알림 꺼짐", 12, "#6a7983"); line("앱의 설정에서 켤 수 있어요", 10, "#6a7983"); done(6); return "알림 꺼짐"; }

  const days = watchDays(cfg);
  const boats = Array.isArray(cfg.boats) && cfg.boats.length ? cfg.boats : KEEP;
  const sps = Array.isArray(cfg.sp) && cfg.sp.length ? cfg.sp : ["j", "f", "u"];
  const min = Math.max(1, +cfg.min || 1);
  const want = new Set(days.map(([y, m, d]) => `${ymKey(y, m)}|${d}`));
  const parse = await makeParser();
  const hits = [], seen = {}, errors = [];
  await Promise.all(SITES.filter((s) => s.boats.some((b) => boats.includes(b))).map(async (site) => {
    try {
      const pages = new Map(); // 필요한 페이지만
      for (const [y, m, d] of days) {
        if (site.kind === "ss") pages.set(`${y}${pad(m)}`, [y, m, `https://${site.host}/ship/schedule_fleet/${y}${pad(m)}`]);
        else { const st = site.step || 4, d0 = 1 + st * Math.floor((d - 1) / st); pages.set(`${y}${pad(m)}${d0}`, [y, m, `https://${site.host}/index.php?mid=bk&year=${y}&month=${pad(m)}&day=${pad(d0)}`]); }
      }
      for (const [y, m, url] of pages.values()) {
        const res = await parse(site.kind, await get(url), y, m);
        for (const [d, name, s, sp] of res.rows) {
          if (!boats.includes(name) || !want.has(`${ymKey(y, m)}|${d}`) || !sps.includes(spOf2(sp))) continue;
          const key = `${ymKey(y, m)}|${name}|${d}`;
          seen[key] = s;
          if (typeof s === "number" && s >= min) hits.push({ key, y, m, d, name, s });
        }
      }
    } catch (e) { errors.push(`${site.host}: ${e.message}`); }
  }));

  // 이미 알린 자리는 다시 알리지 않음. 다시 마감되면 기록을 지워서, 또 열리면 다시 알림
  let state = {}; try { state = JSON.parse(fm.readString(WATCH_STATE)) || {}; } catch (e) {}
  const prev = state.prev || {}, notified = state.notified || {};
  for (const k of Object.keys(notified)) if (k in seen && !(typeof seen[k] === "number" && seen[k] >= min)) delete notified[k];
  const fresh = hits.filter((h) => !notified[h.key] && (cfg.mode !== "reopen" || prev[h.key] === 0));
  fresh.forEach((h) => { notified[h.key] = 1; });
  fm.writeString(WATCH_STATE, JSON.stringify({ prev: { ...prev, ...seen }, notified, at: kstIso() }));

  const WD = ["일", "월", "화", "수", "목", "금", "토"];
  const fmt = (h) => `${h.m}/${h.d}(${WD[new Date(Date.UTC(h.y, h.m - 1, h.d)).getUTCDay()]}) ${h.name} ${h.s}석`;
  if (fresh.length) {
    const n = new Notification();
    n.title = cfg.mode === "reopen" ? `취소로 다시 열린 자리 ${fresh.length}곳` : `빈자리 ${fresh.length}곳`;
    n.body = fresh.slice(0, 6).map(fmt).join("\n") + (fresh.length > 6 ? `\n외 ${fresh.length - 6}곳` : "");
    n.openURL = "scriptable:///run/" + encodeURIComponent(Script.name());
    n.sound = "default";
    await n.schedule();
  }
  const now = new Date(Date.now() + 9 * 3600e3);
  line(`${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())} 확인 · 조건 맞는 자리 ${hits.length}곳`, 11, "#18232c");
  hits.slice(0, 3).forEach((h) => line(fmt(h), 11, "#13a06e", true));
  if (errors.length) line("일부 사이트 확인 실패", 10, "#e0473a");
  done(Math.max(0.5, (+cfg.interval || 60) / 60));
  return `조건 맞는 자리 ${hits.length}곳, 새 알림 ${fresh.length}곳`;
}

// ── 예약 도우미 연결 (별도 저장소 sclee00/fishing-b, 'Scriptable 낚시배예약' 스크립트) ──
const BOOK_RE = /\/mypage\/reservation_ready\/\d+|\/_core\/module\/reservation_boat[^/]*\/popup\.step1\.php/;
const BOOK_PATH = fm.joinPath(fm.documentsDirectory(), "fishing-book-main.js");
let booking = false;
async function openBooking(u) {
  if (booking) return;
  booking = true;
  try {
    // 최신 도우미 코드 받기 (실패하면 저장된 것 사용)
    for (const k of ["fishingb_github_token", TOKEN_KEY]) {
      if (!Keychain.contains(k)) continue;
      try {
        const r = new Request("https://api.github.com/repos/sclee00/fishing-b/contents/book.js?ref=main");
        r.headers = { Authorization: "Bearer " + Keychain.get(k), Accept: "application/vnd.github.raw", "User-Agent": "scriptable-fishing" };
        r.timeoutInterval = 8;
        const s = await r.loadString();
        if (r.response.statusCode === 200 && s.includes("module.exports")) { fm.writeString(BOOK_PATH, s); break; }
      } catch (e) {}
    }
    if (fm.fileExists(BOOK_PATH)) await importModule(BOOK_PATH).run({ url: u });
    else Safari.open(u); // 예약 도우미를 아직 설치하지 않았으면 브라우저로
  } catch (e) {
    console.error(e);
    try { Safari.open("scriptable:///run/" + encodeURIComponent("낚시배예약") + "?url=" + encodeURIComponent(u)); } catch (e2) { Safari.open(u); }
  } finally { booking = false; }
}

const LOADING = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;font:16px -apple-system,sans-serif;display:grid;place-items:center;height:100vh;background:#f3f5f7;color:#18232c"><div id="m">낚시배 빈자리 불러오는 중…</div></body>`;

async function run() {
  if (config.runsInWidget || !config.runsInApp) {
    // 위젯·단축어 자동화: 화면 없이 조건만 확인하고 알림
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
  const wv = new WebView();
  // 1) 바로 '불러오는 중' 화면을 띄운다 (빈 화면 방지)
  await wv.loadHTML(LOADING);
  const shown = wv.present(true);
  const say = (t) => { console.log(t); return wv.evaluateJavaScript(`(function(){var m=document.getElementById("m");if(m)m.textContent=${JSON.stringify(t)};return 1})()`).catch(() => null); };
  try {
    await main(wv, say);
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
}

async function main(wv, say) {
  // 마지막 결과(아이폰에 저장된 것, 없으면 웹 캘린더의 것)로 캘린더를 먼저 띄운다
  await say("마지막 결과 불러오는 중…");
  let old = fm.fileExists(CACHE) ? JSON.parse(fm.readString(CACHE)) : null;
  const web = await loadJSON(RAW + "data/seats.json?t=" + Date.now());
  if (!old || (web && web.updatedAt > old.updatedAt)) old = web || old || { months: {} };
  const settings = loadSettings();
  const okAhead = (n) => Number.isInteger(n) && n >= 1 && n <= 12;
  let ahead = okAhead(settings.ahead) ? settings.ahead : 1; // 처음 열 때 확인할 기간(기본 1개월, 설정에서 1~12개월)
  const all = monthsAhead();
  let first = all.slice(0, ahead);
  const checked = new Set(first.map(([y, m]) => ymKey(y, m)));

  await say("캘린더 화면 받는 중…");
  const html = await new Request(PAGE + "?t=" + Date.now()).loadString();
  if (!html || !html.includes("<head>")) throw new Error("캘린더 화면을 받지 못했습니다. 인터넷 연결을 확인하세요.");
  const inject = `<script>window.__inScriptable=true;window.__seatsData=${JSON.stringify(old)};window.__checked=${JSON.stringify([...checked])};window.__ahead=${ahead};window.__watch=${JSON.stringify(settings.watch || null)};window.__boatsAll=${JSON.stringify(KEEP)};</script>`;
  let busy = false;
  const queue = [];
  const js = (code) => wv.evaluateJavaScript(code).catch(() => null);
  const label = (list) => list.map(([y, m]) => `${m}월`).join("·");

  async function check(list) {
    const keys = list.map(([y, m]) => ymKey(y, m));
    keys.forEach((k) => checked.add(k));
    await js(`window.__checked=${JSON.stringify([...checked])};__setChecking(true, ${JSON.stringify(label(list) + " 확인하는 중…")})`);
    const results = {}, errors = [], sources = { ...(old.sources || {}) };
    const doing = {};
    const show = () => js(`__setChecking(true, ${JSON.stringify("확인 중: " + Object.values(doing).filter(Boolean).join(", "))})`);
    // 네 사이트를 동시에 확인하되, 한 사이트 안에서는 요청을 하나씩 보낸다
    const groups = SITES.map((x) => [x]);
    await Promise.all(groups.map(async (group, gi) => {
      for (const site of group) {
        try {
          results[site.id] = await scrapeSite(wv, site, list, (t) => { doing[gi] = t; return show(); });
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
    fm.writeString(CACHE, JSON.stringify(data));
    old = data;
    await js(`__applySeats(${JSON.stringify(data)})`);
    let msg = errors.length ? `일부 사이트를 읽지 못했습니다: ${errors.join(" / ")}` : "";
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

  wv.shouldAllowRequest = (req) => {
    const u = req.url || "";
    if (u.startsWith("fishing://check")) { // 지금 확인: 3개월 + 보고 있는 달(그 뒤라면)
      const list = [...first];
      const v = ymOf(u);
      if (v && !list.some(([y, m]) => y === v[0] && m === v[1]) && ymKey(...v) > ymKey(...first[0])) list.push(v);
      want(list); return false;
    }
    if (u.startsWith("fishing://settings")) { // 설정: 확인 기간 변경
      const n = +((/ahead=(\d+)/.exec(u) || [])[1]);
      if (okAhead(n)) {
        ahead = n; saveSettings({ ...loadSettings(), ahead: n });
        first = all.slice(0, n);
        const more = first.filter(([y, m]) => !checked.has(ymKey(y, m))); // 늘린 만큼만 바로 확인
        if (more.length) want(more);
      }
      return false;
    }
    if (u.startsWith("fishing://watch")) { // 빈자리 알림 설정 저장
      try {
        const cfg = JSON.parse(decodeURIComponent((/cfg=([^&]*)/.exec(u) || [])[1] || "null"));
        if (cfg && typeof cfg === "object") {
          saveSettings({ ...loadSettings(), watch: cfg });
          js(`__setChecking(false, ${JSON.stringify(cfg.on ? "빈자리 알림을 켰어요. 홈 화면에 Scriptable 위젯을 추가하면 동작합니다." : "빈자리 알림을 껐어요.")})`);
        }
      } catch (e) {}
      return false;
    }
    if (u.startsWith("fishing://month")) { // 캘린더를 아직 확인하지 않은 달로 넘김
      const v = ymOf(u);
      if (v && !checked.has(ymKey(...v)) && ymKey(...v) >= ymKey(...first[0])) want([v]);
      return false;
    }
    if (BOOK_RE.test(u)) { openBooking(u); return false; } // 예약 페이지 → 예약 도우미(fishing-b)
    if (/^https?:/.test(u) && !u.startsWith(PAGE) && !u.startsWith("https://fonts.")) { Safari.open(u); return false; }
    return true;
  };
  await say("캘린더 그리는 중…");
  await wv.loadHTML(html.replace("<head>", "<head>" + inject), PAGE);
  await wv.evaluateJavaScript(PARSER);
  console.log("캘린더 표시 완료, 확인 시작");
  await askToken();
  want(first);
}

module.exports = { run };
