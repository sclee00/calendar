// ==UserScript==
// @name         낚시배 예약 도우미
// @namespace    https://github.com/sclee00/fishing-b
// @version      1.0.0
// @description  루키나·동양낚시마트(선상24)·칸피싱·제일바다낚시 예약 페이지를 미리 채워 둡니다. 최종 예약 버튼은 직접 누르세요.
// @match        https://lukina.sunsang24.com/*
// @match        https://dyfishing.sunsang24.com/*
// @match        https://app.sunsang24.com/user/login*
// @match        https://khanfishing.com/*
// @match        https://www.khanfishing.com/*
// @match        https://jnaksi.com/*
// @match        https://www.jnaksi.com/*
// @updateURL    https://sclee00.github.io/calendar/fishing-booking.user.js
// @downloadURL  https://sclee00.github.io/calendar/fishing-booking.user.js
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

// 하는 일
//  1) 로그인이 안 되어 있으면 위쪽에 [로그인하기] 버튼을 띄움 → 로그인 후 이 예약 페이지로 돌아옴
//     (아이디·비밀번호는 이 스크립트가 저장하지 않습니다. 브라우저의 암호 자동 완성을 쓰세요)
//  2) 예약 페이지: 인원 1명, 예약자 정보(빈칸일 때만), 필수 약관 동의를 채움
//     - 선상24: 선미 쪽 좌석부터 선택 (10 → 11 → 9 → 12 → 8 …)
//     - 칸피싱·제일: 좌석 선택이 없어서 요청사항에 "선미 쪽 자리 희망합니다"
//  3) 최종 [예약하기]/[예약신청하기] 버튼에 빨간 테두리 — 이 버튼은 절대 누르지 않음

