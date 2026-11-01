import { appError } from "./errors.js";
import { decodeEntities, htmlRows, stripTags, textPieces } from "./html.js";

const WEEKDAY_TEXT = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7 };

const SUMMARY_LABELS = [
  ["已修自主实践学分", "practiceCredits"],
  ["已修课程学分", "completedCredits"],
  ["要求总学分", "requiredCredits"],
  ["加权学分成绩", "weightedScore"],
  ["平均成绩", "averageScore"],
  ["尚不及格学分", "outstandingFailedCredits"],
  ["曾不及格学分", "priorFailedCredits"],
  ["GPA专业排名", "gpaMajorRank"],
  ["GPA班级排名", "gpaClassRank"],
  ["平均学分绩点", "gpa"],
  ["姓名", "name"],
  ["学号", "studentId"],
  ["班级", "className"],
  ["绩点", "gpa"],
  ["GPA", "gpa"],
];

const PLAN_CATEGORIES = ["专业核心课程", "专业选修课", "学科交叉课程", "实践环节", "通识必修课", "通识选修课", "额外修读课程", "其他"];

function blankSummary() {
  return {
    requiredCredits: null,
    completedCredits: null,
    averageScore: null,
    weightedScore: null,
    gpa: null,
    gpaMajorRank: null,
    gpaClassRank: null,
    outstandingFailedCredits: null,
    priorFailedCredits: null,
    practiceCredits: null,
    name: null,
    studentId: null,
    className: null,
  };
}

function compact(value) {
  return String(value || "").replace(/\s+/g, "");
}

function isSummaryLabel(value) {
  const key = compact(value).replace(/[:：]/g, "");
  return SUMMARY_LABELS.some(([label]) => key === label);
}

function parseLabelPiece(raw) {
  const key = compact(raw);
  const normalized = key.replace(/[:\uFF1A]/g, "");
  let best = null;
  const consider = (label, field, inline) => {
    if (!best || label.length > best.length) best = { length: label.length, field, inline };
  };
  for (const [label, field] of SUMMARY_LABELS) {
    if (normalized === label) consider(label, field, null);
    else if (key.startsWith(label)) {
      const rest = key.slice(label.length).replace(/^[:\uFF1A]/, "");
      consider(label, field, rest || null);
    }
  }
  return best ? { field: best.field, inline: best.inline } : null;
}

function cleanValue(field, value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text.length > 80) return null;
  if (isSummaryLabel(text)) return null;
  if (field === "gpa" && !/^\d+(?:\.\d+)?$/.test(text)) return null;
  return text;
}

export function parseSummary(html) {
  const pieces = textPieces(html);
  const summary = blankSummary();
  for (let i = 0; i < pieces.length; i += 1) {
    const parsed = parseLabelPiece(pieces[i]);
    if (!parsed || summary[parsed.field] != null) continue;
    let value = parsed.inline;
    if (value == null && i + 1 < pieces.length && !isSummaryLabel(pieces[i + 1])) {
      value = pieces[i + 1];
      i += 1;
    }
    const cleaned = cleanValue(parsed.field, value);
    if (cleaned != null) summary[parsed.field] = cleaned;
  }
  return summary;
}

function isGradeHeader(cells) {
  const text = cells.map((cell) => cell.text).join("");
  return text.includes("课程号") && text.includes("课程名");
}

function isTermRow(cells) {
  const wide = cells.some((cell) => cell.colspan > 1);
  const filled = cells.filter((cell) => cell.text);
  return wide && filled.length <= 1;
}

export function parseGrades(html) {
  let term = "";
  const courses = [];
  for (const cells of htmlRows(html)) {
    if (isGradeHeader(cells)) continue;
    if (isTermRow(cells)) {
      term = cells.map((cell) => cell.text).filter(Boolean).join(" ");
      continue;
    }
    if (cells.length < 3) continue;
    const value = (index) => cells[index]?.text || "";
    courses.push({
      term,
      courseId: value(0),
      sequence: value(1),
      name: value(2),
      englishName: value(3),
      credits: value(4),
      attribute: value(5),
      examTime: value(6),
      score: value(7),
      failReason: value(8),
    });
  }
  return courses;
}

function matchCategory(text) {
  const key = compact(text);
  for (const name of PLAN_CATEGORIES) {
    if (name === "其他") {
      if (key === "其他") return name;
      continue;
    }
    if (key === name || key.startsWith(name)) return name;
  }
  return null;
}

function numberText(value) {
  const match = String(value || "").match(/\d+(?:\.\d+)?/);
  return match ? match[0] : null;
}

