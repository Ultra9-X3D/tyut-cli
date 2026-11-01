import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { AppError, appError, networkError } from "./errors.js";
import { isLoginPage, parseCasForm, parseCurrentWeek } from "./html.js";
import { Client, requestOnce } from "./http.js";
import { filterCourses, parseApps, parseGrades, parseLibraryItem, parseLibrarySearch, parsePlan, parseSchedule, parseSummary } from "./parse.js";
import { URLS, buildAppsBody, buildGradeBody, buildLibraryItemUrl, buildLibrarySearchUrl, buildPlanBody, buildScheduleBody } from "./requests.js";
import { clearSession, loadSession, saveSession, sessionExists } from "./session.js";
import { shanghaiWeekday } from "./time.js";

const desPath = fileURLToPath(new URL("../vendor/des.js", import.meta.url));
let strEncFn;

function strEnc(data) {
  if (!strEncFn) {
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(desPath, "utf8"), sandbox, { filename: "des.js" });
    strEncFn = sandbox.strEnc;
  }
  if (typeof strEncFn !== "function") throw appError("upstream_unavailable", "登录加密组件不可用。");
  return strEncFn(data, "1", "2", "3");
}

export function majorVersion(version) {
  return Number(String(version || process.versions.node).split(".")[0]);
}

export function assessDoctor({ nodeVersion, sessionPresent, endpoints }) {
  const nodeOk = majorVersion(nodeVersion) >= 20;
  const data = {
    nodeVersion,
    nodeOk,
    sessionExists: Boolean(sessionPresent),
    endpoints,
  };
  if (!nodeOk) {
    return { ok: false, code: "not_supported", message: "需要 Node.js 20 或更高版本。", data };
  }
  const failed = endpoints.filter((item) => !item.ok);
  if (!failed.length) return { ok: true, data };
  const campus = failed.some((item) => item.kind === "academic" || item.kind === "library");
  return {
    ok: false,
    code: campus ? "campus_network_required" : "upstream_unavailable",
    message: campus ? "当前网络访问不了校园网服务，请连接校园网后重试。" : "统一认证暂时无法连接。",
    data,
  };
}

async function probe(url, kind, label) {
  try {
    const response = await requestOnce(url, { method: "GET", timeout: 8000 });
    return { kind, label, ok: response.status > 0 };
  } catch {
    return { kind, label, ok: false };
  }
}

export async function doctor() {
  const endpoints = [
    await probe(URLS.casProbe, "cas", "统一认证"),
    await probe(URLS.academicProbe, "academic", "教务系统"),
    await probe(URLS.libraryProbe, "library", "图书馆"),
  ];
  return assessDoctor({ nodeVersion: process.versions.node, sessionPresent: sessionExists(), endpoints });
}

export function casLoginBody(username, password, form) {
  return new URLSearchParams({
    rsa: strEnc(username + password + form.lt),
    ul: String(username.length),
    pl: String(password.length),
    lt: form.lt,
    execution: form.execution,
    _eventId: "submit",
  }).toString();
}

