import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AppError, ERROR_CODES, networkError } from "../src/errors.js";
import { buildEnvelope } from "../src/cli.js";
import { assessDoctor, casLoginBody } from "../src/commands.js";
import { Client, cookieHeader, metaRefreshTarget, storeCookies } from "../src/http.js";
import { RELAXED_TLS_HOSTS, URLS, buildAppsBody, buildGradeBody, buildLibraryItemUrl, buildLibrarySearchUrl, buildPlanBody, buildScheduleBody, rejectUnauthorized } from "../src/requests.js";
import { clearSession, loadSession, saveSession, sessionExists, sessionPath } from "../src/session.js";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "tyut-protocol-"));
process.env.TYUT_HOME = scratch;
delete process.env.TYUT_PASSWORD;
delete process.env.TYUT_USERNAME;

test("request bodies stay read-only and do not carry a student id", () => {
  assert.equal(buildPlanBody(), "");
  assert.equal([...new URLSearchParams(buildPlanBody()).keys()].length, 0);

  const grade = new URLSearchParams(buildGradeBody());
  assert.deepEqual([...grade.keys()], ["order"]);
  assert.equal(grade.get("order"), "zxjxjhh desc,kch");

  const schedule = new URLSearchParams(buildScheduleBody());
  assert.deepEqual([...schedule.keys()], ["pagination[conditionJson]", "pagination[sort]", "pagination[order]"]);
  assert.deepEqual(JSON.parse(schedule.get("pagination[conditionJson]")), { zxjxjhh: "", isshowllkb: "1", isshowsykb: "" });
  assert.equal(schedule.get("pagination[sort]"), "kch,kxh,skzc desc,skxq,skjc");
  assert.equal(schedule.get("pagination[order]"), "desc");

  const search = new URL(buildLibrarySearchUrl("示例书", 2));
  assert.equal(`${search.origin}${search.pathname}`, URLS.librarySearch);
  assert.equal(search.searchParams.get("strSearchType"), "title");
  assert.equal(search.searchParams.get("strText"), "示例书");
  assert.equal(search.searchParams.get("match_flag"), "forward");
  assert.equal(search.searchParams.get("displaypg"), "20");
  assert.equal(search.searchParams.get("page"), "2");
  assert.equal(new URL(buildLibrarySearchUrl("示例书")).searchParams.get("page"), "1");

  const item = new URL(buildLibraryItemUrl("0000123456"));
  assert.equal(`${item.origin}${item.pathname}`, URLS.libraryItem);
  assert.equal(item.searchParams.get("marc_no"), "0000123456");
  assert.deepEqual(JSON.parse(buildAppsBody()), { TYPE: "1", name: "", app_english_name: "", categorys: "" });

  assert.equal(URLS.academicEntry, "http://192.168.200.7/login/NeuSoftCas");
  assert.equal(URLS.schedule, "http://192.168.200.7/Tresources/A1Xskb/GetXsKb");
  assert.equal(URLS.grades, "http://192.168.200.7/Tschedule/C6Cjgl/GetKccjResult");
  assert.equal(URLS.summary, "http://192.168.200.7/Tschedule/C6Cjgl/GetXskccjResult");
  assert.equal(URLS.plan, "http://192.168.200.7/Tschedule/C6Cjgl/GetFakcResult");
  assert.equal(URLS.apps, "https://one.tyut.edu.cn/tp_up/up/appstore/applist/getBusinessAppsList");
});

test("TLS checks stay on except the two known campus hosts", () => {
  assert.deepEqual([...RELAXED_TLS_HOSTS].sort(), ["cas.tyut.edu.cn", "one.tyut.edu.cn"]);
  assert.equal(rejectUnauthorized("cas.tyut.edu.cn"), false);
  assert.equal(rejectUnauthorized("one.tyut.edu.cn"), false);
  assert.equal(rejectUnauthorized("192.168.200.7"), true);
  assert.equal(rejectUnauthorized("202.207.250.5"), true);
  assert.equal(rejectUnauthorized("lib.tyut.edu.cn"), true);

  const httpSource = fs.readFileSync(new URL("../src/http.js", import.meta.url), "utf8");
  const commandSource = fs.readFileSync(new URL("../src/commands.js", import.meta.url), "utf8");
  assert.doesNotMatch(httpSource, /NODE_TLS_REJECT_UNAUTHORIZED/);
  assert.doesNotMatch(httpSource, /rejectUnauthorized:\s*false/);
  assert.equal(commandSource.includes("CheckLogin"), false);
  assert.equal(commandSource.split("casLoginBody(").length - 1, 2);
});

