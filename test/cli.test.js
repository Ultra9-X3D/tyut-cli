import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function baseEnv(home) {
  return {
    PATH: process.env.PATH || "",
    Path: process.env.Path || process.env.PATH || "",
    SystemRoot: process.env.SystemRoot || "",
    WINDIR: process.env.WINDIR || "",
    TEMP: process.env.TEMP || os.tmpdir(),
    TMP: process.env.TMP || os.tmpdir(),
    PATHEXT: process.env.PATHEXT || "",
    ComSpec: process.env.ComSpec || "",
    TYUT_HOME: home,
  };
}

function runCli(args, home = fs.mkdtempSync(path.join(os.tmpdir(), "tyut-cli-"))) {
  if (!home) throw new Error("refusing to run without an isolated TYUT_HOME");
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    input: "",
    timeout: 5000,
    windowsHide: true,
    env: baseEnv(home),
  });
  if (result.error) throw new Error(`command did not finish: ${result.error.message}`);
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "", home };
}

function jsonOf(result) {
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

test("prints help without touching the network", () => {
  const help = runCli(["--help"]);
  const bare = runCli([]);
  assert.equal(help.status, 0);
  assert.equal(help.stderr, "");
  assert.equal(bare.status, 0);
  assert.equal(bare.stdout, help.stdout);
  assert.match(help.stdout, /tyut auth login/);
  assert.match(help.stdout, /tyut course today/);
  assert.match(help.stdout, /tyut grade summary/);
  assert.match(help.stdout, /tyut library search/);
  assert.match(help.stdout, /不提供选课/);

  const body = jsonOf(runCli(["--json", "--help"]));
  assert.equal(body.ok, true);
  assert.equal(body.command, "help");
  assert.equal(body.source, "local");
  assert.match(body.data.help, /TYUT_PASSWORD/);
});

test("rejects a password argument without echoing it", () => {
  const secret = "cli-secret-value";
  const text = runCli(["auth", "login", "--password", secret]);
  assert.equal(text.status, 1);
  assert.equal(text.stderr, "");
  assert.equal(`${text.stdout}${text.stderr}`.includes(secret), false);
  assert.match(text.stdout, /密码不能写在命令参数里/);

  const json = jsonOf(runCli(["--json", "--password=cli-secret-value", "course", "list"]));
  assert.equal(json.ok, false);
  assert.equal(json.command, "tyut");
  assert.equal(json.error.code, "not_supported");
  assert.equal(JSON.stringify(json).includes(secret), false);
  assert.deepEqual(Object.keys(json).sort(), ["command", "error", "ok"]);
});

test("stops logged-out queries before any campus request", () => {
  const login = runCli(["auth", "login", "--json"]);
  assert.equal(login.status, 1);
  assert.equal(jsonOf(login).error.code, "login_required");
  assert.equal(fs.existsSync(path.join(login.home, "session.json")), false);

  for (const args of [["course", "list"], ["course", "today"], ["plan", "status"], ["apps"]]) {
    const result = runCli([...args, "--json"]);
    assert.equal(result.status, 1);
    const body = jsonOf(result);
    assert.equal(body.command, "tyut");
    assert.equal(body.error.code, "login_required");
    assert.match(body.error.message, /还没有登录/);
    assert.equal(fs.existsSync(path.join(result.home, "session.json")), false);
  }

  const today = runCli(["course", "today"]);
  assert.equal(today.status, 1);
  assert.equal(today.stderr, "");
  assert.match(today.stdout, /还没有登录/);
  assert.doesNotMatch(today.stdout, /Error/);
});

test("rejects unsupported commands, weeks, and pages locally", () => {
  for (const args of [["course", "select"], ["major", "apply"], ["enroll"]]) {
    const body = jsonOf(runCli([...args, "--json"]));
    assert.equal(body.error.code, "not_supported");
  }

  for (const week of ["0", "31", "abc", "1.5"]) {
    const body = jsonOf(runCli(["course", "list", "--week", week, "--json"]));
    assert.equal(body.error.code, "not_supported");
    assert.match(body.error.message, /周次/);
  }

  const acceptedWeek = jsonOf(runCli(["course", "list", "--week", "30", "--json"]));
  assert.equal(acceptedWeek.error.code, "login_required");

  for (const page of ["0", "1000", "-1"]) {
    const body = jsonOf(runCli(["library", "search", "示例书", "--page", page, "--json"]));
    assert.equal(body.error.code, "not_supported");
    assert.match(body.error.message, /页码/);
  }
});

test("auth status and logout only touch TYUT_HOME", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tyut-cli-session-"));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "tyut-cli-other-"));
  const loggedOut = jsonOf(runCli(["auth", "status", "--json"], home));
  assert.equal(loggedOut.ok, true);
  assert.equal(loggedOut.command, "auth.status");
  assert.equal(loggedOut.source, "local");
  assert.deepEqual(loggedOut.data, { loggedIn: false });
  assert.match(loggedOut.fetchedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);

  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, "session.json"), JSON.stringify({
    version: 1,
    cookies: [{ name: "SID", value: "local-test-cookie", domain: "example.test", path: "/", hostOnly: true, secure: false }],
  }));
  const loggedIn = jsonOf(runCli(["auth", "status", "--json"], home));
  assert.deepEqual(loggedIn.data, { loggedIn: true });
  assert.equal(JSON.stringify(loggedIn).includes("local-test-cookie"), false);
  assert.equal(jsonOf(runCli(["auth", "status", "--json"], other)).data.loggedIn, false);

  const removed = runCli(["auth", "logout"], home);
  assert.equal(removed.status, 0);
  assert.equal(removed.stderr, "");
  assert.match(removed.stdout, /已退出/);
  assert.equal(fs.existsSync(path.join(home, "session.json")), false);
  assert.deepEqual(jsonOf(runCli(["auth", "status", "--json"], home)).data, { loggedIn: false });
  assert.equal(runCli(["auth", "logout"], home).status, 0);
});