export function parsePlan(html) {
  const found = Object.fromEntries(PLAN_CATEGORIES.map((name) => [name, null]));
  const rows = htmlRows(html);
  const headerIndex = rows.findIndex((cells) => cells.some((cell) => cell.text.includes("应修学分")));
  const header = headerIndex >= 0 ? rows[headerIndex] : null;
  const column = (label, fallback) => {
    if (!header) return fallback;
    const index = header.findIndex((cell) => cell.text.includes(label));
    return index >= 0 ? index : fallback;
  };
  const requiredIndex = column("应修学分", 1);
  const completedIndex = column("已修学分", 2);
  const countIndex = column("已修门数", 3);
  const dataRows = header ? rows.slice(headerIndex + 1) : rows;
  for (const cells of dataRows) {
    const category = cells.map((cell) => matchCategory(cell.text)).find(Boolean);
    if (!category || found[category]) continue;
    found[category] = {
      name: category,
      requiredCredits: numberText(cells[requiredIndex]?.text),
      completedCredits: numberText(cells[completedIndex]?.text),
      completedCount: numberText(cells[countIndex]?.text),
    };
  }
  return {
    categories: PLAN_CATEGORIES.map((name) => found[name] || {
      name,
      requiredCredits: null,
      completedCredits: null,
      completedCount: null,
    }),
  };
}

function pick(row, ...names) {
  for (const name of names) {
    if (row[name] != null && row[name] !== "") return String(row[name]).trim();
    const hit = Object.keys(row).find((key) => key.toLowerCase() === name.toLowerCase());
    if (hit && row[hit] != null && row[hit] !== "") return String(row[hit]).trim();
  }
  return "";
}

