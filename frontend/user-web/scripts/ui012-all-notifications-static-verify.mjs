import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = await readFile(resolve(root, "src/NotificationCenter.tsx"), "utf8");
const styles = await readFile(resolve(root, "src/global.css"), "utf8");

const checks = [
  ["미지원 검색 입력 제거", !source.includes('aria-label="알림 검색"')],
  ["클라이언트 검색 상태 제거", !source.includes("searchQuery") && !source.includes("normalizedQuery")],
  ["확인 완료 필터", source.includes('<option value="read">확인 완료</option>')],
  ["가시 목록 선택 정리", source.includes("visibleIds.has(id)") && source.includes("setSelectedIds")],
  ["가시 상세 선택 동기화", source.includes("visibleIds.has(current)") && source.includes('visibleItems[0]?.notificationId ?? ""')],
  ["선택 동기화 재조회 방지", source.includes("useEffect(() =>") && source.includes("}, [visibleItems]);")],
  ["단건 읽음", source.includes("markOneRead")],
  ["공통 삭제 확인 팝업", source.includes('title="알림 삭제"') && source.includes('kind="alertdialog"')],
  ["브라우저 기본 confirm 제거", !source.includes("window.confirm")],
  ["검색 전용 스타일 제거", !styles.includes("notification-center-search")],
  ["4개 필터 배치", styles.includes("grid-template-columns: repeat(4, minmax(130px, 1fr))")],
  ["절대 API 주소 미추가", !/https?:\/\/(?:localhost|127\.0\.0\.1|[^/]+:\d+)\/api\//.test(source)],
];

const failures = checks.filter(([, passed]) => !passed);
for (const [name, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
if (failures.length) process.exitCode = 1;
