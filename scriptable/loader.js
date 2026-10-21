// 낚시배 빈자리 — Scriptable 실행 코드
// 이 코드를 Scriptable 앱에 "낚시배 빈자리"라는 이름으로 한 번만 붙여 넣으세요.
// 실제 코드는 실행할 때마다 GitHub(sclee00/calendar)에서 최신 버전을 받아옵니다.
const SRC = "https://raw.githubusercontent.com/sclee00/calendar/main/scriptable/fishing.js";
const fm = FileManager.local();
const path = fm.joinPath(fm.documentsDirectory(), "fishing-main.js");
try {
  const code = await new Request(SRC + "?t=" + Date.now()).loadString();
  if (code.includes("module.exports")) fm.writeString(path, code);
} catch (e) {}
if (!fm.fileExists(path)) throw new Error("코드를 받지 못했습니다. 인터넷 연결을 확인한 뒤 다시 실행하세요.");
await importModule(path).run();
Script.complete();
