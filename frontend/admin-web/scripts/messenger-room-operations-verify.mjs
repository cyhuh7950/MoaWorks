import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const api = fs.readFileSync(path.join(root, "src", "api.ts"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");

for (const token of ["AdminMessengerRoom", "fetchAdminMessengerRooms", "deleteAdminMessengerRoom"]) {
  if (!api.includes(token)) throw new Error(`missing admin messenger API: ${token}`);
}
for (const token of [
  'key: "messenger"',
  "메신저 대화방 관리",
  "14일 후 자동 정리",
  "refreshAdminMessengerRooms",
  "confirmDeleteAdminMessengerRoom",
]) {
  if (!app.includes(token)) throw new Error(`missing admin messenger UI: ${token}`);
}
const deleteHandler = app.slice(app.indexOf("async function confirmDeleteAdminMessengerRoom"), app.indexOf("async function refreshApprovalAuditLogs"));
if (deleteHandler.includes("window.confirm(")) throw new Error("admin messenger deletion must use the existing management confirmation modal");
console.log("admin messenger room operations verification passed");
