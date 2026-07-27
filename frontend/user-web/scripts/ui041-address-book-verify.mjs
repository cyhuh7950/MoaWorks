import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const api = read("src/api.ts");
const app = read("src/App.tsx");
const workspace = read("src/WorkspacePanels.tsx");
const styles = read("src/global.css");
const panelPath = path.join(root, "src/AddressBookPanel.tsx");
const panel = fs.existsSync(panelPath) ? fs.readFileSync(panelPath, "utf8") : "";

const checks = [
  ["주소록 전용 컴포넌트", panel.includes("export function AddressBookPanel")],
  ["개인·공용 범위", panel.includes('"personal"') && panel.includes('"public"')],
  ["3단 작업면", panel.includes("ui041-groups") && panel.includes("ui041-list") && panel.includes("ui041-detail")],
  ["그룹 CRUD", panel.includes("연락처 그룹") && panel.includes("deleteContactGroup")],
  ["서버 검색 debounce", panel.includes("300") && panel.includes("requestSequence")],
  ["연락처 CRUD", panel.includes("saveContact") && panel.includes("deleteContact")],
  ["CSV preview/apply", panel.includes("previewContactImport") && panel.includes("applyContactImport")],
  ["공통 popup", panel.includes("CommonPopup")],
  ["메일 작성 연결", panel.includes("onComposeMail") && app.includes("openAddressBookMailCompose")],
  ["API 그룹", api.includes('"/workspace/contact-groups"')],
  ["API 공용", api.includes("/workspace/public-contacts")],
  ["API 가져오기", api.includes('"/workspace/contacts/import') && api.includes("expectedDigest")],
  ["기존 contacts 경로 보존", api.includes('"/workspace/contacts') && workspace.includes("AddressBookPanel")],
  ["UI-041 범위 CSS", styles.includes(".ui041-address-book") && styles.includes("font-size: 12px")],
  ["설명 인터페이스", panel.includes('aria-label="주소록 안내"') && panel.includes('title="')],
  ["raw HTML 미사용", !panel.includes("dangerouslySetInnerHTML")],
  ["브라우저 내부주소 미사용", !/localhost|127\.0\.0\.1|host\.docker\.internal|NEXT_PUBLIC_API_BASE_URL/.test(`${panel}\n${api}`)],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error(`UI-041 address book verifier failed: ${failed.map(([name]) => name).join(", ")}`);
  process.exit(1);
}
console.log(`UI-041 address book verifier: ${checks.length}/${checks.length} passed`);
