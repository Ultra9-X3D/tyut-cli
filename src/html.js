function numericEntity(code, original) {
  if (!Number.isInteger(code) || code < 0 || code > 0x10FFFF) return original;
  return String.fromCodePoint(code);
}

export function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (original, hex) => numericEntity(parseInt(hex, 16), original))
    .replace(/&#(\d+);/g, (original, num) => numericEntity(Number(num), original));
}

export function stripTags(html) {
  return decodeEntities(String(html || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function htmlRows(html) {
  const rows = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowRe.exec(html))) {
    const cells = [];
    const cellRe = /<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
    let cell;
    while ((cell = cellRe.exec(row[1]))) {
      const colspan = /colspan\s*=\s*["']?(\d+)/i.exec(cell[1]);
      cells.push({
        text: stripTags(cell[2]),
        colspan: colspan ? Number(colspan[1]) : 1,
      });
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

export function textPieces(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((piece) => decodeEntities(piece).replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function hiddenValue(html, name) {
  const quoted = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const byName = new RegExp("name=[\"']" + quoted + "[\"'][^>]*value=[\"']([^\"']*)", "i");
  const byValue = new RegExp("value=[\"']([^\"']*)[\"'][^>]*name=[\"']" + quoted + "[\"']", "i");
  return (String(html || "").match(byName) || String(html || "").match(byValue) || [])[1] || "";
}

export function parseCasForm(html, pageUrl) {
  const action = (String(html || "").match(/<form[^>]*action=["']([^"']+)/i) || [])[1] || "";
  const lt = hiddenValue(html, "lt");
  const execution = hiddenValue(html, "execution") || "e1s1";
  if (!action || !lt) return null;
  return { action: new URL(action, pageUrl).toString(), lt, execution };
}

export function isLoginPage(url, html) {
  const target = String(url || "");
  const page = String(html || "");
  if (/\/tpass\/login/i.test(target) && /name=["']lt["']/i.test(page)) return true;
  if (/id=["']loginForm["']/i.test(page) && /name=["']lt["']/i.test(page)) return true;
  if (/用户登录/.test(page) && /验证码/.test(page) && /密\s*码/.test(page)) return true;
  return false;
}

export function parseCurrentWeek(html) {
  const page = String(html || "");
  const patterns = [
    /id=["']currentZc["'][^>]*value=["'](\d{1,2})/i,
    /value=["'](\d{1,2})["'][^>]*id=["']currentZc["']/i,
    /name=["']currentZc["'][^>]*value=["'](\d{1,2})/i,
    /currentZc["']?\s*[:=]\s*["']?(\d{1,2})/i,
    /(?:dqzc|currentWeek)["']?\s*[:=]\s*["']?(\d{1,2})/i,
  ];
  for (const pattern of patterns) {
    const match = page.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}