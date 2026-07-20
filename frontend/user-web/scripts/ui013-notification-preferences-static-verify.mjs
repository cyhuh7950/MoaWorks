import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = await readFile(resolve(root, "src/NotificationCenter.tsx"), "utf8");
const popup = await readFile(resolve(root, "src/components/CommonPopup.tsx"), "utf8");
const api = await readFile(resolve(root, "src/api.ts"), "utf8");
const schema = await readFile(resolve(root, "../../backend/app/schemas/notification_center.py"), "utf8");
const service = await readFile(resolve(root, "../../backend/app/services/notification_center_service.py"), "utf8");

const categories = ["mail", "approval", "messenger", "schedule", "file", "notice", "system"];
const checks = [
  ["알림 설정 단일 진입점", source.includes('>알림 설정</button>')],
  ["팝업 열기마다 GET 조회", source.includes("fetchNotificationPreferences(token)") && source.indexOf("fetchNotificationPreferences(token)") < source.indexOf("setSettingsOpen(true)")],
  ["PUT 응답 상태 동기화", source.includes("saveNotificationPreferences(token, settings)") && source.includes("setSavedSettings(value)")],
  ["7개 업무 유형 유지", categories.every(key => source.includes(`${key}:`))],
  ["전체 사용 및 방해 금지", source.includes("앱 내 알림 사용") && source.includes("방해 금지 시간 사용")],
  ["기존 CommonPopup 사용", source.includes('from "./components/CommonPopup"') && source.includes('<CommonPopup title="알림 설정"')],
  ["취소가 dirty closeRequest 사용", popup.includes("closeRequestRef") && source.includes("settingsCloseRequestRef.current?.()")],
  ["취소 직접 닫기 제거", !source.includes('onClick={() => setSettingsOpen(false)}>취소</button>')],
  ["저장 중복 방지", source.includes('disabled={settingsSaving}>저장</button>')],
  ["오류 입력 유지", source.includes("setSettingsError") && !source.includes("setSettings(emptyPreferences)")],
  ["same-origin API helper", api.includes('request<NotificationPreferences>("/notifications/preferences"') && !/https?:\/\/(?:localhost|127\.0\.0\.1|[^/]+:\d+)\/api\//.test(api)],
  ["payload 필드 유지", ["enabled", "quietHoursEnabled", "quietHoursStart", "quietHoursEnd", "categories", "updatedAt"].every(key => api.includes(`${key}:`))],
  ["backend 시간 검증", schema.includes('@field_validator("quietHoursStart", "quietHoursEnd")')],
  ["DB upsert 및 audit", service.includes("ON CONFLICT (user_id) DO UPDATE") && service.includes('"notification.preferences.updated", "user_save"')],
  ["제외된 backdrop 동작 미변경", !popup.includes("event.target === event.currentTarget")],
  ["제외된 saving 닫기 동작 미변경", !popup.includes("if (saving) return")],
];

const failures = checks.filter(([, passed]) => !passed);
for (const [name, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
console.log(JSON.stringify({ passed: checks.length - failures.length, total: checks.length, failures: failures.map(([name]) => name) }));
if (failures.length) process.exitCode = 1;
