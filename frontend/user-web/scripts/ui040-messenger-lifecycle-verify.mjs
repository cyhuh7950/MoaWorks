import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const api = fs.readFileSync(path.join(root, "src", "api.ts"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const panel = fs.readFileSync(path.join(root, "src", "MessengerPanel.tsx"), "utf8");

const requirements = [
  [api, "canLeave: boolean"],
  [api, "canDelete: boolean"],
  [api, "transferMessengerRoomOwner"],
  [api, "leaveMessengerRoom"],
  [api, "deleteMessengerRoom"],
  [panel, "방장 이전"],
  [panel, "대화방 나가기"],
  [panel, "대화방 삭제"],
  [panel, "transferMessengerRoomOwner"],
  [panel, "leaveMessengerRoom"],
  [panel, "deleteMessengerRoom"],
  [panel, "lifecycleAction"],
];

for (const [source, token] of requirements) {
  if (!source.includes(token)) throw new Error(`missing lifecycle contract: ${token}`);
}

const lifecycleSection = panel.slice(panel.indexOf("async function transferRoomOwner"), panel.indexOf("function roomGroup"));
if (lifecycleSection.includes("window.confirm(")) throw new Error("messenger lifecycle must use CommonPopup, not window.confirm");
if (!app.includes("<MessengerPanel token={token}")) throw new Error("production messenger route must render MessengerPanel");
if (api.includes('request<MessengerRoomDetail>("http')) throw new Error("messenger API must remain same-origin");

console.log("UI-040 messenger lifecycle static verification passed");
