#!/usr/bin/env node
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { AppError, toAppError } from "./errors.js";
import { formatText } from "./format.js";
import { fetchedAt } from "./time.js";
import { apps, authStatus, courseList, courseToday, doctor, gradeList, gradeSummary, libraryItem, librarySearch, login, logout, planStatus } from "./commands.js";

const HELP = `tyut-cli  太原理工大学只读查询

用法
  tyut doctor
  tyut auth login
  tyut auth status
  tyut auth logout
  tyut course today
  tyut course list [--week 周次]
  tyut grade summary
  tyut grade list
  tyut plan status
  tyut library search 书名 [--page 页码]
  tyut library item marc_no
  tyut apps

任何命令都可以加 --json。
密码只在登录提示中输入；非交互环境使用 TYUT_USERNAME 和 TYUT_PASSWORD。
登录状态保存在本机用户目录，退出即删除。本工具不提供选课、报名或修改操作。
`;

function parseArgs(argv) {
  if (argv.some((arg) => /^(--)?(password|passwd|pwd|pass)(=|$)/i.test(arg))) {
    throw new AppError("not_supported", "密码不能写在命令参数里。请在提示中输入，或在非交互环境使用 TYUT_PASSWORD。");
  }
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") flags.json = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      flags[key] = next != null && !next.startsWith("--") ? argv[++i] : true;
    } else positionals.push(arg);
  }
  return { positionals, flags };
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(String(answer || "").trim());
  }));
}

function askSecret(question) {
  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!stdin.isTTY) return Promise.resolve("");
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  let value = "";
  return new Promise((resolve) => {
    const cleanup = () => {
      stdin.off("data", onData);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = (chunk) => {
      const text = String(chunk);
      if (text.includes("\u0003")) {
        cleanup();
        stdout.write("\n");
        process.exit(130);
      }
      if (text === "\r" || text === "\n" || text === "\r\n") {
        cleanup();
        stdout.write("\n");
        resolve(value);
        return;
      }
      if (text === "\u007f" || text === "\b") {
        value = value.slice(0, -1);
        return;
      }
      if ([...text].some((char) => char.charCodeAt(0) < 32)) return;
      value += text;
    };
    stdin.on("data", onData);
  });
}

function weekFlag(value) {
  if (value == null) return null;
  if (!/^\d{1,2}$/.test(String(value)) || Number(value) < 1 || Number(value) > 30) {
    throw new AppError("not_supported", "周次需要是 1 到 30 的整数。");
  }
  return Number(value);
}

function pageFlag(value) {
  if (value == null) return 1;
  if (!/^\d{1,3}$/.test(String(value)) || Number(value) < 1) throw new AppError("not_supported", "页码需要是正整数。");
  return Number(value);
}

async function dispatch(positionals, flags) {
  const [group, action, ...rest] = positionals;
  if (!group || flags.help) return { command: "help", source: "local", data: { help: HELP }, help: true };
  if (group === "doctor") return { command: "doctor", source: "local", result: await doctor() };
  if (group === "auth" && action === "login") {
    let username = "";
    let password = "";
    if (process.stdin.isTTY) {
      username = await ask("学号：");
      password = await askSecret("密码：");
    } else {
      username = process.env.TYUT_USERNAME || "";
      password = process.env.TYUT_PASSWORD || "";
    }
    if (!username || !password) throw new AppError("login_required", "请输入学号和密码。非交互环境请设置 TYUT_USERNAME 和 TYUT_PASSWORD。");
    return { command: "auth.login", source: "portal", data: await login(username, password) };
  }
  if (group === "auth" && action === "status") return { command: "auth.status", source: "local", data: authStatus() };
  if (group === "auth" && action === "logout") return { command: "auth.logout", source: "local", data: logout() };
  if (group === "course" && action === "list") return { command: "course.list", source: "academic", data: await courseList({ week: weekFlag(flags.week) }) };
  if (group === "course" && action === "today") return { command: "course.today", source: "academic", data: await courseToday() };
  if (group === "grade" && action === "list") return { command: "grade.list", source: "academic", data: await gradeList() };
  if (group === "grade" && action === "summary") return { command: "grade.summary", source: "academic", data: await gradeSummary() };
  if (group === "plan" && action === "status") return { command: "plan.status", source: "academic", data: await planStatus() };
  if (group === "library" && action === "search") {
    return { command: "library.search", source: "library", data: await librarySearch(rest.join(" ").trim(), pageFlag(flags.page)) };
  }
  if (group === "library" && action === "item") return { command: "library.item", source: "library", data: await libraryItem(rest[0] || "") };
  if (group === "apps" && !action) return { command: "apps", source: "portal", data: await apps() };
  throw new AppError("not_supported", `不支持的命令：${positionals.join(" ") || "空"}。运行 tyut --help 查看用法。`);
}

export function buildEnvelope(payload, now = new Date()) {
  const failed = Boolean(payload.error) || payload.result?.ok === false;
  if (failed) {
    const error = payload.error || { code: payload.result.code, message: payload.result.message };
    return { ok: false, command: payload.command, error: { code: error.code, message: error.message } };
  }
  const data = payload.data !== undefined ? payload.data : payload.result?.data;
  return { ok: true, command: payload.command, fetchedAt: fetchedAt(now), source: payload.source, data };
}

export function emit(payload, json) {
  const body = buildEnvelope(payload);
  const error = body.ok ? null : body.error;
  if (payload.help && !json) {
    process.stdout.write(HELP);
    return true;
  }
  if (json) process.stdout.write(`${JSON.stringify(body)}\n`);
  else if (payload.command === "doctor" && payload.result?.data) process.stdout.write(`${formatText("doctor", payload.result.data)}\n${error ? `${error.message}\n` : ""}`);
  else if (error) process.stdout.write(`${error.message}\n`);
  else process.stdout.write(`${formatText(payload.command, payload.data)}\n`);
  return !error;
}

export async function run(argv) {
  try {
    const { positionals, flags } = parseArgs(argv);
    const payload = await dispatch(positionals, flags);
    const ok = emit(payload, Boolean(flags.json));
    return ok ? 0 : 1;
  } catch (err) {
    const app = err instanceof AppError ? err : toAppError(err);
    const body = buildEnvelope({ command: "tyut", error: { code: app.code, message: app.message } });
    if (argv.includes("--json")) process.stdout.write(`${JSON.stringify(body)}\n`);
    else process.stdout.write(`${app.message}\n`);
    return 1;
  }
}

export function isDirectRun(entryArg = process.argv[1], moduleUrl = import.meta.url) {
  if (!entryArg) return false;
  try {
    const entry = path.resolve(entryArg);
    const self = path.resolve(fileURLToPath(moduleUrl));
    return process.platform === "win32" ? entry.toLowerCase() === self.toLowerCase() : entry === self;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
