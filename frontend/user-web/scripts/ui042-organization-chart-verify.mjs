import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const api = read("src/api.ts");
const workspace = read("src/WorkspacePanels.tsx");
const styles = read("src/global.css");
const panelPath = path.join(root, "src/OrganizationPanel.tsx");
const panel = fs.existsSync(panelPath) ? fs.readFileSync(panelPath, "utf8") : "";

const checks = [
  ["조직도 전용 컴포넌트", panel.includes("export function OrganizationPanel")],
  ["전용 부서 API", api.includes('"/workspace/organization/departments"')],
  ["전용 구성원 API", api.includes('"/workspace/organization/members')],
  ["설계 응답 키", api.includes("departments: OrganizationDepartment[]") && api.includes("members: OrganizationMember[]") && panel.includes("response.departments") && panel.includes("response.members")],
  ["기존 directory API 보존", api.includes('"/workspace/directory"')],
  ["3열 작업면", panel.includes("ui042-departments") && panel.includes("ui042-members") && panel.includes("ui042-detail")],
  ["계층과 순환 보호", panel.includes("expandedDepartmentIds") && panel.includes("visited")],
  ["서버 검색 debounce", panel.includes("300") && panel.includes("requestSequence")],
  ["부서·구성원 상태 분리", panel.includes("departmentsLoading") && panel.includes("membersLoading") && panel.includes("departmentsError") && panel.includes("membersError")],
  ["팝업 오류 초기화와 상태", panel.includes('setPopupError("")') && panel.includes("popupLoading") && panel.includes("popupEmpty")],
  ["상세 최신 요청 보호", panel.includes("detailRequestSequence") && panel.includes("sequence === detailRequestSequence.current")],
  ["목록 밖 선택 해제", panel.includes("members.some((member) => member.id === currentSelectionId)") && panel.includes("setSelectedMemberId(\"\")") && panel.includes("setDetail(null)")],
  ["상세 조회", panel.includes("fetchOrganizationMemberDetail")],
  ["메일 작성 연결", panel.includes("onComposeMail")],
  ["단일 선택 dialog", panel.includes('role="dialog"') && panel.includes('aria-modal="true"') && panel.includes("popupSelectionId")],
  ["Escape와 포커스 복귀", panel.includes('event.key === "Escape"') && panel.includes("returnFocusRef")],
  ["로딩·빈 상태·오류·재시도", panel.includes("loading") && panel.includes("empty") && panel.includes("error") && panel.includes("다시 시도")],
  ["organization 분기만 교체", workspace.includes('menu === "org"') && workspace.includes("OrganizationPanel")],
  ["UI-042 범위 CSS", styles.includes(".ui042-organization") && styles.includes("font-size: 12px")],
  ["표준 폰트", styles.includes(".ui042-screen-title") && styles.includes("font-size: 16px") && styles.includes(".ui042-section-title") && styles.includes("font-size: 14px")],
  ["보조 문구 실제 10px 우선순위", /#root\s+\.ui042-header p\s*\{[^}]*font-size:\s*10px\s*!important/.test(styles)],
  ["raw HTML 미사용", !panel.includes("dangerouslySetInnerHTML")],
  ["브라우저 내부주소 미사용", !/localhost|127\.0\.0\.1|host\.docker\.internal|NEXT_PUBLIC_API_BASE_URL/.test(`${panel}\n${api}`)],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error(`UI-042 organization verifier failed: ${failed.map(([name]) => name).join(", ")}`);
  process.exit(1);
}
console.log(`UI-042 organization verifier: ${checks.length}/${checks.length} passed`);