test("CAS login body carries lengths and ciphertext, not the password", () => {
  const username = "1000000001";
  const password = "sample-password";
  const body = casLoginBody(username, password, { lt: "LT-sample", execution: "e1s1" });
  const params = new URLSearchParams(body);
  assert.deepEqual([...params.keys()].sort(), ["_eventId", "execution", "lt", "pl", "rsa", "ul"]);
  assert.equal(params.get("ul"), "10");
  assert.equal(params.get("pl"), "15");
  assert.equal(params.get("lt"), "LT-sample");
  assert.equal(params.get("execution"), "e1s1");
  assert.equal(params.get("_eventId"), "submit");
  assert.match(params.get("rsa"), /^[0-9A-F]+$/);
  assert.equal(body.includes(username), false);
  assert.equal(body.includes(password), false);
});

test("cookies do not cross host, path, or scheme", () => {
  const jar = [];
  storeCookies(jar, ["SID=abc; Path=/tpass; Secure", "WIDE=1; Domain=.tyut.edu.cn; Path=/"], "https://cas.tyut.edu.cn/tpass/login");
  assert.equal(cookieHeader(jar, "https://cas.tyut.edu.cn/tpass/login"), "SID=abc; WIDE=1");
  assert.equal(cookieHeader(jar, "https://cas.tyut.edu.cn/tpass"), "SID=abc; WIDE=1");
  assert.equal(cookieHeader(jar, "https://cas.tyut.edu.cn/tpassword"), "WIDE=1");
  assert.equal(cookieHeader(jar, "http://cas.tyut.edu.cn/tpass/login"), "WIDE=1");
  assert.equal(cookieHeader(jar, "https://one.tyut.edu.cn/tp_up/"), "WIDE=1");
  assert.equal(cookieHeader(jar, "https://evil-tyut.edu.cn/"), "");
  assert.equal(cookieHeader(jar, "http://202.207.250.5/opac/openlink.php"), "");

  const before = jar.length;
  storeCookies(jar, "FOREIGN=1; Domain=example.com; Path=/", "https://cas.tyut.edu.cn/tpass/login");
  assert.equal(jar.length, before);

  storeCookies(jar, "SID=; Max-Age=0; Path=/tpass; Secure", "https://cas.tyut.edu.cn/tpass/login");
  assert.equal(cookieHeader(jar, "https://cas.tyut.edu.cn/tpass/login").includes("SID="), false);
  assert.equal(cookieHeader(jar, "https://one.tyut.edu.cn/").includes("WIDE="), true);
});

test("meta refresh is only followed for a short shell page", async () => {
  assert.equal(metaRefreshTarget('<meta http-equiv="refresh" content="0;url=/tp_up/view?m=up">'), "/tp_up/view?m=up");
  assert.equal(metaRefreshTarget('<meta content="0; URL=/next?a=1&amp;b=2" http-equiv="refresh">'), "/next?a=1&b=2");
  assert.equal(metaRefreshTarget('<meta http-equiv="refresh" content="0;url=/x"><table></table>'), "");
  assert.equal(metaRefreshTarget(`${" ".repeat(8193)}<meta http-equiv="refresh" content="0;url=/x">`), "");

  const seen = [];
  const client = new Client([], {
    auth: false,
    transport: async (url, options) => {
      seen.push({ url, method: options.method, body: options.body, cookie: options.headers.Cookie || "" });
      if (url.endsWith("/start")) {
        return { status: 200, headers: { "content-type": "text/html" }, body: Buffer.from('<meta http-equiv="refresh" content="0;url=/next">') };
      }
      if (url.endsWith("/next")) {
        return { status: 302, headers: { location: "done", "set-cookie": "SID=1; Path=/" }, body: Buffer.from("posted") };
      }
      return { status: 200, headers: { "content-type": "text/html" }, body: Buffer.from("<html>ok</html>") };
    },
  });
  const page = await client.follow("https://example.test/start", { method: "POST", body: "a=1" });
  assert.equal(page.url, "https://example.test/done");
  assert.equal(page.text, "<html>ok</html>");
  assert.deepEqual(seen.map((item) => item.method), ["POST", "GET", "GET"]);
  assert.equal(seen[1].body, undefined);
  assert.equal(seen[2].cookie, "SID=1");
});

test("expired portal pages and redirect loops use the fixed error codes", async () => {
  const expired = new Client([{ name: "CASTGC", value: "sample", domain: "cas.tyut.edu.cn", path: "/", hostOnly: true, secure: true }], {
    auth: true,
    transport: async () => ({ status: 200, headers: { "content-type": "text/html" }, body: Buffer.from('<form id="loginForm"><input name="lt" value="LT-sample"></form>') }),
  });
  await assert.rejects(() => expired.follow("https://cas.tyut.edu.cn/tpass/login"), (err) => err instanceof AppError && err.code === "session_expired");

  let hops = 0;
  const looping = new Client([], {
    auth: false,
    transport: async () => {
      hops += 1;
      return { status: 302, headers: { location: "/loop" }, body: Buffer.from("") };
    },
  });
  await assert.rejects(() => looping.follow("http://example.test/begin"), (err) => err instanceof AppError && err.code === "upstream_unavailable");
  assert.equal(hops, 12);

  const huge = new Client([], {
    auth: false,
    transport: async () => ({ status: 200, headers: {}, body: Buffer.alloc(2_000_001) }),
  });
  await assert.rejects(() => huge.follow("http://example.test/huge"), (err) => err instanceof AppError && err.code === "upstream_unavailable");
});

