import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const api = fs.readFileSync(path.join(root, "src", "api.ts"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");

const requirements = [
  [api, "canLeave: boolean"],
  [api, "canDelete: boolean"],
  [api, "transferMessengerRoomOwner"],
  [api, "leaveMessengerRoom"],
  [api, "deleteMessengerRoom"],
  [app, "방장 이전"],
  [app, "대화방 나가기"],
  [app, "대화방 삭제"],
  [app, "handleMessengerOwnerTransfer"],
  [app, "handleMessengerLeave"],
  [app, "handleMessengerDelete"],
  [app, "MessengerRoomLifecycleAction"],
];

for (const [source, token] of requirements) {
  if (!source.includes(token)) throw new Error(`missing lifecycle contract: ${token}`);
}

const lifecycleSection = app.slice(app.indexOf("async function handleMessengerOwnerTransfer"), app.indexOf("async function loadHomeSchedules"));
if (lifecycleSection.includes("window.confirm(")) throw new Error("messenger lifecycle must use CommonPopup, not window.confirm");
if (api.includes('request<MessengerRoomDetail>("http')) throw new Error("messenger API must remain same-origin");

console.log("UI-040 messenger lifecycle static verification passed");