function asNumber(value) {
  if (value == null || value === "") return null;
  const text = WEEKDAY_TEXT[value] ? String(WEEKDAY_TEXT[value]) : String(value);
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function parseSchedule(payload) {
  let data = payload;
  if (typeof payload === "string") {
    const text = payload.trim();
    const objectAt = text.indexOf("{");
    const arrayAt = text.indexOf("[");
    const start = [objectAt, arrayAt].filter((index) => index >= 0).sort((a, b) => a - b)[0];
    if (start == null) throw appError("upstream_unavailable", "课表接口没有返回可识别的数据。");
    try {
      data = JSON.parse(text.slice(start));
    } catch {
      throw appError("upstream_unavailable", "课表接口没有返回可识别的数据。");
    }
  }
  const rows = Array.isArray(data) ? data : data?.rows || data?.data || data?.list || [];
  if (!Array.isArray(rows)) throw appError("upstream_unavailable", "课表接口没有返回可识别的数据。");
  return rows.map((row) => {
    const campus = pick(row, "Xqm");
    const building = pick(row, "Jxlm");
    const room = pick(row, "Jasm");
    const location = pick(row, "Dd") || [building, room].filter(Boolean).join("");
    return {
      term: pick(row, "Zxjxjhh"),
      courseId: pick(row, "Kch"),
      sequence: pick(row, "Kxh"),
      name: pick(row, "Kcm"),
      credits: pick(row, "Xf"),
      teacher: pick(row, "Jsm"),
      location,
      campus,
      weekday: asNumber(pick(row, "Skxq")),
      startSection: asNumber(pick(row, "Skjc")),
      sectionCount: asNumber(pick(row, "Cxjc")),
      weeksText: pick(row, "Zcsm"),
      weekMask: pick(row, "Skzc"),
    };
  });
}

export function filterCourses(courses, { week = null, weekday = null } = {}) {
  return courses.filter((course) => {
    if (weekday != null && Number(course.weekday) !== Number(weekday)) return false;
    if (week != null && String(course.weekMask || "").charAt(Number(week) - 1) !== "1") return false;
    return true;
  }).sort((a, b) => (a.weekday || 0) - (b.weekday || 0) || (a.startSection || 0) - (b.startSection || 0) || a.name.localeCompare(b.name, "zh"));
}

function afterLabel(text, label) {
  const match = text.match(new RegExp("(?:^|\\s)" + label + "\\s*[:：]?\\s*([^\\s].*?)(?=\\s+(?:责任者|作者|出版社|出版信息|索书号|馆藏复本|可借复本|可借数|复本数)\\s*[:：]?|$)"));
  return match ? match[1].trim() : "";
}

function firstNumber(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function h3CallNumbers(block) {
  const numbers = [];
  const h3Re = /<h3\b[^>]*>([\s\S]*?)<\/h3>/gi;
  let h3;
  while ((h3 = h3Re.exec(block))) {
    const withoutLink = h3[1].replace(/<a\b[\s\S]*?<\/a>/gi, " ");
    const text = stripTags(withoutLink).replace(/^\d+\.\s*/, "").trim();
    if (!text || /索书号|馆藏复本|可借复本|责任者|出版社|作者/.test(text)) continue;
    numbers.push(text);
  }
  return numbers;
}

function libraryLines(block) {
  return String(block)
    .replace(/<h3\b[\s\S]*?<\/h3>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((line) => decodeEntities(line).replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function looksLikeCallNumber(line) {
  return /^[A-Za-z0-9][A-Za-z0-9./:()-]{2,}$/.test(line);
}

export function parseLibrarySearch(html) {
  const blocks = String(html || "").split(/book_list_info/i).slice(1);
  const books = [];
  for (const block of blocks) {
    const decoded = block.replace(/&amp;/gi, "&");
    const link = decoded.match(/<a\b[^>]*href=["'][^"']*marc_no=([^"'&\s]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const title = stripTags(link[2]).replace(/^\d+\.\s*/, "");
    const text = stripTags(decoded);
    const labeledCalls = [...text.matchAll(/索书号\s*[:：]?\s*([A-Za-z0-9./:()-]+)/g)].map((item) => item[1]);
    const callNumbers = [...new Set([...h3CallNumbers(decoded), ...labeledCalls])];
    const copyCount = firstNumber(text, [/馆藏复本\s*[:：]?\s*(\d+)/, /复本数\s*[:：]?\s*(\d+)/, /复本\s*[:：]?\s*(\d+)/]);
    const available = firstNumber(text, [/可借复本\s*[:：]?\s*(\d+)/, /可借数\s*[:：]?\s*(\d+)/, /可借\s*[:：]?\s*(\d+)/]);
    let writer = afterLabel(text, "责任者") || afterLabel(text, "作者");
    let publisher = afterLabel(text, "出版社") || afterLabel(text, "出版信息");
    if (!writer && !publisher) {
      const unlabeled = libraryLines(decoded).filter((line) => {
        const plain = line.replace(/^\d+\.\s*/, "");
        if (!plain || plain === title) return false;
        if (line.includes("<") || line.includes(">")) return false;
        if (/^(?:馆藏复本|可借复本|复本数|可借数|复本|可借|索书号|责任者|作者|出版社|出版信息)/.test(line)) return false;
        if (callNumbers.includes(line) || looksLikeCallNumber(line)) return false;
        return true;
      });
      writer = unlabeled[0] || "";
      publisher = unlabeled[1] || "";
    }
    books.push({
      title,
      marcNo: decodeURIComponent(link[1]),
      callNumbers,
      copies: copyCount,
      available,
      author: writer,
      publisher,
    });
  }
  return books;
}

export function parseLibraryItem(html) {
  const rows = htmlRows(html);
  const headerIndex = rows.findIndex((cells) => {
    const text = cells.map((cell) => cell.text).join("");
    return text.includes("索书号") && text.includes("条码号");
  });
  if (headerIndex < 0) return { holdings: [] };
  const header = rows[headerIndex];
  const indexOf = (label) => header.findIndex((cell) => cell.text.includes(label));
  const callIndex = indexOf("索书号");
  const barcodeIndex = indexOf("条码号");
  const locationIndex = indexOf("馆藏地");
  const statusIndex = indexOf("书刊状态");
  const holdings = [];
  for (const cells of rows.slice(headerIndex + 1)) {
    const barcode = cells[barcodeIndex]?.text || "";
    if (!barcode || barcode.includes("条码号")) continue;
    holdings.push({
      callNumber: cells[callIndex]?.text || "",
      barcode,
      location: cells[locationIndex]?.text || "",
      status: cells[statusIndex]?.text || "",
    });
  }
  return { holdings };
}

export function parseApps(payload) {
  let data = payload;
  if (typeof payload === "string") {
    try {
      data = JSON.parse(payload);
    } catch {
      throw appError("upstream_unavailable", "应用列表没有返回可识别的数据。");
    }
  }
  const rows = Array.isArray(data) ? data : data?.rows || data?.data || data?.list || [];
  if (!Array.isArray(rows)) throw appError("upstream_unavailable", "应用列表没有返回可识别的数据。");
  return rows.map((item) => ({
    name: String(item.APP_NAME || item.name || "").trim(),
    url: String(item.URL || item.url || "").trim(),
    ssoType: String(item.SSO_TYPE || item.ssoType || "").trim(),
  })).filter((item) => item.name);
}