export async function login(username, password) {
  if (!username || !password) throw appError("login_required", "请输入学号和密码。");
  const client = new Client([], { auth: false });
  let page;
  try {
    page = await client.follow(URLS.casLogin);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw networkError(err, "cas");
  }
  const form = parseCasForm(page.text, page.url);
  if (!form) throw appError("upstream_unavailable", "统一认证页面格式已变化。");
  const body = casLoginBody(username, password, form);
  let logged;
  try {
    logged = await client.follow(form.action, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw networkError(err, "cas");
  }
  const established = client.jar.some((cookie) => cookie.name === "CASTGC") || /one\.tyut\.edu\.cn/i.test(logged.url);
  if (!established || isLoginPage(logged.url, logged.text)) {
    throw appError("login_required", "账号或密码不正确，或统一认证没有完成。");
  }
  saveSession(client.jar);
  return { loggedIn: true };
}

export function authStatus() {
  return { loggedIn: loadSession().length > 0 };
}

export function logout() {
  clearSession();
  return { loggedIn: false };
}

function kindFor(url) {
  const host = new URL(url).hostname;
  if (host === "192.168.200.7" || host.startsWith("192.168.")) return "academic";
  if (host === "202.207.250.5") return "library";
  if (host.endsWith("tyut.edu.cn")) return "cas";
  return "cas";
}

async function authedClient() {
  const cookies = loadSession();
  if (!cookies.length) throw appError("login_required", "还没有登录。请先运行 tyut auth login。");
  return new Client(cookies, { auth: true });
}

async function withSession(fn) {
  const client = await authedClient();
  try {
    const result = await fn(client);
    saveSession(client.jar);
    return result;
  } catch (err) {
    if (err instanceof AppError && err.code === "session_expired") clearSession();
    throw err;
  }
}

async function academic(client, url, options) {
  try {
    return await client.follow(url, options);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw networkError(err, kindFor(url));
  }
}

export async function courseList({ week = null } = {}) {
  return withSession(async (client) => {
    const index = await academic(client, URLS.academicEntry);
    if (isLoginPage(index.url, index.text)) throw appError("session_expired", "登录已过期，请重新运行 tyut auth login。");
    const page = await academic(client, URLS.scheduleIndex);
    const currentWeek = parseCurrentWeek(page.text);
    const table = await academic(client, URLS.schedule, {
      method: "POST",
      body: buildScheduleBody(),
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
    });
    const courses = filterCourses(parseSchedule(table.text), { week });
    return { currentWeek, filterWeek: week, courses };
  });
}

export async function courseToday(now = new Date()) {
  const weekday = shanghaiWeekday(now);
  const listed = await courseList();
  if (listed.currentWeek == null) throw appError("upstream_unavailable", "课表页没有给出当前周次。");
  return {
    week: listed.currentWeek,
    weekday,
    courses: filterCourses(listed.courses, { week: listed.currentWeek, weekday }),
  };
}

export async function gradeList() {
  return withSession(async (client) => {
    await academic(client, URLS.academicEntry);
    const page = await academic(client, URLS.grades, {
      method: "POST",
      body: buildGradeBody(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Referer: "http://192.168.200.7/Tschedule/C6Cjgl/KccjIndex",
      },
    });
    return { courses: parseGrades(page.text) };
  });
}

export async function gradeSummary() {
  return withSession(async (client) => {
    await academic(client, URLS.academicEntry);
    const page = await academic(client, URLS.summary, {
      method: "POST",
      body: buildGradeBody(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Referer: "http://192.168.200.7/Tschedule/C6Cjgl/XskccjIndex",
      },
    });
    return parseSummary(page.text);
  });
}

export async function planStatus() {
  return withSession(async (client) => {
    await academic(client, URLS.academicEntry);
    const page = await academic(client, URLS.plan, {
      method: "POST",
      body: buildPlanBody(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Referer: "http://192.168.200.7/Tschedule/C6Cjgl/KzxxIndex",
      },
    });
    return parsePlan(page.text);
  });
}

async function publicGet(url, kind) {
  const client = new Client([], { auth: false });
  try {
    return await client.follow(url);
  } catch (err) {
    if (err instanceof AppError && err.code !== "session_expired") throw err;
    throw networkError(err, kind);
  }
}

export async function librarySearch(query, page = 1) {
  if (!query) throw appError("not_supported", "请提供要检索的书名。");
  const response = await publicGet(buildLibrarySearchUrl(query, page), "library");
  return { query, page: Number(page) || 1, books: parseLibrarySearch(response.text) };
}

export async function libraryItem(marcNo) {
  if (!marcNo) throw appError("not_supported", "请提供 marc_no。");
  const response = await publicGet(buildLibraryItemUrl(marcNo), "library");
  return { marcNo, ...parseLibraryItem(response.text) };
}

export async function apps() {
  return withSession(async (client) => {
    const response = await academic(client, URLS.apps, {
      method: "POST",
      body: buildAppsBody(),
      headers: { "Content-Type": "application/json;charset=utf-8", "X-Requested-With": "XMLHttpRequest" },
    });
    return { apps: parseApps(response.text) };
  });
}