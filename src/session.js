import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function sessionDir() {
  return process.env.TYUT_HOME || path.join(os.homedir(), ".tyut-cli");
}

export function sessionPath() {
  return path.join(sessionDir(), "session.json");
}

function tighten(file) {
  try {
    if (process.platform === "win32") {
      const user = `${process.env.USERDOMAIN || ""}\\${process.env.USERNAME || ""}`;
      if (user !== "\\") {
        spawnSync("icacls", [file, "/inheritance:r", "/grant:r", `${user}:(R,W)`], { windowsHide: true, stdio: "ignore" });
      }
      return;
    }
    fs.chmodSync(file, 0o600);
  } catch {
    // Permission tightening is best-effort.
  }
}

export function loadSession() {
  try {
    const parsed = JSON.parse(fs.readFileSync(sessionPath(), "utf8"));
    return Array.isArray(parsed.cookies) ? parsed.cookies : [];
  } catch {
    return [];
  }
}

export function sessionExists() {
  return fs.existsSync(sessionPath());
}

export function saveSession(cookies) {
  const secret = process.env.TYUT_PASSWORD || "";
  const safe = (cookies || []).map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path || "/",
    hostOnly: cookie.hostOnly !== false,
    secure: Boolean(cookie.secure),
  }));
  const serialized = JSON.stringify({ version: 1, cookies: safe });
  if (secret && serialized.includes(secret)) {
    throw new Error("refusing to store password");
  }
  fs.mkdirSync(sessionDir(), { recursive: true });
  const file = sessionPath();
  fs.writeFileSync(file, serialized, { encoding: "utf8", mode: 0o600 });
  tighten(file);
}

export function clearSession() {
  try {
    fs.rmSync(sessionPath(), { force: true });
  } catch {
    // Already gone.
  }
}