// 낚시배 빈자리 — PC 버전 본체 (브라우저 안에서 실행)
// 이 PC(한국 인터넷)가 네 선사 예약 화면을 직접 읽는다. 페이지는 같은 PC의 작은 프로그램(fishing-seats.exe)이
// 대신 받아 준다(브라우저가 다른 사이트를 바로 읽지 못하게 막혀 있어서). Claude·GitHub를 거치지 않는다.
// 자동으로 반복 확인하지 않는다. 열 때·'지금 확인'·아직 안 본 달로 넘길 때만 확인.
// 빈자리 알림을 켜면, 이 탭이 열려 있는 동안만 정해 둔 간격으로 조건에 맞는 날짜를 확인한다.
(function () {
  "use strict";
  const SITES = [
    { id: "lukina", kind: "ss", host: "lukina.sunsang24.com", boats: ["루키나 2호", "루키나호"] },
    { id: "dy", kind: "ss", host: "dyfishing.sunsang24.com", boats: ["팀에프원", "팀에프투", "고트호"] },
    { id: "khan", kind: "tf", step: 8, host: "khanfishing.com", boats: ["와이파이호", "욜로호", "시크릿호", "베스트1호", "베스트3호", "제트호", "왕만두호"] },
    { id: "jeil", kind: "tf", step: 4, host: "jnaksi.com", boats: ["모비딕호", "마루호", "스모키호", "로또호"] },
  ];
  const KEEP = SITES.flatMap((s) => s.boats);
  const pad = (n) => String(n).padStart(2, "0");
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
    const r = await fetch("/api/fetch?url=" + encodeURIComponent(url), { cache: "no-store" });
    const t = await r.text();
    if (!r.ok) throw new Error(t || "HTTP " + r.status);
    return t;
  }

  // ── 분석 (아이폰 버전과 같은 규칙) ──
  function classifySpecies(primary, fallback) {
    const FISH = /광어|우럭|농어|민어|참돔|도미|타이라바|백조기|조기|삼치|부시리|방어|대구|열기|볼락|노래미|놀래미|우럭광어|광우|우광|외수질|다운샷|지깅|라이트지깅|침선|생미끼|선상낚시|원투|흘림|외줄/;
    const CEPH = /주꾸미|쭈꾸미|쭈구미|쭈갑|갑쭈|쭈\.갑|갑\.쭈|갑오징어|갑오|문어|한치|오징어|에기|쭈낚/;
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
        rows.push([dd, name, stc(alt), spc(kind2, rowText)]); found++;
      });
    }
    return { rows, found };
  }

  async function scrapeSite(site, monthList, progress) {
    const out = {};
    const put = (y, m, d, name, s, sp, no) => {
      if (!name || s === null) return;
      const k = ymKey(y, m), L = daysIn(y, m);
      out[k] = out[k] || {};
      const b = (out[k][name] = out[k][name] || { s: Array(L).fill(null), sp: Array(L).fill("j") });
      b.s[d - 1] = s; b.sp[d - 1] = sp;
      if (no) { b.no = b.no || Array(L).fill(null); b.no[d - 1] = no; }
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
        for (let d = 1; d <= daysIn(y, m); d += site.step || 4) {
          const res = parse("tf", await get(`https://${site.host}/index.php?mid=bk&year=${y}&month=${pad(m)}&day=${pad(d)}`), y, m);
          res.rows.forEach(([dd, n, s, sp]) => put(y, m, dd, n, s, sp));
          found += res.found;
        }
        if (found) seen = true; else if (seen) break;
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
            const on = typeof v === "number" && v > 0 && flags[i] !== "1" && (was || (monthSeen && (!pb || pb[i] == null)));
            if (on && !was) newlyOpened.push(`${k.slice(5)}/${pad(i + 1)} ${name} ${v}석`);
            of += on ? "1" : "0";
          });
          if (of.includes("1")) opened[name] = of;
        }
      }
      // 아직 예약이 안 열린 달도 '확인했음'으로 남겨 둔다 (나중에 열리면 '새로 열림'으로 표시)
      if (Object.keys(boats).length || Object.values(results).some(Boolean)) months[k] = { boats, reopen, opened }; else delete months[k];
    }
    return { updatedAt: kstIso(), ok: errors.length === 0, errors, reopened, opened: newlyOpened, sources, months };
  }

  // ── 캘린더 확인 ──
  let old = window.__seatsData || { months: {} };
  let settings = window.__settings || {};
  const okAhead = (n) => Number.isInteger(n) && n >= 1 && n <= 12;
  let ahead = okAhead(settings.ahead) ? settings.ahead : 1;
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
    old = data;
    await store.put("seats", data);
    __applySeats(data);
    let msg = errors.length ? `일부 사이트를 읽지 못했습니다: ${errors.join(" / ")}` : "";
    const newItems = [...data.reopened.map((x) => "취소로 다시 열림 · " + x), ...(data.opened || []).map((x) => "새로 열림 · " + x)];
    if (newItems.length && "Notification" in window && Notification.permission === "granted") {
      try { new Notification(`새로 생긴 자리 ${newItems.length}곳`, { body: newItems.slice(0, 6).join("\n"), tag: "fishing-check" }); } catch (e) {}
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
  window.__host = function (u) {
    u = String(u || "");
    if (u.startsWith("fishing://check")) {
      const list = [...first], v = ymOf(u);
      if (v && !list.some(([y, m]) => y === v[0] && m === v[1]) && ymKey(...v) > ymKey(...first[0])) list.push(v);
      want(list);
    } else if (u.startsWith("fishing://settings")) {
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
          __setChecking(false, cfg.on ? `빈자리 알림을 켰어요. 이 탭이 열려 있는 동안 ${cfg.interval >= 60 ? cfg.interval / 60 + "시간" : cfg.interval + "분"}마다 확인합니다.` : "빈자리 알림을 껐어요.");
        }
      } catch (e) {}
    } else if (u.startsWith("fishing://testnote")) { // 미리보기: 실제 PC 알림 모양 보기
      let lines = [];
      try { lines = JSON.parse(decodeURIComponent((/d=([^&]*)/.exec(u) || [])[1] || "[]")); } catch (e) {}
      if (!lines.length) lines = ["11/14(토) 루키나호 3석"];
      const show = () => {
        if (!("Notification" in window) || Notification.permission !== "granted") { __setChecking(false, "브라우저 알림이 꺼져 있습니다. 주소창 왼쪽 자물쇠 → 알림 '허용' 후 다시 눌러 보세요."); return; }
        [[`빈자리 ${Math.min(3, lines.length)}곳`, lines.slice(0, 3)], [`취소로 다시 열린 자리 ${Math.min(3, lines.length)}곳`, lines.slice(0, 3)],
          [`예약이 새로 열림 ${Math.max(1, lines.length - 3)}곳`, lines.length > 3 ? lines.slice(3) : lines.slice(0, 1)]]
          .forEach(([t, b], i) => setTimeout(() => new Notification("[미리보기] " + t, { body: b.join("\n"), tag: "fishing-preview-" + i }), 1500 + i * 1500));
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
        for (const [d, name, s, sp] of res.rows) {
          if (!days.has(`${y}-${m}-${d}`)) continue;
          rows.push({ key: `${ymKey(y, m)}|${name}|${d}`, ym: ymKey(y, m), y, m, d, name, s, sp });
        }
      }
    } catch (e) { errors.push(`${site.host}: ${e.message}`); }
  }));
  return { rows, errors };
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
      hits.add(h.key);
      const ok = type === "any" ? true : type === "reopen" ? prev[h.key] === 0 : !baseline && typeof prev[h.key] !== "number";
      if (ok && !N[h.key]) { N[h.key] = 1; fresh.push({ type, label, h }); }
    }
    newNot[type] = N;
  }
  return { fresh, hits: hits.size, state: { prev: { ...prev, ...seen }, sigs: newSigs, notified: newNot, at: kstIso() } };
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
    try {
      while (busy) await sleep(2000); // 캘린더 확인이 끝난 뒤에
      const { rows } = await watchCollect(rules, async (kind, html, y, m) => parse(kind, html, y, m));
      const res = watchDecide(rules, rows, (await store.get("watch-state")) || {});
      await store.put("watch-state", res.state);
      if (res.fresh.length) {
        const msg = watchMessage(res.fresh);
        if ("Notification" in window && Notification.permission === "granted") {
          const n = new Notification(msg.title, { body: msg.body, tag: "fishing-seats", requireInteraction: true });
          n.onclick = () => { window.focus(); n.close(); };
        }
        __setChecking(false, `${msg.title}: ${msg.lines.join(", ")}`);
        document.title = `(${res.fresh.length}) ` + document.title.replace(/^\(\d+\) /, "");
      }
    } finally { watching = false; }
  }
  function startWatch() {
    clearInterval(watchTimer); watchTimer = null;
    const cfg = settings.watch || {};
    if (!cfg.on) return;
    const min = Math.max(30, +cfg.interval || 60);
    watchTimer = setInterval(runWatch, min * 60e3);
  }
  window.addEventListener("focus", () => { document.title = document.title.replace(/^\(\d+\) /, ""); });

  // 프로그램에 '아직 열려 있음'을 알림 (탭을 모두 닫으면 프로그램이 스스로 끝남)
  const ping = () => fetch("/api/ping", { method: "POST" }).catch(() => {
    __setChecking(false, "PC 프로그램이 꺼져 있습니다. fishing-seats.exe를 다시 실행하세요.");
  });
  setInterval(ping, 20e3); ping();

  // 시작: 설정한 기간을 한 번 확인
  window.__checked = [];
  want(first);
  startWatch();
})();
