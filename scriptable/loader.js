// 낚시배 빈자리 — Scriptable 실행 코드
// 이 코드를 Scriptable 앱에 "낚시배 빈자리"라는 이름으로 한 번만 붙여 넣으세요.
// 빨리 뜨도록 아이폰에 저장해 둔 코드를 바로 실행하고, 최신 코드는 실행 중에 뒤에서 받아 다음 실행부터 씁니다.
// (처음 한 번만 GitHub(sclee00/calendar)에서 받을 때까지 기다립니다.)
const SRC = "https://raw.githubusercontent.com/sclee00/calendar/main/scriptable/fishing.js";
const fm = FileManager.local();
const path = fm.joinPath(fm.documentsDirectory(), "fishing-main.js");
const save = (code) => { if (code && code.includes("module.exports") && code.includes("async function run")) fm.writeString(path, code); };
const latest = new Request(SRC + "?t=" + Date.now()).loadString().then(save, () => null); // 최신 코드는 뒤에서 받기
if (!fm.fileExists(path)) await latest; // 처음 한 번만 기다림
if (!fm.fileExists(path)) throw new Error("코드를 받지 못했습니다. 인터넷 연결을 확인한 뒤 다시 실행하세요.");
await importModule(path).run();
await Promise.race([latest, new Promise((r) => Timer.schedule(3000, false, r))]);
Script.complete();