test("failure envelopes expose only the five error codes", () => {
  assert.deepEqual(ERROR_CODES, ["campus_network_required", "login_required", "session_expired", "upstream_unavailable", "not_supported"]);
  for (const code of ERROR_CODES) {
    const body = buildEnvelope({ command: "grade.summary", error: { code, message: "示例说明" } });
    assert.deepEqual(Object.keys(body).sort(), ["command", "error", "ok"]);
    assert.equal(body.ok, false);
    assert.deepEqual(body.error, { code, message: "示例说明" });
  }

  const doctor = buildEnvelope({
    command: "doctor",
    source: "local",
    result: { ok: false, code: "campus_network_required", message: "当前网络访问不了校园网服务，请连接校园网后重试。", data: { hidden: "nope" } },
  });
  assert.equal(doctor.error.code, "campus_network_required");
  assert.equal(JSON.stringify(doctor).includes("nope"), false);

  const ok = buildEnvelope({ command: "auth.status", source: "local", data: { loggedIn: false } }, new Date("2026-11-02T12:34:56+08:00"));
  assert.deepEqual(Object.keys(ok).sort(), ["command", "data", "fetchedAt", "ok", "source"]);
  assert.equal(ok.fetchedAt, "2026-11-02T12:34:56+08:00");
  assert.equal(ok.ok, true);
});

test("doctor classifies node, campus, and portal failures without connecting", () => {
  const endpoints = [
    { kind: "cas", label: "统一认证", ok: true },
    { kind: "academic", label: "教务系统", ok: true },
    { kind: "library", label: "图书馆", ok: true },
  ];
  assert.equal(assessDoctor({ nodeVersion: "18.20.0", sessionPresent: false, endpoints }).code, "not_supported");
  assert.equal(assessDoctor({ nodeVersion: "22.0.0", sessionPresent: true, endpoints: endpoints.map((item) => ({ ...item, ok: item.kind !== "library" })) }).code, "campus_network_required");
  assert.equal(assessDoctor({ nodeVersion: "20.0.0", sessionPresent: false, endpoints: endpoints.map((item) => ({ ...item, ok: item.kind !== "cas" })) }).code, "upstream_unavailable");
  assert.equal(assessDoctor({ nodeVersion: "20.0.0", sessionPresent: false, endpoints }).ok, true);

  assert.equal(networkError(Object.assign(new Error("connect"), { code: "ECONNREFUSED" }), "academic").code, "campus_network_required");
  assert.equal(networkError(Object.assign(new Error("connect"), { code: "ENETUNREACH" }), "library").code, "campus_network_required");
  assert.equal(networkError(new Error("UNABLE_TO_VERIFY_LEAF_SIGNATURE"), "cas").code, "upstream_unavailable");
  assert.equal(networkError(new Error("bad html"), "academic").code, "upstream_unavailable");
});

test("session files stay inside TYUT_HOME and never store a password", () => {
  const first = path.join(scratch, "one");
  const second = path.join(scratch, "two");
  process.env.TYUT_HOME = first;
  assert.equal(sessionExists(), false);
  assert.deepEqual(loadSession(), []);

  saveSession([{ name: "SID", value: "alpha", domain: "example.test", path: "/app", secure: true }]);
  const saved = JSON.parse(fs.readFileSync(sessionPath(), "utf8"));
  assert.equal(saved.version, 1);
  assert.deepEqual(Object.keys(saved).sort(), ["cookies", "version"]);
  assert.deepEqual(Object.keys(saved.cookies[0]).sort(), ["domain", "hostOnly", "name", "path", "secure", "value"]);
  assert.equal(saved.cookies[0].value, "alpha");
  assert.equal(saved.cookies[0].hostOnly, true);

  process.env.TYUT_HOME = second;
  assert.deepEqual(loadSession(), []);
  saveSession([{ name: "SID", value: "beta", domain: "example.test" }]);
  assert.equal(loadSession()[0].hostOnly, true);

  process.env.TYUT_HOME = first;
  assert.equal(loadSession()[0].value, "alpha");
  clearSession();
  assert.equal(sessionExists(), false);
  assert.equal(fs.existsSync(path.join(second, "session.json")), true);

  process.env.TYUT_PASSWORD = "do-not-store-this";
  assert.throws(() => saveSession([{ name: "SID", value: "prefix-do-not-store-this-suffix", domain: "example.test" }]), /refusing to store password/);
  assert.equal(sessionExists(), false);
  delete process.env.TYUT_PASSWORD;

  fs.mkdirSync(first, { recursive: true });
  fs.writeFileSync(sessionPath(), "{", "utf8");
  assert.deepEqual(loadSession(), []);
  clearSession();
  clearSession();
});