(function () {
  "use strict";
  if (window.top !== window.self) return;

  const SEAT_ORDER = [10, 11, 9, 12, 8, 13, 7, 14, 6, 15, 5, 16, 4, 17, 3, 18, 2, 19, 1, 20];
  const MEMO = "선미 쪽 자리 희망합니다";
  const host = location.hostname.replace(/^www\./, "");
  const SS = /sunsang24\.com$/.test(host);
  const TF = host === "khanfishing.com" || host === "jnaksi.com";

  // ── 저장소 (스크립트 전용 저장소는 사이트끼리 공유됨 → 로그인 후 돌아갈 주소 기억) ──
  const gmGet = async (k, d) => {
    try { if (typeof GM !== "undefined" && GM.getValue) return await GM.getValue(k, d); } catch (e) {}
    try { if (typeof GM_getValue === "function") return GM_getValue(k, d); } catch (e) {}
    try { const v = localStorage.getItem("fb_" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
  };
  const gmSet = async (k, v) => {
    try { if (typeof GM !== "undefined" && GM.setValue) return await GM.setValue(k, v); } catch (e) {}
    try { if (typeof GM_setValue === "function") return GM_setValue(k, v); } catch (e) {}
    try { localStorage.setItem("fb_" + k, JSON.stringify(v)); } catch (e) {}
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  // ── 안내 띠 ─────────────────────────────────────────────
  function banner(text, color, button) {
    let b = document.getElementById("__fb_banner");
    if (!b) {
      b = document.createElement("div");
      b.id = "__fb_banner";
      b.style.cssText = "position:fixed;left:8px;right:8px;top:8px;z-index:2147483647;padding:10px 12px;border-radius:10px;font:600 14px/1.4 -apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.25);display:flex;gap:10px;align-items:center";
      (document.body || document.documentElement).appendChild(b);
    }
    b.style.background = color || "#1d6fd8";
    b.innerHTML = "";
    const t = document.createElement("span");
    t.style.flex = "1";
    t.textContent = text;
    b.appendChild(t);
    if (button) {
      const a = document.createElement("button");
      a.type = "button";
      a.textContent = button.label;
      a.style.cssText = "flex:none;border:0;border-radius:8px;padding:7px 12px;background:#fff;color:#18232c;font:700 14px -apple-system,sans-serif";
      a.onclick = button.onClick;
      b.appendChild(a);
    }
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "✕";
    x.setAttribute("aria-label", "안내 닫기");
    x.style.cssText = "flex:none;border:0;background:transparent;color:#fff;font:700 16px sans-serif;padding:4px";
    x.onclick = () => b.remove();
    b.appendChild(x);
    return b;
  }

  // ── 로그인 확인 ─────────────────────────────────────────
  async function loggedIn() {
    if (SS) return !$$("a").some((a) => /\/user\/login/.test(a.href || ""));
    // 더피싱(칸피싱·제일): 숨은 모바일 메뉴까지 보려고 PC·모바일 첫 화면을 받아서 확인
    const pages = await Promise.all(["/", "/m/"].map((u) => fetch(u, { credentials: "include" }).then((r) => r.text()).catch(() => "")));
    return pages.some((h) => {
      const d = new DOMParser().parseFromString(h, "text/html");
      return !!d.querySelector('a[href*="logout"],a[href*="Logout"]') || /로그아웃/.test((d.body && d.body.textContent) || "");
    });
  }
  async function goLogin() {
    await gmSet("pending", { url: location.href, at: Date.now() });
    if (SS) location.href = "https://app.sunsang24.com/user/login";
    else location.href = "/m/index.php?sid=login";
  }

  // 로그인 화면: 로그인 후 예약 페이지로 돌아가게 설정
  async function onLoginPage() {
    const p = await gmGet("pending", null);
    if (!p || Date.now() - p.at > 15 * 60e3) return false;
    if (host === "app.sunsang24.com") {
      const g = $("#goto");
      if (g) g.value = p.url;
      banner("로그인하면 예약 페이지로 돌아갑니다.", "#1d6fd8");
      return true;
    }
    const url = $$('form input[name="url"]').filter((i) => /login\.action/.test((i.form && i.form.getAttribute("action")) || ""));
    if (url.length) {
      const u = new URL(p.url);
      url.forEach((i) => { i.value = encodeURIComponent(u.pathname + u.search); });
      banner("로그인하면 예약 페이지로 돌아갑니다.", "#1d6fd8");
      return true;
    }
    return false;
  }

  // 로그인 후 첫 화면으로 왔으면 예약 페이지로 돌려보냄 (사이트가 원래 주소를 무시하는 경우 대비)
  async function returnIfPending() {
    const p = await gmGet("pending", null);
    if (!p || Date.now() - p.at > 15 * 60e3) return false;
    let target;
    try { target = new URL(p.url); } catch (e) { return false; }
    if (target.hostname.replace(/^www\./, "") !== host) return false;
    if (location.href === p.url) { await gmSet("pending", null); return false; }
    if (!(await loggedIn())) return false;
    await gmSet("pending", null);
    location.replace(p.url);
    return true;
  }

  // ── 예약자 정보 (선택: 계정 정보로 이미 채워지면 필요 없음) ──────────
  async function profile() { return (await gmGet("profile", null)) || {}; }
  async function editProfile() {
    const p = await profile();
    const name = prompt("예약자 이름 (빈칸으로 두면 사이트에 저장된 정보 사용)", p.name || "");
    if (name === null) return;
    const phone = prompt("휴대폰 번호 (예: 010-1234-5678)", p.phone || "");
    if (phone === null) return;
    const deposit = prompt("입금자명 (비우면 이름과 같게)", p.deposit || "");
    await gmSet("profile", { name: name.trim(), phone: (phone || "").trim(), deposit: (deposit || "").trim() });
    location.reload();
  }

  // ── 예약 페이지 채우기 ───────────────────────────────────
  const fire = (el) => ["input", "change"].forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
  function setIfEmpty(el, val) {
    if (!el || !val || el.disabled || el.readOnly) return;
    if (el.tagName === "SELECT") {
      const opt = $$("option", el).find((o) => o.value === val || o.text.trim() === val);
      if (opt && el.value !== opt.value && (!el.value || el.selectedIndex <= 0)) { el.value = opt.value; fire(el); }
      return;
    }
    if (!String(el.value || "").trim()) { el.value = val; fire(el); }
  }
  const splitPhone = (s) => {
    const d = String(s || "").replace(/\D/g, "");
    return d.length === 11 ? [d.slice(0, 3), d.slice(3, 7), d.slice(7)] : d.length === 10 ? [d.slice(0, 3), d.slice(3, 6), d.slice(6)] : ["", "", ""];
  };

  let seatPicked = "";
  function fillSunsang(p) {
    const ph = splitPhone(p.phone);
    setIfEmpty($("[name=name]"), p.name);
    setIfEmpty($("[name=deposit_name]"), p.deposit || p.name);
    setIfEmpty($("[name=phone1]"), ph[0]);
    setIfEmpty($("[name=phone2]"), ph[1]);
    setIfEmpty($("[name=phone3]"), ph[2]);
    const pc = $("[name=person_count]");
    if (pc && !(+pc.value >= 1)) { pc.value = "1"; fire(pc); }
    const seatInputs = $$("input[id^=select_seat_nos_num_]");
    const picked = seatInputs.filter((i) => i.checked);
    if (!picked.length) {
      const rank = (n) => { const i = SEAT_ORDER.indexOf(n); return i < 0 ? 100 + n : i; };
      const cands = $$("label[for^=select_seat_nos_num_]").map((l) => {
        const inp = document.getElementById(l.getAttribute("for"));
        let n = parseInt((l.textContent || "").replace(/\D/g, ""), 10);
        if (isNaN(n) && inp) n = parseInt(inp.value, 10);
        return { l, inp, n };
      }).filter((c) => c.inp && !c.inp.disabled && !isNaN(c.n)).sort((a, b) => rank(a.n) - rank(b.n));
      if (cands[0]) { cands[0].l.click(); seatPicked = cands[0].n; }
    } else if (!seatPicked) {
      const pl = $(`label[for="${picked[0].id}"]`);
      seatPicked = parseInt(((pl && pl.textContent) || picked[0].value || "").replace(/\D/g, ""), 10) || "";
    }
    const all = $("#all_check");
    if (all && !all.checked) all.click();
    $$('input[name="agree_rule[]"]').forEach((c) => { if (!c.checked) c.click(); });
    return { submit: $("#btn_payment"), notes: [seatPicked ? `${seatPicked}번 자리` : seatInputs.length ? "" : "자리 선택 없음"].filter(Boolean) };
  }

  function fillTheFishing(p) {
    // 낚시종류: 하나도 안 골랐으면 첫 번째 (고르면 페이지가 새로 열림 → 다시 실행됨)
    const ps = $$("input[type=radio][name=PS_N_UID]");
    if (ps.length && !ps.some((r) => r.checked)) {
      const first = ps.find((r) => !r.disabled);
      if (first) { first.click(); return { navigating: true }; }
    }
    const bi = $("[name=BI_IN]");
    if (bi && bi.tagName === "SELECT" && !(+bi.value >= 1)) {
      const o1 = $$("option", bi).find((o) => +o.value === 1);
      if (o1) { bi.value = o1.value; fire(bi); }
    }
    const ph = splitPhone(p.phone);
    setIfEmpty($("[name=BI_NAME]"), p.name);
    setIfEmpty($("[name=BI_BANK]"), p.deposit || p.name);
    setIfEmpty($("[name=BI_TEL1]"), ph[0]);
    setIfEmpty($("[name=BI_TEL2]"), ph[1]);
    setIfEmpty($("[name=BI_TEL3]"), ph[2]);
    const memo = $("[name=BI_MEMO]");
    if (memo && (memo.value || "").indexOf(MEMO) < 0) { memo.value = (memo.value ? memo.value + "\n" : "") + MEMO; fire(memo); }
    // 필수 동의(개인정보, 제3자 제공)는 '동의', 광고성 정보 수신은 '동의 안 함'
    ["agree", "BI_3JA"].forEach((n) => {
      const y = $(`input[name="${n}"][value="Y"]`) || $(`input[name="${n}"][value="1"]`);
      if (y && !y.checked) y.click();
    });
    const ad = $$('input[name="BI_AD"]');
    if (ad.length > 1 && !ad.some((r) => r.checked)) ad[1].click();
    const submit = $$("button,a,input[type=button],input[type=submit],input[type=image]")
      .find((el) => /예약\s*신청/.test(el.textContent || el.value || el.alt || ""));
    return { submit, notes: ["1명", "요청사항: 선미 희망"] };
  }

  async function bookingPage() {
    const ok = await loggedIn();
    if (!ok) {
      banner("로그인이 안 되어 있습니다. 로그인하면 이 예약 페이지로 돌아옵니다.", "#e0473a", { label: "로그인하기", onClick: goLogin });
      return;
    }
    const p = await profile();
    let res = {};
    for (let pass = 0; pass < 3; pass++) { // 사이트 스크립트가 늦게 채우는 칸이 있어 몇 번 반복
      res = (SS ? fillSunsang(p) : fillTheFishing(p)) || {};
      if (res.navigating) { banner("낚시종류 선택 중…", "#1d6fd8"); return; }
      await sleep(900);
    }
    if (res.submit) {
      res.submit.style.outline = "4px solid #ff3b30";
      res.submit.style.outlineOffset = "3px";
      res.submit.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    const filled = SS ? !!($("[name=name]") || {}).value : !!($("[name=BI_NAME]") || {}).value;
    const txt = `로그인됨 · 자동 입력: ${res.notes.join(", ")}` +
      (filled ? "" : " · 예약자 정보 없음") +
      (res.submit ? " — 확인 후 빨간 테두리 버튼을 직접 누르세요" : " — 예약 버튼을 찾지 못했습니다");
    banner(txt, res.submit && filled ? "#13a06e" : "#d98a00", filled ? null : { label: "예약자 정보", onClick: editProfile });
  }

  // 선상24 월 일정표 + ?fb=배이름_날짜 → 그 배·날짜 예약 페이지로
  function scheduleJump() {
    const m = /[?&]fb=([^&#]*)_(\d+)/.exec(location.search);
    const ym = /schedule_fleet\/(\d{4})(\d{2})/.exec(location.pathname);
    if (!m || !ym) return false;
    const name = decodeURIComponent(m[1]).replace(/\s+/g, "");
    const date = `${ym[1]}-${ym[2]}-${String(+m[2]).padStart(2, "0")}`;
    let no = null;
    $$('table[class^="ship_unit"]').forEach((t) => {
      if (no) return;
      const ti = (($(".ship_info .title", t) || {}).textContent || "").replace(/\s+/g, "").replace(/\(.*$/, "");
      const sd = $("[data-sdate]", t);
      if (ti !== name || !sd || sd.dataset.sdate !== date) return;
      const b = $(".btn_user_reservation[data-schedule_no]", t) || $("[data-schedule_no]", t);
      if (b) no = b.dataset.schedule_no;
    });
    if (no) { banner("예약 페이지로 이동 중…", "#1d6fd8"); location.replace(`/mypage/reservation_ready/${no}`); return true; }
    banner(`${decodeURIComponent(m[1])} ${+ym[2]}/${+m[2]} 예약 페이지를 찾지 못했습니다. 일정표에서 직접 눌러 주세요.`, "#e0473a");
    return true;
  }

  // ── 시작 ──────────────────────────────────────────────
  (async () => {
    const path = location.pathname;
    if (host === "app.sunsang24.com" || /sid=login/.test(location.search) || /popup\.login\.php/.test(path)) { await onLoginPage(); return; }
    if (SS && /\/ship\/schedule_fleet\/\d{6}/.test(path) && scheduleJump()) return;
    if (/\/mypage\/reservation_ready\/\d+/.test(path) || /\/_core\/module\/reservation_boat[^/]*\/popu[p2]\.step1\.php/.test(path)) {
      await gmSet("pending", null);
      await bookingPage();
      return;
    }
    await returnIfPending();
  })();
})();
