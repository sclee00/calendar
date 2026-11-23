// 낚시배 빈자리 — PC 버전 본체 (브라우저 안에서 실행)
// 이 PC(한국 인터넷)가 네 선사 예약 화면을 직접 읽는다. 페이지는 같은 PC의 작은 프로그램(fishing-seats.exe)이
// 대신 받아 준다(브라우저가 다른 사이트를 바로 읽지 못하게 막혀 있어서). Claude·GitHub를 거치지 않는다.
// 자동으로 반복 확인하지 않는다. 열 때·'지금 확인'·아직 안 본 달로 넘길 때만 확인.
// 빈자리 알림을 켜면, 이 탭이 열려 있는 동안만 정해 둔 간격으로 조건에 맞는 날짜를 확인한다.
(function () {
  "use strict";
  const DEFAULT_SITES = [
    { id: "lukina", label: "루키나", kind: "ss", host: "lukina.sunsang24.com", boats: ["루키나 2호", "루키나호"] },
    { id: "dy", label: "동양낚시마트", kind: "ss", host: "dyfishing.sunsang24.com", boats: ["팀에프원", "팀에프투", "고트호"] },
    { id: "khan", label: "칸피싱", kind: "tf", step: 8, host: "khanfishing.com", boats: ["와이파이호", "욜로호", "시크릿호", "베스트1호", "베스트3호", "제트호", "왕만두호"] },
    { id: "jeil", label: "제일바다낚시", kind: "tf", step: 4, host: "jnaksi.com", boats: ["모비딕호", "마루호", "스모키호", "로또호"] },
    { id: "secret", label: "시크릿 버스", kind: "bus", step: 8, host: "secretbus.thefishing.kr", boats: ["전국 시크릿 블랙", "전국 시크릿 레드", "전국 시크릿 3호"] }, // 시크릿 피싱 클럽(낚시 버스)
  ];
  let SITES = [], KEEP = [], NOTICE_SITES = [];
  // 출조불가 날 (설정 → 출조불가 날): 이 날들은 사이트를 읽지 않고, 알림도 보내지 않는다
  let BLOCKED = { days: new Set(), wd: new Set(), allow: new Set() };
  function applyBlocked(b) { b = b || {}; BLOCKED = { days: new Set(Array.isArray(b.days) ? b.days : []), wd: new Set((Array.isArray(b.weekdays) ? b.weekdays : []).map(Number)), allow: new Set(Array.isArray(b.allow) ? b.allow : []) }; }
  function isBlocked(y, m, d) { const k = `${y}-${pad(m)}-${pad(d)}`; return BLOCKED.days.has(k) || (BLOCKED.wd.has(new Date(Date.UTC(y, m - 1, d)).getUTCDay()) && !BLOCKED.allow.has(k)); } // allow: 요일 반복의 예외(이 날만 출조 가능)
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
  applySites(window.__settings && window.__settings.sites);
  applyBlocked(window.__settings && window.__settings.blocked);
  const PARSE_V = 10; // 읽는 규칙이 바뀌면 올림
  const pad = (n) => String(n).padStart(2, "0");
  const todayKST = () => { const t = new Date(Date.now() + 9 * 3600e3); return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]; };
  const isPast = (y, m, d) => { const [ty, tm, td] = todayKST(); return y * 10000 + m * 100 + d < ty * 10000 + tm * 100 + td; }; // 오늘 이전 날짜는 확인하지 않음
  const daysIn = (y, m) => new Date(y, m, 0).getDate();
  const ymKey = (y, m) => `${y}-${pad(m)}`;
  const kstIso = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace(/\.\d+Z$/, "+09:00");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function monthsAhead() {
    const kst = new Date(Date.now() + 9 * 3600e3), out = [];
    for (let i = 0; i < 13; i++) {
      const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + i, 1));
      out.push([d.getUTCFullYear(), d.getUTCMonth() + 1]);
    }
    return out;
  }

  // ── 저장(이 PC의 사용자 폴더) ──
  const store = {
    async get(name) { try { const r = await fetch("/api/store/" + name, { cache: "no-store" }); return r.ok ? await r.json() : null; } catch (e) { return null; } },
    async put(name, v) { try { await fetch("/api/store/" + name, { method: "PUT", body: JSON.stringify(v) }); } catch (e) {} },
  };

  // 프로그램이 대신 받아 오는 선사 페이지 (사이트마다 요청은 하나씩, 간격은 프로그램이 지킴)
  async function get(url) {
    const r = await fetch("/api/fetch?url=" + encodeURIComponent(url), { cache: "no-store", headers: { "X-Fishing": "1" } });
    const t = await r.text();
    if (!r.ok) throw new Error(t || "HTTP " + r.status);
    return t;
  }

  // ── 분석 (아이폰 버전과 같은 규칙) ──
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
  ocrEngine();
  // OCR 결과 저장(이 PC): 그림 주소 → 어종. 새 그림은 한 번 확인에 8장까지
  let ocrCache = null, ocrFresh = 0, ocrBroken = false;
  async function ocrOf(url) {
    if (!ocrCache) ocrCache = (await store.get("ocr")) || {};
    if (ocrCache[url]) return ocrCache[url].sp;
    if (window.__mode !== "normal") return null; // 빠른 모드: 새 그림은 읽지 않음
    if (ocrBroken || ocrFresh >= 8) return null;
    ocrFresh++;
    try {
      const r = await fetch("/api/img?url=" + encodeURIComponent(url), { cache: "no-store", headers: { "X-Fishing": "1" } });
      if (!r.ok) return null;
      const src = URL.createObjectURL(await r.blob());
      let text;
      try { text = await window.__ocrText(src); } finally { URL.revokeObjectURL(src); }
      const sp = ocrSpecies(text);
      ocrCache[url] = { sp, t: String(text).replace(/\s+/g, " ").slice(0, 160), at: kstIso() };
      const ks = Object.keys(ocrCache); if (ks.length > 300) ks.slice(0, ks.length - 300).forEach((x) => delete ocrCache[x]);
      store.put("ocr", ocrCache);
      return sp;
    } catch (e) { ocrBroken = true; console.log("OCR 실패", e); return null; }
  }
  function classifySpecies(primary, fallback) {
    const FISH = /광어|우럭|농어|민어|참돔|도미|타이라바|백조기|조기|삼치|부시리|방어|대구|열기|볼락|노래미|놀래미|우럭광어|광우|우광|외수질|다운샷|지깅|라이트지깅|침선|생미끼|선상낚시|원투|흘림|외줄/;
    const CEPH = /주꾸미|쭈꾸미|쭈구미|쭈갑|갑쭈|쭈[.·ㆍ]?갑|갑[.·ㆍ]?쭈|갑오징어|갑오|문어|한치|오징어|에기|쭈낚/;
    const pick = (t) => {
      t = String(t || "").replace(/\s+/g, "");
      if (!t) return "u";
      const f = t.search(FISH), c = t.search(CEPH);
      if (f < 0 && c < 0) return "u";
      if (f < 0) return "j";
      if (c < 0) return "f";
      return f < c ? "f" : "j";
    };
    const a = pick(primary);
    return a !== "u" ? a : pick(fallback);
  }
  function parse(kind, html, y, m) {
    const sq = (s) => (s || "").replace(/\s+/g, "");
    const norm = (s) => { s = sq(s).replace(/\(.*$/, ""); return KEEP.find((k) => s === sq(k) || s.startsWith(sq(k))) || null; };
    const spc = classifySpecies;
    const stc = (t) => { t = sq(t); const mm = t.match(/남은자리(\d+)/); if (mm) return +mm[1]; if (/예약마감|예약완료|마감/.test(t)) return 0; if (/기상|취소|점검|휴무|휴항/.test(t)) return "x"; return null; };
    const doc = new DOMParser().parseFromString(html, "text/html");
    const rows = []; let found = 0;
    if (kind === "ss") {
      doc.querySelectorAll('table[class^="ship_unit"]').forEach((t) => {
        const name = norm(t.querySelector(".ship_info .title")?.textContent || "");
        const sd = t.querySelector("[data-sdate]")?.dataset.sdate; if (!name || !sd) return;
        const [, mo, dd] = sd.split("-").map(Number); if (mo !== m) return;
        const st = stc((t.querySelector(".remain") || t.querySelector(".ship_info2") || {}).textContent);
        if (st !== null) found++;
        const no = +((t.querySelector(".btn_user_reservation, .btn_ship_reservation, [data-schedule_no]") || {}).dataset?.schedule_no || 0) || null;
        rows.push([dd, name, st, spc(t.querySelector("#fish")?.textContent, (t.querySelector(".fishspecies")?.textContent || "") + " " + (t.querySelector(".small_event")?.textContent || "")), no]);
      });
    } else {
      let day = null;
      doc.querySelectorAll("tr").forEach((r) => {
        const a = r.querySelector("a[name]"); if (a && /^\d{8}$/.test(a.name)) { day = a.name; return; }
        const tds = [...r.children].filter((c) => c.tagName === "TD");
        if (!day || tds.length < 3 || !tds[0].querySelector("span")) return;
        const name = norm(tds[0].textContent.replace(/예약하기/, "")); if (!name) return;
        const mo = +day.slice(4, 6), dd = +day.slice(6); if (mo !== m) return;
        const last = tds[tds.length - 1];
        const alt = [...last.querySelectorAll("img")].map((i) => i.alt).join(" ") + " " + last.textContent;
        let kind2 = ""; tds[1].querySelectorAll('img[alt="낚시종류"]').forEach((i) => { kind2 = i.closest("tr").textContent; });
        const rowText = tds[0].textContent + " " + [...tds[1].querySelectorAll("img")].map((i) => i.alt || "").join(" ") + " " + tds[1].textContent;
        // 출조 버스만: 장소·일정 안내는 있는데 예약창이 아직 안 열린(상태 칸이 빈) 일정 → "w"(점선 아이콘)
      let st = stc(alt); if (st === null && kind === "bus" && tds[1].textContent.trim()) st = "w";
      // 출조 버스만: 예약창(자리)은 열렸는데 출조 설명이 비어 있으면 표시하지 않음
      if (kind === "bus" && typeof st === "number" && st > 0 && !tds[1].textContent.trim() && !tds[1].querySelector("img")) st = null;
      const sp0 = spc(kind2, rowText);
      // 어종을 글로 못 찾으면 공지 칸의 그림(포스터) 주소를 넘겨 그림 속 글자로 찾게 한다
      const ims = sp0 === "u" ? [...tds[1].querySelectorAll("img")].map((i) => i.getAttribute("src") || "").filter((x) => x && !/myfishmap|_core.module/.test(x)).slice(0, 2) : null;
      rows.push([dd, name, st, sp0, null, kind === "bus" ? fishLabel(kind2 || tds[1].textContent) : "", ims]); found++;
      });
    }
    return { rows, found };
  }

  async function scrapeSite(site, monthList, progress) {
    const out = {}, need = [];
    const put = (y, m, d, name, s, sp, no, fn) => {
      if (!name || s === null || isPast(y, m, d) || isBlocked(y, m, d)) return; // 오늘 이후만, 출조불가 날은 건너뜀
      const k = ymKey(y, m), L = daysIn(y, m);
      out[k] = out[k] || {};
      const b = (out[k][name] = out[k][name] || { s: Array(L).fill(null), sp: Array(L).fill("j") });
      b.s[d - 1] = s; b.sp[d - 1] = sp;
      if (no) { b.no = b.no || Array(L).fill(null); b.no[d - 1] = no; }
      if (fn) { b.fn = b.fn || Array(L).fill(""); b.fn[d - 1] = fn; } // 시크릿 버스: 설명에서 뽑은 어종 이름
    };
    let seen = false;
    for (const [y, m] of monthList) {
      progress(`${site.host} ${m}월`);
      if (site.kind === "ss") {
        const res = parse("ss", await get(`https://${site.host}/ship/schedule_fleet/${y}${pad(m)}`), y, m);
        res.rows.forEach(([d, n, s, sp, no]) => put(y, m, d, n, s, sp, no));
        if (res.found) seen = true; else if (seen) break;
      } else {
        let found = 0;
        const [ty, tm, td] = todayKST(), d0 = y === ty && m === tm ? td : 1; // 이번 달은 오늘부터
        for (let d = d0; d <= daysIn(y, m); d += site.step || 4) {
          { const st = site.step || 4, e = Math.min(daysIn(y, m), d + st - 1); let all = true; for (let x = d; x <= e; x++) if (!isBlocked(y, m, x)) { all = false; break; } if (all) continue; } // 이 페이지의 날이 모두 출조불가면 읽지 않음
          const res = parse(site.kind, await get(`https://${site.host}/index.php?mid=bk&year=${y}&month=${pad(m)}&day=${pad(d)}`), y, m);
          res.rows.forEach(([dd, n, s, sp, , fn, ims]) => { put(y, m, dd, n, s, sp, null, fn); if (sp === "u" && ims && ims.length) need.push([ymKey(y, m), n, dd, ims]); });
          found += res.found;
        }
        if (found) seen = true; else if (seen) break;
      }
    }
    // 어종을 모르는 날: 공지 그림(포스터)에서 읽어 본다 (같은 그림은 한 번만)
    if (need.length) {
      let told = false;
      for (const [k, n, d, ims] of need) {
        const b = out[k] && out[k][n];
        if (!b || b.s[d - 1] === null || b.sp[d - 1] !== "u") continue;
        for (const x of ims) {
          if (!told) { told = true; progress(`${site.host} 그림 속 어종 읽는 중`); }
          let url; try { url = new URL(x, `https://${site.host}/`).href; } catch (e) { continue; }
          const sp = await ocrOf(url);
          if (sp && sp !== "u") { b.sp[d - 1] = sp; break; }
        }
      }
    }
    for (const k in out) for (const n in out[k]) out[k][n].sp = out[k][n].sp.join("");
    const cur = ymKey(...monthsAhead()[0]);
    if (!Object.keys(out).length && monthList.some(([y, m]) => ymKey(y, m) === cur)) throw new Error("읽은 배가 없음");
    return out;
  }

  function merge(old, results, errors, sources, checked) {
    const oldMonths = (old && old.months) || {};
    const months = { ...oldMonths };
    const reopened = [], newlyOpened = [];
    for (const k of [...new Set(checked)].sort()) {
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
          const [ky, km] = k.split("-").map(Number), blk = nb.s.map((_, i) => isBlocked(ky, km, i + 1));
          nb.s.forEach((v, i) => { if (blk[i] && v === null && ob[i] !== undefined) nb.s[i] = ob[i]; }); // 출조불가 날은 이전 값을 그대로 두고 표시도 안 함
          const pr = (prev.reopen && prev.reopen[name]) || "";
          let flags = "";
          nb.s.forEach((v, i) => {
            const was = pr[i] === "1";
            const on = !blk[i] && typeof v === "number" && v > 0 && (ob[i] === 0 || was);
            if (on && !was) reopened.push(`${k.slice(5)}/${pad(i + 1)} ${name} ${v}석`);
            flags += on ? "1" : "0";
          });
          if (flags.includes("1")) reopen[name] = flags;
          // 새로 열린 예약: 전에는 일정이 없던(빈칸) 날에 자리가 생김
          const pb = prev.boats && prev.boats[name] && prev.boats[name].s, po = (prev.opened && prev.opened[name]) || "";
          let of = "";
          nb.s.forEach((v, i) => {
            const was = po[i] === "1";
            const on = !blk[i] && typeof v === "number" && v > 0 && flags[i] !== "1" && (was || (monthSeen && (!pb || pb[i] == null || pb[i] === "w")));
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

  // ── 캘린더 확인 ──
  let old = window.__seatsData || { months: {} };
  // 규칙이 바뀐 뒤 처음이면 출조 버스의 예전 결과는 버린다
  if (old.pv !== PARSE_V) {
    const bus = SITES.filter((s) => s.kind === "bus").flatMap((s) => s.boats);
    for (const M of Object.values(old.months || {})) for (const n of bus) { if (M.boats) delete M.boats[n]; if (M.reopen) delete M.reopen[n]; if (M.opened) delete M.opened[n]; }
    window.__seatsData = old;
    try { __applySeats(old); } catch (e) {}
  }
  let settings = window.__settings || {};
  const okAhead = (n) => Number.isInteger(n) && n >= 1 && n <= 12;
  let ahead = okAhead(settings.ahead) ? settings.ahead : 1;
  window.__mode = settings.mode === "normal" ? "normal" : "fast";
  const all = monthsAhead();
  let first = all.slice(0, ahead);
  const checked = new Set();
  const label = (list) => list.map(([, m]) => `${m}월`).join("·");
  let busy = false;
  const queue = [];

  async function check(list) {
    const keys = list.map(([y, m]) => ymKey(y, m));
    keys.forEach((k) => checked.add(k));
    window.__checked = [...checked];
    __setChecking(true, label(list) + " 확인하는 중…");
    const results = {}, errors = [], sources = { ...(old.sources || {}) }, doing = {};
    ocrFresh = 0; ocrBroken = false;
    const show = () => __setChecking(true, "확인 중: " + Object.values(doing).filter(Boolean).join(", "));
    await Promise.all(SITES.map(async (site, gi) => {
      try {
        results[site.id] = await scrapeSite(site, list, (t) => { doing[gi] = t; show(); });
        sources[site.id] = kstIso();
      } catch (e) { errors.push(`${site.host}: ${e.message}`); }
      doing[gi] = "";
      __applySeats(merge(old, results, [], sources, keys));
    }));
    const data = merge(old, results, errors, sources, keys);
    // 내 예약 배가 '출조 취소'로 바뀌면 알림
    try {
      const sv = (d, k) => { const [mk, name, day] = k.split("|"); const b = d && d.months && d.months[mk] && d.months[mk].boats && d.months[mk].boats[name]; return b ? b.s[+day - 1] : undefined; };
      (settings.mine || []).filter((k) => sv(data, k) === "x" && sv(old, k) !== "x").forEach((k) => {
        const [mk, name, day] = k.split("|");
        if ("Notification" in window && Notification.permission === "granted") notify("내 예약 출조 취소", { body: `${+mk.slice(5)}/${day} ${name} — 사이트에서 확인하세요`, requireInteraction: true });
      });
    } catch (e) {}
    old = data;
    await store.put("seats", data);
    __applySeats(data);
    if (ghTok()) ghLater(() => uploadSeats(data)); // 웹 캘린더에도 올리기
    let msg = errors.length ? `일부 사이트를 읽지 못했습니다: ${errors.join(" / ")}` : "";
    const newItems = [...data.reopened.map((x) => "취소로 다시 열림 · " + x), ...(data.opened || []).map((x) => "새로 열림 · " + x)];
    if (newItems.length && "Notification" in window && Notification.permission === "granted") {
      try { notify(`새로 생긴 자리 ${newItems.length}곳`, { body: newItems.slice(0, 6).join("\n"), tag: "fishing-check" }); } catch (e) {}
    }
    if ((data.opened || []).length) msg = `새로 열린 예약 ${data.opened.length}곳: ${data.opened.slice(0, 6).join(", ")}${data.opened.length > 6 ? " 외" : ""}` + (msg ? " · " + msg : "");
    if (data.reopened.length) msg = `취소로 다시 열린 자리 ${data.reopened.length}곳: ${data.reopened.slice(0, 6).join(", ")}${data.reopened.length > 6 ? " 외" : ""}` + (msg ? " · " + msg : "");
    __setChecking(false, msg);
  }
  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length) { try { await check(queue.shift()); } catch (e) { __setChecking(false, "확인 중 오류: " + e.message); } }
    busy = false;
  }
  const want = (list) => { if (list.length) { queue.push(list); pump(); } };
  const ymOf = (u) => { const m = /[?&]ym=(\d{4})-(\d{2})/.exec(u); return m ? [+m[1], +m[2]] : null; };

  // 캘린더 화면이 보내는 요청 (아이폰 버전의 fishing:// 주소를 그대로 받음)
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
  async function findSite(input) {
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
        const r = fishFind(kind, html);
        if (!r) continue;
        title = title || r.title;
        (r.boats || []).forEach((b) => { if (!seen.has(b.name)) { seen.add(b.name); boats.push(b); } });
      }
      if (!boats.length) return { ok: false, host: h, kind, error: kind === "ss" ? "선상24 일정표에서 배를 찾지 못했어요" : "예약 목록(index.php?mid=bk)에서 배를 찾지 못했어요. 이 예약 프로그램을 쓰지 않는 사이트일 수 있어요" };
      const owner = {}; SITES.forEach((x) => x.boats.forEach((n) => { owner[n] = x.label; }));
      return { ok: true, host: h, kind, step: kind === "ss" ? undefined : 4, label: (title.split(/[|:\-–]/).map((x) => x.trim()).find((x) => x && !/예약|reserv|일정/i.test(x)) || "").slice(0, 20) || h, boats: boats.map((b) => ({ ...b, taken: owner[b.name] && !SITES.some((x) => x.host === h && x.boats.includes(b.name)) ? owner[b.name] : "" })), have: (SITES.find((x) => x.host === h) || {}).boats || [] };
    } catch (e) { return { ok: false, error: e.message || String(e) }; }
  }

  // ── 알림 소리: 기본(윈도우 알림음) / 멜로디(이 화면에서 직접 연주) / 소리 없음 ──
  const MELODY = {
    piano_success: [[523, .16], [659, .16], [784, .16], [1047, .45]],
    event: [[1319, .32], [1047, .5], [1319, .32], [1047, .6]],
    complete: [[392, .12], [523, .12], [659, .12], [784, .4]],
    accept: [[1319, .25], [1047, .5]],
    alert: [[880, .14], [0, .08], [880, .14], [0, .08], [880, .14], [0, .3], [880, .14], [0, .08], [880, .14], [0, .08], [880, .14]],
  };
  let actx = null;
  const audio = () => { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); } catch (e) {} return actx; };
  document.addEventListener("pointerdown", audio); // 브라우저는 한 번이라도 누른 뒤에야 소리를 낼 수 있음
  const soundKey = () => ((settings && settings.watch && settings.watch.sound) || (window.__watch && window.__watch.sound) || "default");
  window.__playMelody = (k, test) => {
    if (k === "off") return;
    if (k === "default" || !MELODY[k]) { if (test && "Notification" in window && Notification.permission === "granted") new Notification("알림 소리 시험", { body: "윈도우 기본 알림음으로 알려요" }); return; }
    const c = audio(); if (!c) return;
    let t = c.currentTime + .05;
    for (const [f, d] of MELODY[k]) {
      if (f) { const o = c.createOscillator(), g = c.createGain(); o.type = k === "alert" ? "square" : "sine"; o.frequency.value = f;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(k === "alert" ? .12 : .3, t + .02); g.gain.exponentialRampToValueAtTime(.001, t + d);
        o.connect(g).connect(c.destination); o.start(t); o.stop(t + d + .05); }
      t += d;
    }
  };
  function notify(title, opts) {
    const k = soundKey();
    const n = new Notification(title, { ...(opts || {}), silent: k !== "default" });
    window.__playMelody(k);
    return n;
  }

  // ── GitHub 연결: 웹 캘린더에 올리기 + 아이폰·PC 설정 동기화 (토큰은 이 PC의 설정 파일에만) ──
  const REPO = "sclee00/calendar", SYNC_PATH = "data/sync.enc.json";
  const ghTok = () => (settings && settings.ghToken) || null;
  const ghH = (t) => ({ Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });
  const utf8b64 = (str) => { const b = new TextEncoder().encode(str); let s2 = ""; for (let i = 0; i < b.length; i += 0x8000) s2 += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s2); };
  const b64utf8 = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
  async function ghGet(t, path) {
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}?t=${Date.now()}`, { headers: ghH(t), cache: "no-store" });
    if (r.status === 404) return { sha: null, text: null };
    if (r.status === 401) throw new Error("토큰이 맞지 않음");
    const j = await r.json(); if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`);
    return { sha: j.sha, text: j.content ? b64utf8(j.content) : null };
  }
  async function ghPut(t, path, text, message) {
    const cur = await ghGet(t, path);
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { method: "PUT", headers: { ...ghH(t), "Content-Type": "application/json" }, body: JSON.stringify({ message, content: utf8b64(text), sha: cur.sha || undefined }) });
    if (!r.ok) { let m = ""; try { m = (await r.json()).message; } catch (e) {} throw new Error(m || `HTTP ${r.status}`); }
  }
  let ghQueue = Promise.resolve();
  const ghLater = (fn) => { ghQueue = ghQueue.then(fn).catch((e) => console.log("GitHub", e)); return ghQueue; };
  async function syncPull() {
    const t = ghTok();
    if (!t) return window.__syncRemote && window.__syncRemote(null, null);
    try { const r = await ghGet(t, SYNC_PATH); window.__syncRemote(r.text, t); } catch (e) { window.__syncRemote(null, t, e.message || String(e)); }
  }
  async function uploadSeats(data) { const t = ghTok(); if (!t || !data) return; await ghPut(t, "data/seats.json", JSON.stringify(data), `PC 확인 ${String(data.updatedAt || "").slice(5, 16).replace("T", " ")}`); }
  window.__webUp = !!ghTok();
  setTimeout(() => { try { window.__setWebUp && window.__setWebUp(!!ghTok()); } catch (e) {} syncPull(); }, 1200);

  window.__host = function (u) {
    u = String(u || "");
    if (u.startsWith("fishing://sync?push=")) { const blob = decodeURIComponent(u.slice("fishing://sync?push=".length)); const t = ghTok(); if (t) ghLater(() => ghPut(t, SYNC_PATH, blob, "설정 동기화 (PC)")); return; }
    if (u.startsWith("fishing://sync?apply=")) {
      let a = {}; try { a = JSON.parse(decodeURIComponent(u.slice("fishing://sync?apply=".length))) || {}; } catch (e) {}
      const nx = { ...settings };
      for (const k of ["blocked", "mine", "watch", "mode", "ahead", "widgetBoats"]) if (k in a) nx[k] = a[k];
      if ("sites" in a) nx.sites = Array.isArray(a.sites) && a.sites.length ? a.sites : null;
      settings = nx; if ("blocked" in a) applyBlocked(a.blocked); if ("watch" in a) window.__watch = a.watch;
      store.put("settings", settings).then(() => { if ("sites" in a) location.reload(); });
      return;
    }
    if (u.startsWith("fishing://token")) {
      if (/off/.test(u)) { settings = { ...settings }; delete settings.ghToken; store.put("settings", settings); window.__setWebUp(false, "토큰을 지웠어요"); window.__syncRemote(null, null); return; }
      const t = (prompt("GitHub 토큰(github_pat_…)을 붙여 넣으세요.\n아이폰에 넣은 것과 같은 토큰을 넣으면 설정이 서로 맞춰져요.") || "").trim();
      if (!t) return;
      window.__setWebUp(!!ghTok(), "토큰 확인 중…");
      ghGet(t, "data/seats.json").then(async () => {
        settings = { ...settings, ghToken: t }; await store.put("settings", settings);
        window.__setWebUp(true, "토큰을 저장했어요. 설정을 맞추고 웹 캘린더에도 올려요.");
        syncPull(); ghLater(() => uploadSeats(old));
      }).catch((e) => window.__setWebUp(!!ghTok(), "토큰이 맞지 않아요: " + (e.message || e)));
      return;
    }
    if (u.startsWith("fishing://sites?find=")) { // 선사 추가: 주소에서 배 찾기
      findSite(decodeURIComponent(u.slice("fishing://sites?find=".length))).then((r) => { try { window.__sitesFound(r); } catch (e) {} });
      return;
    }
    if (u.startsWith("fishing://sites?save=")) { // 선사 목록 저장 → 새 목록으로 다시 열기
      let list = null;
      try { list = JSON.parse(decodeURIComponent(u.slice("fishing://sites?save=".length))); } catch (e) {}
      settings = { ...settings, sites: Array.isArray(list) && list.length ? list : null };
      store.put("settings", settings).then(() => location.reload());
      return;
    }
    if (u.startsWith("fishing://check")) {
      const list = [...first], v = ymOf(u);
      if (v && !list.some(([y, m]) => y === v[0] && m === v[1]) && ymKey(...v) > ymKey(...first[0])) list.push(v);
      want(list);
    } else if (u.startsWith("fishing://settings")) {
      const bk = (/blocked=([^&]*)/.exec(u) || [])[1];
      if (bk !== undefined) { let b = null; try { b = JSON.parse(decodeURIComponent(bk)); } catch (e) {} settings = { ...settings, blocked: b }; store.put("settings", settings); applyBlocked(b); return; }
      const md = (/mode=(fast|normal)/.exec(u) || [])[1];
      if (md) { settings = { ...settings, mode: md }; store.put("settings", settings); window.__mode = md; return; }
      const n = +((/ahead=(\d+)/.exec(u) || [])[1]);
      if (okAhead(n)) {
        ahead = n; settings = { ...settings, ahead: n }; store.put("settings", settings);
        first = all.slice(0, n);
        const more = first.filter(([y, m]) => !checked.has(ymKey(y, m)));
        if (more.length) want(more);
      }
    } else if (u.startsWith("fishing://watch")) {
      try {
        const cfg = JSON.parse(decodeURIComponent((/cfg=([^&]*)/.exec(u) || [])[1] || "null"));
        if (cfg && typeof cfg === "object") {
          settings = { ...settings, watch: cfg }; store.put("settings", settings);
          if (cfg.on && "Notification" in window && Notification.permission === "default") Notification.requestPermission();
          startWatch();
          if (cfg.on) setTimeout(runWatch, 1500);
          __setChecking(false, cfg.on ? `빈자리 알림을 켰어요. 이 탭이 열려 있는 동안 ${cfg.interval >= 60 && cfg.interval % 60 === 0 ? cfg.interval / 60 + "시간" : cfg.interval + "분"}마다 확인합니다.` : "빈자리 알림을 껐어요.");
        }
      } catch (e) {}
    } else if (u.startsWith("fishing://mine?")) { // 내 예약 표시/해제
      try {
        const list = JSON.parse(decodeURIComponent((/[?&]list=([^&]*)/.exec(u) || [])[1] || "[]"));
        settings = { ...settings, mine: list }; store.put("settings", settings);
      } catch (e) {}
    } else if (u.startsWith("fishing://testnote")) { // 미리보기: 실제 PC 알림 모양 보기
      let lines = [];
      try { lines = JSON.parse(decodeURIComponent((/d=([^&]*)/.exec(u) || [])[1] || "[]")); } catch (e) {}
      if (!lines.length) lines = ["11/14(토) 루키나호 3석"];
      const show = () => {
        if (!("Notification" in window) || Notification.permission !== "granted") { __setChecking(false, "브라우저 알림이 꺼져 있습니다. 주소창 왼쪽 자물쇠 → 알림 '허용' 후 다시 눌러 보세요."); return; }
        [[`빈자리 ${Math.min(3, lines.length)}곳`, lines.slice(0, 3)], [`취소로 다시 열린 자리 ${Math.min(3, lines.length)}곳`, lines.slice(0, 3)],
          [`예약이 새로 열림 ${Math.max(1, lines.length - 3)}곳`, lines.length > 3 ? lines.slice(3) : lines.slice(0, 1)]]
          .forEach(([t, b], i) => setTimeout(() => notify("[미리보기] " + t, { body: b.join("\n"), tag: "fishing-preview-" + i }), 1500 + i * 1500));
        __setChecking(false, "PC 알림 예시 3개를 보냈습니다. 화면 오른쪽 아래(윈도우 알림)를 보세요.");
      };
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().then(show); else show();
    } else if (u.startsWith("fishing://month")) {
      const v = ymOf(u);
      if (v && !checked.has(ymKey(...v)) && ymKey(...v) >= ymKey(...first[0])) want([v]);
    }
  };

  // ── 빈자리 알림 (켜 두었을 때, 이 탭이 열려 있는 동안만) ──
  const spOf2 = (c) => (c === "f" ? "f" : c === "u" ? "u" : "j");
  function watchDays(cfg) {
    const kst = new Date(Date.now() + 9 * 3600e3);
    const today = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
    const from = cfg.from ? new Date(cfg.from + "T00:00:00Z") : today;
    const to = cfg.to ? new Date(cfg.to + "T00:00:00Z") : new Date(Math.max(from, today) + 30 * 864e5); // 끝 날짜를 비우면 시작일부터 30일
    const dows = Array.isArray(cfg.dows) && cfg.dows.length ? cfg.dows : [0, 1, 2, 3, 4, 5, 6];
    const out = [];
    for (let d = new Date(Math.max(from, today)); d <= to && out.length < 93; d = new Date(d.getTime() + 864e5)) {
      if (dows.includes(d.getUTCDay()) && !isBlocked(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())) out.push([d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]);
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

  let watchTimer = null, watching = false;
  async function runWatch() {
    const cfg = settings.watch || {};
    const rules = watchRules(cfg);
    if (!cfg.on || watching || !Object.values(rules).some((r) => r && r.on)) return;
    watching = true;
    let mine = false;
    try {
      while (busy || queue.length) await sleep(1000); // 캘린더 확인이 끝난 뒤에
      busy = mine = true;
      __setChecking(true, "알림 조건 확인 중…");
      const { rows, errors, monthKeys } = await watchCollect(rules, async (kind, html, y, m) => parse(kind, html, y, m));
      const res = watchDecide(rules, rows, (await store.get("watch-state")) || {});
      await store.put("watch-state", res.state);
      // 받은 날짜들을 캘린더 결과에도 넣는다 (먼 달도 메인 배너에 바로 보임)
      old = applyWatchRows(old, rows, errors.length ? [] : monthKeys).data;
      await store.put("seats", old);
      __applySeats(old);
      const summary = "알림 조건 확인 · " + countsText(ruleCounts(rules, res, old)) + (errors.length ? " (일부 사이트 실패)" : "");
      if (!res.fresh.length) __setChecking(false, summary);
      if (res.fresh.length) {
        const msg = watchMessage(res.fresh);
        if ("Notification" in window && Notification.permission === "granted") {
          const n = notify(msg.title, { body: msg.body, tag: "fishing-seats", requireInteraction: true });
          n.onclick = () => { window.focus(); n.close(); };
        }
        __setChecking(false, `${msg.title}: ${msg.lines.join(", ")} — ${summary}`);
        document.title = `(${res.fresh.length}) ` + document.title.replace(/^\(\d+\) /, "");
      }
    } catch (e) { __setChecking(false, "알림 조건 확인 중 오류: " + e.message); }
    finally { watching = false; if (mine) { busy = false; pump(); } }
  }
  function startWatch() {
    clearInterval(watchTimer); watchTimer = null;
    const cfg = settings.watch || {};
    if (!cfg.on) return;
    const min = Math.max(10, +cfg.interval || 60);
    watchTimer = setInterval(runWatch, min * 60e3);
  }
  window.addEventListener("focus", () => { document.title = document.title.replace(/^\(\d+\) /, ""); });

  // 프로그램에 '아직 열려 있음'을 알림 (탭을 모두 닫으면 프로그램이 스스로 끝남)
  // 창마다 번호를 붙여 알리고, 창을 닫으면(X) 바로 '닫힘'을 알린다 → 열린 창이 하나도 없으면 프로그램이 곧바로 끝남
  const PAGE_ID = Math.random().toString(36).slice(2, 10);
  window.addEventListener("pagehide", () => { try { navigator.sendBeacon("/api/bye?id=" + PAGE_ID); } catch (e) {} });
  const ping = () => fetch("/api/ping?id=" + PAGE_ID, { method: "POST" }).catch(() => {
    __setChecking(false, "PC 프로그램이 꺼져 있습니다. fishing-seats.exe를 다시 실행하세요.");
  });
  setInterval(ping, 20e3); ping();

  // 화면에 PC 버전 표시 (예전 버전이 떠 있는지 알 수 있게)
  try { document.title = document.title.replace(/^PC · /, `PC ${window.__pcVersion || ""} · `); const st0 = document.getElementById("stamp"); if (st0) st0.insertAdjacentHTML("afterend", `<small id="pcVer" style="display:block;color:var(--muted);font-size:11px">PC 버전 ${window.__pcVersion || "?"}</small>`); } catch (e) {}
  // ── 별도 창(앱 창)으로 열렸을 때: 지난번 창 크기·위치로 열고, 바뀔 때마다 기억 ──
  (() => {
    const NATIVE = !!window.__native; // 윈도우 프로그램 창: 크기·위치 기억은 프로그램이 직접 함
    let app = NATIVE || new URLSearchParams(location.search).get("app") === "1" || (window.toolbar && window.toolbar.visible === false);
    try { if (app) sessionStorage.setItem("fishApp", "1"); else app = sessionStorage.getItem("fishApp") === "1"; } catch (e) {}
    if (!app) return;
    if (location.search) try { history.replaceState(null, "", location.pathname); } catch (e) {}
    const K = "fishWinLast";
    const now0 = () => ({ x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight });
    const now = () => NATIVE ? window.__winGet() : Promise.resolve(now0());
    const place = (b) => { try { window.moveTo(b.x, b.y); window.resizeTo(b.w, b.h); window.moveTo(b.x, b.y); } catch (e) {} };
    // 다른 모니터로 옮기려면 크롬의 '창 관리' 허용이 필요하다 (한 번 허용해 두면 다음부터 저절로)
    const onThisScreen = (b) => { const l = screen.availLeft || 0, t = screen.availTop || 0; return b.x >= l - 20 && b.y >= t - 20 && b.x < l + screen.availWidth && b.y < t + screen.availHeight; };
    const wmState = async () => { try { return (await navigator.permissions.query({ name: "window-management" })).state; } catch (e) { return "unsupported"; } };
    const allowScreens = async (ask) => {
      if (!("getScreenDetails" in window)) return false;
      const st = await wmState();
      if (st === "denied" || (st === "prompt" && !ask)) return false;
      try { await window.getScreenDetails(); return true; } catch (e) { return false; }
    };
    const apply = async (b, ask) => { if (NATIVE) return window.__winSet(b.x, b.y, b.w, b.h); if (!onThisScreen(b)) await allowScreens(ask); place(b); };
    let last = null; try { last = JSON.parse(localStorage.getItem(K) || "null"); } catch (e) {}
    if (NATIVE) {}
    else if (last && last.w > 300 && last.h > 300) apply(last, false);
    else { const w = Math.min(1280, screen.availWidth), h = Math.min(960, screen.availHeight); place({ x: (screen.availLeft || 0) + Math.round((screen.availWidth - w) / 2), y: (screen.availTop || 0) + Math.round((screen.availHeight - h) / 2), w, h }); }
    let sig = "";
    const save = () => { if (NATIVE) return; const b = now0(), s = JSON.stringify(b); if (s !== sig && b.w > 300 && b.h > 300) { sig = s; try { localStorage.setItem(K, s); } catch (e) {} } };
    setTimeout(() => { save(); setInterval(save, 2000); }, 1500); // 창을 옮겨도 알려 주는 신호가 없어 2초마다 확인
    addEventListener("resize", () => { clearTimeout(save._t); save._t = setTimeout(save, 400); });
    addEventListener("beforeunload", save);
    // 창 배치 저장 버튼(1·2·3…): 오른쪽 위. ＋ = 지금 창 크기·위치를 다음 번호로 저장, 번호 = 그 배치로 바꾸기, 번호 오른쪽 클릭 = 지우기
    const PK = "fishWinPresets";
    const getP = () => { try { return JSON.parse(localStorage.getItem(PK) || "[]") || []; } catch (e) { return []; } };
    const putP = (v) => { try { localStorage.setItem(PK, JSON.stringify(v)); } catch (e) {} };
    document.head.insertAdjacentHTML("beforeend", `<style>#winBar{position:fixed;top:64px;right:6px;z-index:60;display:flex;flex-direction:column;gap:5px}
      #winBar button{width:26px;height:26px;border-radius:50%;border:1px solid #1f5f99;background:#fff;color:#1f5f99;font:600 12px/1 system-ui,sans-serif;cursor:pointer;padding:0;box-shadow:0 1px 3px rgba(0,0,0,.12)}
      #winBar button:hover{background:#1f5f99;color:#fff}#winBar button.add{border-style:dashed}#winBar button.just{background:#13a06e;border-color:#13a06e;color:#fff}</style>`);
    const bar = document.createElement("div"); bar.id = "winBar"; document.body.appendChild(bar);

    const drawBar = () => {
      const ps = getP();
      bar.innerHTML = ps.map((p, i) => `<button type="button" data-i="${i}" title="창 배치 ${i + 1}: ${p.w}×${p.h} (${p.x}, ${p.y})\n누르면 이 크기·위치로 바뀜 · 오른쪽 클릭하면 지우기">${i + 1}</button>`).join("")
        + (ps.length < 6 ? `<button type="button" class="add" data-add="1" title="지금 창 크기·위치를 ${ps.length + 1}번으로 저장">＋</button>` : "");
    };
    bar.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const ps = getP();
      if (b.dataset.add) { now().then((r) => { ps.push(r); putP(ps); drawBar(); __setChecking(false, `지금 창 크기·위치를 ${ps.length}번으로 저장했어요. 번호를 누르면 그 배치로 바뀌어요.`); }); return; }
      const p = ps[+b.dataset.i]; if (!p) return;
      b.classList.add("just"); setTimeout(() => b.classList.remove("just"), 700);
      apply(p, true).then(() => setTimeout(save, 300));
    });
    bar.addEventListener("contextmenu", (e) => {
      const b = e.target.closest("button[data-i]"); if (!b) return; e.preventDefault();
      const ps = getP(), i = +b.dataset.i;
      if (!confirm(`창 배치 ${i + 1}번을 지울까요?`)) return;
      ps.splice(i, 1); putP(ps); drawBar();
    });
    drawBar();
    // 모니터가 여러 대이고 아직 허용 전이면 위쪽에 '다른 모니터 허용' 버튼을 보여 준다
    (async () => {
      if (NATIVE) return;
      const multi = screen.isExtended === true || ("getScreenDetails" in window && screen.isExtended !== false);
      const st = await wmState();
      if (!multi || st === "granted" || st === "unsupported") return;
      const q = document.getElementById("pcVer"); if (!q) return;
      q.insertAdjacentHTML("beforeend", `<button type="button" id="pcScreens" style="margin-left:6px;font:inherit;font-size:12px;padding:2px 10px;border:1px solid #1f5f99;color:#1f5f99;background:#fff;border-radius:999px;cursor:pointer" title="창을 다른 모니터에 두었을 때 다음에도 그 모니터에서 열리게 해요">🖥 다른 모니터 허용</button>`);
      const btn = document.getElementById("pcScreens");
      btn.onclick = async () => {
        const ok = await allowScreens(true);
        if (ok) { btn.remove(); __setChecking(false, "창 관리를 허용했어요. 이제 다른 모니터에 둔 창도 다음에 그 자리에서 열려요."); if (last && last.w > 300) place(last); }
        else __setChecking(false, (await wmState()) === "denied" ? "창 관리가 막혀 있어요. 창 왼쪽 위 아이콘(ⓘ 또는 자물쇠) → 사이트 설정 → '창 관리'를 허용으로 바꾼 뒤 다시 눌러 주세요." : "허용 창이 뜨면 '허용'을 눌러 주세요.");
      };
    })();
  })();
  // 윈도우 시작할 때 자동 실행 (윈도우 프로그램 창일 때만): ⚙ 설정 → 화면 표시
  (async () => {
    if (!window.__native) return;
    const box = document.querySelector("#fold-view .fbody"); if (!box) return;
    let st0 = "0"; try { st0 = (await (await fetch("/api/autostart")).text()).trim(); } catch (e) { return; }
    if (st0 === "unsupported") return;
    box.insertAdjacentHTML("afterbegin", `<label style="flex-basis:100%"><input type="checkbox" id="pcAuto"${st0 === "1" ? " checked" : ""}> 윈도우 시작할 때 자동 실행 <small>(작업 표시줄에 내려 둔 채 켜져서 빈자리 알림을 확인해요)</small></label>`);
    const cb = document.getElementById("pcAuto");
    cb.onchange = async () => {
      try { const r = await fetch("/api/autostart?on=" + (cb.checked ? 1 : 0), { method: "POST" }); const t = (await r.text()).trim(); if (!r.ok) throw new Error(t); cb.checked = t === "1";
        __setChecking(false, cb.checked ? "윈도우를 켜면 이 프로그램이 자동으로 실행돼요." : "자동 실행을 껐어요."); }
      catch (e) { cb.checked = !cb.checked; __setChecking(false, "자동 실행을 바꾸지 못했어요: " + e.message); }
    };
  })();
  // 시작: 설정한 기간을 한 번 확인
  window.__checked = [];
  want(first);
  startWatch();
  // 내 예약: 출조 전날이면 알림 (하루 한 번)
  (async () => {
    const t = new Date(Date.now() + 9 * 3600e3), tm = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1));
    const pre = `${tm.getUTCFullYear()}-${pad(tm.getUTCMonth() + 1)}|`, td = tm.getUTCDate(), done = settings.mineReminded || {};
    const due = (settings.mine || []).filter((k) => k.startsWith(pre) && +k.split("|")[2] === td && !done[k]);
    if (!due.length || !("Notification" in window) || Notification.permission !== "granted") return;
    due.forEach((k) => { const [, name] = k.split("|"); notify("내일 출조", { body: `${tm.getUTCMonth() + 1}/${td} ${name} · 준비물·날씨 확인하세요` }); done[k] = 1; });
    settings = { ...settings, mineReminded: done }; store.put("settings", settings);
  })();
  // 시작할 때 알림 조건(캘린더 확인이 끝난 뒤), 그다음 선사 공지사항 확인
  (async () => {
    await runWatch();
    const st0 = (await store.get("notices")) || {};
    if (st0.sites) __setNotices(st0.sites.map((x) => ({ ...x, items: (x.items || []).map((n) => ({ ...n, isNew: false })) })), 0);
    try {
      const res = await checkNotices(async (k, h, b) => noticeParse(k, h, b), get, st0);
      await store.put("notices", res.state);
      __setNotices(res.sites, res.fresh.length);
      if (res.fresh.length && "Notification" in window && Notification.permission === "granted") {
        res.fresh.slice(0, 5).forEach((n, i) => setTimeout(() => {
          const x = notify(`${n.site} 새 공지`, { body: n.title, tag: "notice-" + i, requireInteraction: true });
          x.onclick = () => { window.open(n.url, "fish_notice"); x.close(); };
        }, i * 800));
      }
    } catch (e) {}
  })();
})();
