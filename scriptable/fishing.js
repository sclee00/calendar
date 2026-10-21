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
const GAP = 800; // 같은 서버에 보내는 요청 사이 간격(ms)
const TOKEN_KEY = "fishing_github_token";
const ASKED_KEY = "fishing_github_asked";

const fm = FileManager.local();
const DIR = fm.joinPath(fm.documentsDirectory(), "fishing-seats");
if (!fm.fileExists(DIR)) fm.createDirectory(DIR, true);
const CACHE = fm.joinPath(DIR, "seats.json");

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
const PARSER = `
window.__fishParse = function (kind, html, y, m) {
  const KEEP = ${JSON.stringify(KEEP)};
  const sq = s => (s || "").replace(/\\s+/g, "");
  const norm = s => { s = sq(s).replace(/\\(.*$/, ""); return KEEP.find(k => s === sq(k) || s.startsWith(sq(k))) || null; };
  const spc = t => { t = t || ""; if (/광어|우럭|농어|외수질|다운샷|지깅/.test(t)) return "f"; if (/주꾸미|쭈꾸미/.test(t)) return "j"; if (/갑오징어/.test(t)) return "g"; return "j"; };
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
      rows.push([dd, name, st, spc(t.querySelector("#fish")?.textContent)]);
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
      rows.push([dd, name, stc(alt), spc(kind2)]); found++;
    });
  }
  return { rows, found };
};
true;`;

async function scrapeSite(wv, site, monthList, progress) {
  const out = {};
  const put = (y, m, d, name, s, sp) => {
    if (!name || s === null) return;
    const k = ymKey(y, m), L = daysIn(y, m);
    out[k] = out[k] || {};
    const b = (out[k][name] = out[k][name] || { s: Array(L).fill(null), sp: Array(L).fill("j") });
    b.s[d - 1] = s; b.sp[d - 1] = sp;
  };
  const parse = async (html, y, m) =>
    wv.evaluateJavaScript(`__fishParse(${JSON.stringify(site.kind)}, ${JSON.stringify(html)}, ${y}, ${m})`);
  let seen = false;
  for (const [y, m] of monthList) {
    await progress(`${site.host} ${m}월`);
    if (site.kind === "ss") {
      const res = await parse(await get(`https://${site.host}/ship/schedule_fleet/${y}${pad(m)}`), y, m);
      res.rows.forEach(([d, n, s, sp]) => put(y, m, d, n, s, sp));
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

async function run() {
  // 1) 마지막 결과(아이폰에 저장된 것, 없으면 웹 캘린더의 것)로 캘린더를 먼저 띄운다
  let old = fm.fileExists(CACHE) ? JSON.parse(fm.readString(CACHE)) : null;
  const web = await loadJSON(RAW + "data/seats.json?t=" + Date.now());
  if (!old || (web && web.updatedAt > old.updatedAt)) old = web || old || { months: {} };

  const AHEAD = 3; // 처음에는 이번 달부터 3개월만 확인
  const all = monthsAhead();
  const first = all.slice(0, AHEAD);
  const checked = new Set(first.map(([y, m]) => ymKey(y, m)));

  const html = await new Request(PAGE + "?t=" + Date.now()).loadString();
  const inject = `<script>window.__inScriptable=true;window.__seatsData=${JSON.stringify(old)};window.__checked=${JSON.stringify([...checked])};</script>`;
  const wv = new WebView();
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
    // 같은 서버(선상24끼리, 더피싱끼리)는 하나씩, 서로 다른 서버는 동시에
    const groups = [SITES.filter((x) => x.kind === "ss"), SITES.filter((x) => x.kind === "tf")];
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
    if (u.startsWith("fishing://month")) { // 캘린더를 아직 확인하지 않은 달로 넘김
      const v = ymOf(u);
      if (v && !checked.has(ymKey(...v)) && ymKey(...v) >= ymKey(...first[0])) want([v]);
      return false;
    }
    if (/^https?:/.test(u) && !u.startsWith(PAGE) && !u.startsWith("https://fonts.")) { Safari.open(u); return false; }
    return true;
  };
  await wv.loadHTML(html.replace("<head>", "<head>" + inject), PAGE);
  await wv.evaluateJavaScript(PARSER);
  const shown = wv.present(true);
  await askToken();
  want(first);
  await shown;
}

module.exports = { run };
