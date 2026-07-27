import type { WorkspaceCalendar, WorkspaceCalendarData } from "./api";

export const calendarColors = ["#0f766e", "#2563eb", "#7c3aed", "#db2777", "#dc2626", "#d97706", "#65a30d", "#0891b2"] as const;

export function initialSelectedCalendarIds(data: WorkspaceCalendarData): string[] {
  return [...data.owned.map((item) => item.id), ...data.subscriptions.filter((item) => item.status === "active").map((item) => item.calendar.id)];
}

export function moveOwnedCalendar(items: WorkspaceCalendar[], calendarId: string, direction: -1 | 1): WorkspaceCalendar[] {
  const index = items.findIndex((item) => item.id === calendarId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const result = [...items];
  [result[index], result[target]] = [result[target], result[index]];
  return result;
}

export function canEditSchedule(schedule: { ownerUserId: string; canEdit: boolean }, ownerUserId: string): boolean {
  return schedule.canEdit && schedule.ownerUserId === ownerUserId;
}
