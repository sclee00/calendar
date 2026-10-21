// 연안부두 20인승 낚시배 잔여석 수집기 (GitHub Actions에서 1시간마다 실행)
// 결과: data/seats.json  — { updatedAt, ok, errors, reopened, months: { "YYYY-MM": { boats: { 배이름: { s:[...], sp:"..." } }, reopen: { 배이름: "0101..." } } } }
// s 값: 숫자 = 남은 자리(0 = 마감), "x" = 출조 취소, null = 정보 없음 / sp: g 갑오징어, j 주꾸미·갑오징어, f 광어·우럭
import * as cheerio from "cheerio";
import fs from "node:fs";

const OUT = new URL("../data/seats.json", import.meta.url);
const SITES = [
  { id: "lukina", kind: "sunsang24", host: "lukina.sunsang24.com", boats: ["루키나 2호", "루키나호"] },
  { id: "dy", kind: "sunsang24", host: "dyfishing.sunsang24.com", boats: ["팀에프원", "팀에프투", "고트호"] },
  { id: "khan", kind: "thefishing", host: "khanfishing.com", boats: ["와이파이호", "욜로호", "시크릿호", "베스트1호", "베스트3호", "제트호", "왕만두호"] },
  { id: "jeil", kind: "thefishing", host: "jnaksi.com", boats: ["모비딕호", "마루호", "스모키호", "로또호"] },
];
const KEEP = SITES.flatMap((s) => s.boats);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const squash = (s) => (s || "").replace(/\s+/g, "");
const norm = (s) => {
  s = squash(s).replace(/\(.*$/, "");
  return KEEP.find((k) => s === squash(k) || s.startsWith(squash(k))) || null;
};
const spc = (t) => {
  t = t || "";
  if (/광어|우럭|농어|외수질|다운샷|지깅/.test(t)) return "f";
  if (/주꾸미|쭈꾸미/.test(t)) return "j";
  if (/갑오징어/.test(t)) return "g";
  return "j";
};
const stc = (t) => {
  t = squash(t);
  const m = t.match(/남은자리(\d+)/);
  if (m) return +m[1];
  if (/예약마감|예약완료|마감/.test(t)) return 0;
  if (/기상|취소|점검|휴무|휴항/.test(t)) return "x";
  return null;
};
const pad = (n) => String(n).padStart(2, "0");
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// 한국 시각 기준 이번 달부터 13개월
const kst = new Date(Date.now() + 9 * 3600e3);
const MONTHS = [];
for (let i = 0; i < 13; i++) {
  const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + i, 1));
  MONTHS.push([d.getUTCFullYear(), d.getUTCMonth() + 1]);
}
const ymKey = (y, m) => `${y}-${pad(m)}`;
const kstIso = () => {
  const d = new Date(Date.now() + 9 * 3600e3);
  return d.toISOString().replace(/\.\d+Z$/, "+09:00");
};

async function get(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (attempt) throw new Error(`${url} — ${e.message}`);
      await new Promise((res) => setTimeout(res, 2000));
    }
  }
}

function collector() {
  const out = {};
  const put = (y, m, d, name, s, sp) => {
    if (!name || s === null) return;
    const k = ymKey(y, m), L = daysIn(y, m);
    out[k] ??= {};
    const b = (out[k][name] ??= { s: Array(L).fill(null), sp: Array(L).fill("j") });
    b.s[d - 1] = s;
    b.sp[d - 1] = sp;
  };
  const done = () => {
    for (const k in out) for (const n in out[k]) out[k][n].sp = out[k][n].sp.join("");
    return out;
  };
  return { put, done };
}

async function scrapeSunsang24(host) {
  const { put, done } = collector();
  for (const [y, m] of MONTHS) {
    const $ = cheerio.load(await get(`https://${host}/ship/schedule_fleet/${y}${pad(m)}`));
    $('table[class^="ship_unit"]').each((_, t) => {
      const T = $(t);
      const name = norm(T.find(".ship_info .title").first().text());
      const sd = T.find("[data-sdate]").first().attr("data-sdate");
      if (!name || !sd) return;
      const [yy, mm, dd] = sd.split("-").map(Number);
      if (mm !== m) return;
      const rem = T.find(".remain");
      const txt = rem.length ? rem.first().text() : T.find(".ship_info2").first().text();
      put(yy, mm, dd, name, stc(txt), spc(T.find("#fish").first().text()));
    });
  }
  return done();
}

