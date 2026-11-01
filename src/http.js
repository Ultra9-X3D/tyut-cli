import http from "node:http";
import https from "node:https";
import { appError } from "./errors.js";
import { isLoginPage } from "./html.js";
import { rejectUnauthorized } from "./requests.js";

const USER_AGENT = "tyut-cli/0.1";

export function chooseEncoding(contentType, head) {
  const probe = `${contentType || ""} ${Buffer.isBuffer(head) ? head.subarray(0, 400).toString("latin1") : ""}`;
  return /gbk|gb2312|gb18030/i.test(probe) ? "gbk" : "utf-8";
}

export function parseSetCookie(raw, requestUrl) {
  const parts = String(raw || "").split(";").map((part) => part.trim()).filter(Boolean);
  if (!parts[0] || !parts[0].includes("=")) return null;
  const eq = parts[0].indexOf("=");
  const name = parts[0].slice(0, eq).trim();
  const value = parts[0].slice(eq + 1).trim();
  if (!name) return null;
  const req = new URL(requestUrl);
  let domain = req.hostname.toLowerCase();
  let hostOnly = true;
  let path = "/";
  let secure = false;
  let remove = value.length === 0;
  for (const attr of parts.slice(1)) {
    const index = attr.indexOf("=");
    const key = (index === -1 ? attr : attr.slice(0, index)).trim().toLowerCase();
    const attrValue = index === -1 ? "" : attr.slice(index + 1).trim();
    if (key === "domain" && attrValue) {
      domain = attrValue.replace(/^\./, "").toLowerCase();
      hostOnly = false;
    } else if (key === "path" && attrValue) {
      path = attrValue;
    } else if (key === "secure") {
      secure = true;
    } else if (key === "max-age" && Number(attrValue) === 0) {
      remove = true;
    }
  }
  const host = req.hostname.toLowerCase();
  if (!hostOnly && host !== domain && !host.endsWith(`.${domain}`)) return null;
  return { name, value, domain, path, hostOnly, secure, remove };
}

export function storeCookies(jar, setCookies, requestUrl) {
  const list = Array.isArray(setCookies) ? setCookies : setCookies ? [setCookies] : [];
  for (const raw of list) {
    const parsed = parseSetCookie(raw, requestUrl);
    if (!parsed) continue;
    const index = jar.findIndex((cookie) => cookie.name === parsed.name && cookie.domain === parsed.domain && cookie.path === parsed.path);
    if (parsed.remove) {
      if (index >= 0) jar.splice(index, 1);
      continue;
    }
    const item = { name: parsed.name, value: parsed.value, domain: parsed.domain, path: parsed.path, hostOnly: parsed.hostOnly, secure: parsed.secure };
    if (index >= 0) jar[index] = item;
    else jar.push(item);
  }
  return jar;
}

function pathMatches(pathname, cookiePath) {
  if (cookiePath === "/") return true;
  return pathname === cookiePath || pathname.startsWith(`${cookiePath}/`);
}

export function cookieHeader(jar, url) {
  const target = new URL(url);
  const host = target.hostname.toLowerCase();
  return jar.filter((cookie) => {
    if (cookie.secure && target.protocol !== "https:") return false;
    const domainOk = cookie.hostOnly ? host === cookie.domain : host === cookie.domain || host.endsWith(`.${cookie.domain}`);
    return domainOk && pathMatches(target.pathname, cookie.path || "/");
  }).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

export function requestOnce(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === "https:" ? https : http;
    const headers = { "User-Agent": USER_AGENT, Accept: "*/*", ...(options.headers || {}) };
    const body = options.body == null ? null : Buffer.from(options.body);
    if (body && !headers["Content-Type"] && !headers["content-type"]) headers["Content-Type"] = "application/x-www-form-urlencoded";
    if (body) headers["Content-Length"] = String(body.length);
    const req = lib.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: options.method || "GET",
      headers,
      rejectUnauthorized: rejectUnauthorized(target.hostname),
      timeout: options.timeout || 20000,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode || 0,
        headers: res.headers,
        body: Buffer.concat(chunks),
        url,
      }));
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    if (body) req.write(body);
    req.end();
  });
}

export const META_REFRESH_LIMIT = 8192;

export function metaRefreshTarget(html, limit = META_REFRESH_LIMIT) {
  const page = String(html || "");
  if (page.length > limit || /<table\b/i.test(page)) return "";
  const match = page.match(/http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'>\s]+)/i)
    || page.match(/content=["'][^"']*url=([^"'>\s]+)["'][^>]*http-equiv=["']refresh["']/i);
  if (!match) return "";
  return match[1].replace(/&amp;/gi, "&");
}

export class Client {
  constructor(cookies = [], options = {}) {
    this.jar = cookies.map((cookie) => ({ ...cookie }));
    this.auth = options.auth !== false;
    this.transport = options.transport || requestOnce;
  }

  async request(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    const cookie = cookieHeader(this.jar, url);
    if (cookie) headers.Cookie = cookie;
    const response = await this.transport(url, { ...options, headers });
    const normalized = {
      ...response,
      headers: response.headers || {},
      body: Buffer.isBuffer(response.body) ? response.body : Buffer.from(String(response.body ?? ""), "utf8"),
    };
    storeCookies(this.jar, normalized.headers["set-cookie"], url);
    const encoding = chooseEncoding(normalized.headers["content-type"], normalized.body);
    const text = new TextDecoder(encoding).decode(normalized.body);
    return { ...normalized, text };
  }

  async follow(url, options = {}) {
    let current = url;
    let method = options.method || "GET";
    let body = options.body;
    const headers = options.headers || {};
    for (let hop = 0; hop < 12; hop += 1) {
      const response = await this.request(current, { method, body, headers, timeout: options.timeout });
      const location = response.headers.location;
      if (response.status >= 300 && response.status < 400 && location) {
        current = new URL(Array.isArray(location) ? location[0] : location, current).toString();
        if (response.status !== 307 && response.status !== 308) {
          method = "GET";
          body = undefined;
        }
        continue;
      }
      if (response.body.length > 2_000_000) throw appError("upstream_unavailable", "学校返回的内容过大。");
      const refresh = metaRefreshTarget(response.text);
      if (refresh) {
        current = new URL(refresh, current).toString();
        method = "GET";
        body = undefined;
        continue;
      }
      if (this.auth && isLoginPage(current, response.text)) {
        throw appError("session_expired", "登录已过期，请重新运行 tyut auth login。");
      }
      return { ...response, url: current };
    }
    throw appError("upstream_unavailable", "学校页面跳转次数过多。");
  }
}