async function scrapeTheFishing(host) {
  const { put, done } = collector();
  let any = false;
  for (const [y, m] of MONTHS) {
    let found = 0;
    const urls = [];
    for (let d = 1; d <= daysIn(y, m); d += 4) urls.push(`https://${host}/index.php?mid=bk&year=${y}&month=${pad(m)}&day=${pad(d)}`);
    const pages = await Promise.all(urls.map(get));
    for (const html of pages) {
      const $ = cheerio.load(html);
      let day = null;
      $("tr").each((_, r) => {
        const R = $(r);
        const a = R.find("a[name]").filter((_, el) => /^\d{8}$/.test($(el).attr("name") || ""));
        if (a.length) { day = a.first().attr("name"); return; }
        const tds = R.children("td");
        if (!day || tds.length < 3 || !tds.first().find("span").length) return;
        const name = norm(tds.first().text().replace(/예약하기/, ""));
        if (!name) return;
        const yy = +day.slice(0, 4), mm = +day.slice(4, 6), dd = +day.slice(6);
        if (mm !== m) return;
        const last = tds.last();
        const alt = last.find("img").map((_, i) => $(i).attr("alt") || "").get().join(" ") + " " + last.text();
        let kind = "";
        tds.eq(1).find('img[alt="낚시종류"]').each((_, i) => { kind = $(i).closest("tr").text(); });
        put(yy, mm, dd, name, stc(alt), spc(kind));
        found++;
      });
    }
    if (found) any = true;
    if (!found && any) break; // 예약이 열린 마지막 달 다음에서 멈춤
  }
  return done();
}

// ---- 실행 ----
let old = { months: {} };
try { old = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch {}
const oldMonths = old.months || {};

const results = {}, errors = [];
for (const site of SITES) {
  try {
    results[site.id] = site.kind === "sunsang24" ? await scrapeSunsang24(site.host) : await scrapeTheFishing(site.host);
    const n = Object.values(results[site.id]).reduce((a, mo) => a + Object.keys(mo).length, 0);
    if (!n) throw new Error("읽은 배가 없음 (사이트 구조가 바뀌었을 수 있음)");
    console.log(`${site.host}: ${n}개 월·배 조합`);
  } catch (e) {
    delete results[site.id];
    errors.push(`${site.host}: ${e.message}`);
    console.error(`실패 ${site.host}: ${e.message}`);
  }
}

const curYM = ymKey(...MONTHS[0]);
const months = {};
// 지난 달 기록은 그대로 둔다
for (const [k, v] of Object.entries(oldMonths)) if (k < curYM) months[k] = v;

const reopened = [];
const allKeys = new Set([...MONTHS.map(([y, m]) => ymKey(y, m)), ...Object.keys(oldMonths).filter((k) => k >= curYM)]);
for (const k of [...allKeys].sort()) {
  const prev = oldMonths[k] || { boats: {}, reopen: {} };
  const boats = {}, reopen = {};
  for (const site of SITES) {
    const fresh = results[site.id];
    for (const name of site.boats) {
      if (!fresh) { // 실패한 사이트는 이전 값 유지
        if (prev.boats?.[name]) boats[name] = prev.boats[name];
        if (prev.reopen?.[name]) reopen[name] = prev.reopen[name];
        continue;
      }
      const nb = fresh[k]?.[name];
      if (!nb) continue;
      boats[name] = nb;
      const ob = prev.boats?.[name]?.s || [];
      const pr = prev.reopen?.[name] || "";
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
  if (Object.keys(boats).length) months[k] = { boats, reopen };
}

const data = { updatedAt: kstIso(), ok: errors.length === 0, errors, reopened, months };
fs.mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(data));
console.log(`저장: ${Object.keys(months).length}개월, 다시 열린 자리 ${reopened.length}건${errors.length ? ", 실패 " + errors.length + "곳" : ""}`);
if (reopened.length) console.log(reopened.join("\n"));
if (errors.length === SITES.length) process.exit(1);
