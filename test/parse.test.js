import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { decodeEntities, parseCasForm, parseCurrentWeek } from "../src/html.js";
import { formatText } from "../src/format.js";
import { parseApps, parseGrades, parseLibraryItem, parseLibrarySearch, parsePlan, parseSchedule, parseSummary, filterCourses } from "../src/parse.js";
import { occursInWeek, shanghaiWeekday } from "../src/time.js";

const fixture = (name) => fs.readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

test("decodes hexadecimal entities after amp", () => {
  assert.equal(decodeEntities("&amp;#x793a;"), "示");
  assert.equal(decodeEntities("&#x6570;&#x636E;&#x7ED3;&#x6784;"), "数据结构");
});

test("extracts the CAS login fields", () => {
  const form = parseCasForm(fixture("cas-form.html"), "https://cas.tyut.edu.cn/tpass/login?service=demo");
  assert.equal(form.action, "https://cas.tyut.edu.cn/tpass/login");
  assert.equal(form.lt, "LT-sample-token");
  assert.equal(form.execution, "e1s1");
  assert.equal(parseCasForm("<form action='/tpass/login'></form>", "https://cas.tyut.edu.cn/"), null);
});

test("reads the current week", () => {
  assert.equal(parseCurrentWeek(fixture("current-week.html")), 12);
  assert.equal(parseCurrentWeek("<html>no week</html>"), null);
});

test("parses the schedule, 24-bit week mask, and Shanghai Monday", () => {
  const courses = parseSchedule(fixture("schedule.json"));
  assert.equal(courses.length, 3);
  for (const course of courses) assert.equal(course.weekMask.length, 24);
  const monday = courses.find((course) => course.courseId === "CS101");
  assert.equal(monday.weekday, 1);
  assert.equal(monday.startSection, 3);
  assert.equal(monday.sectionCount, 2);
  assert.equal(monday.location, "示例楼101");
  assert.equal(monday.weeksText, "1-16周");
  assert.equal(occursInWeek(monday.weekMask, 1), true);
  assert.equal(occursInWeek(monday.weekMask, 16), true);
  assert.equal(occursInWeek(monday.weekMask, 17), false);
  assert.equal(monday.weekMask.charAt(0), "1");

  const weekday = shanghaiWeekday(new Date("2026-11-02T00:30:00+08:00"));
  assert.equal(weekday, 1);
  assert.equal(shanghaiWeekday(new Date("2026-11-01T16:30:00Z")), 1);
  assert.equal(shanghaiWeekday(new Date("2026-11-01T12:00:00+08:00")), 7);

  const today = filterCourses(courses, { week: 1, weekday });
  assert.deepEqual(today.map((course) => course.courseId), ["CS101"]);
  assert.deepEqual(filterCourses(courses, { week: 2 }).map((course) => course.courseId), ["CS101", "CS102"]);
  assert.deepEqual(filterCourses(courses, { week: 20, weekday: 1 }).map((course) => course.courseId), ["CS199"]);
  assert.equal(filterCourses(courses, { week: 1, weekday: 7 }).length, 0);

  const text = formatText("course.today", { week: 1, weekday, courses: today });
  assert.match(text, /第 1 周 {2}星期一/);
  assert.match(text, /3-4节/);
  assert.match(text, /示例课程/);
  assert.doesNotMatch(text, /周二示例|后周示例/);
});

test("parses grade rows with the tyle typo and groups terms", () => {
  const courses = parseGrades(fixture("grades.html"));
  assert.deepEqual(courses.map((course) => course.term), ["2025-2026-1", "2025-2026-2"]);
  assert.equal(courses[0].courseId, "CS101");
  assert.equal(courses[0].englishName, "Sample Course");
  assert.equal(courses[0].score, "90");
  assert.equal(courses[0].failReason, "");
  assert.equal(courses[1].score, "不及格");
  assert.equal(courses[1].failReason, "缺考");
  const text = formatText("grade.list", { courses });
  assert.match(text, /2025-2026-1\nCS101 {2}示例课程 {2}3学分 {2}90\n2025-2026-2\nCS102 {2}另一示例 {2}2学分 {2}不及格 {2}缺考/);
});

test("keeps GPA empty unless the page gives a numeric value", () => {
  const missing = parseSummary(fixture("summary-no-gpa.html"));
  assert.equal(missing.gpa, null);
  assert.equal(missing.averageScore, "88");
  assert.equal(missing.weightedScore, "86.5");
  assert.equal(missing.requiredCredits, "160");
  assert.equal(missing.completedCredits, "32.5");
  assert.equal(missing.gpaMajorRank, "2/20");
  assert.equal(missing.gpaClassRank, "1/30");
  assert.equal(missing.outstandingFailedCredits, "0");
  assert.equal(missing.priorFailedCredits, "2");
  assert.equal(missing.practiceCredits, "1.5");
  assert.equal(missing.name, "示例同学");
  assert.equal(missing.studentId, "1000000001");
  assert.equal(missing.className, "示例班");
  assert.match(formatText("grade.summary", missing), /GPA {2}—/);
  assert.doesNotMatch(formatText("grade.summary", missing), /GPA {2}88|GPA {2}86\.5/);

  const present = parseSummary(fixture("summary-gpa.html"));
  assert.equal(present.gpa, "3.72");
  assert.equal(present.averageScore, "88");
  assert.equal(present.gpaMajorRank, "2/20");
  assert.match(formatText("grade.summary", present), /GPA {2}3\.72/);
});

test("parses plan categories without treating a lookalike row as 其他", () => {
  const plan = parsePlan(fixture("plan.html"));
  const byName = Object.fromEntries(plan.categories.map((item) => [item.name, item]));
  assert.deepEqual(plan.categories.map((item) => item.name), ["专业核心课程", "专业选修课", "学科交叉课程", "实践环节", "通识必修课", "通识选修课", "额外修读课程", "其他"]);
  assert.deepEqual(byName["专业核心课程"], { name: "专业核心课程", requiredCredits: "40", completedCredits: "12", completedCount: "4" });
  assert.deepEqual(byName["学科交叉课程"], { name: "学科交叉课程", requiredCredits: null, completedCredits: null, completedCount: null });
  assert.deepEqual(byName["其他"], { name: "其他", requiredCredits: null, completedCredits: null, completedCount: null });
});

test("parses library search entities and item status", () => {
  const books = parseLibrarySearch(fixture("library-search.html"));
  assert.equal(books.length, 2);
  assert.deepEqual(books[0], {
    title: "数据结构",
    marcNo: "0000123456",
    callNumbers: ["TP311.12/0167/(T3S)"],
    copies: 3,
    available: 1,
    author: "示例作者",
    publisher: "示例出版社",
  });
  assert.equal(books[1].title, "算法导论");
  assert.equal(books[1].marcNo, "ABC987");
  assert.deepEqual(books[1].callNumbers, ["TP301.6/1"]);
  assert.equal(books[1].copies, 4);
  assert.equal(books[1].available, 0);
  assert.equal(books[1].author, "另例作者");
  assert.equal(books[1].publisher, "另例出版社");

  const item = parseLibraryItem(fixture("library-item.html"));
  assert.deepEqual(item.holdings, [
    { callNumber: "TP311.12/0167/(T3S)", barcode: "T00010001", location: "明向书库", status: "可借" },
    { callNumber: "TP311.12/0167/(T3S)", barcode: "T00010002", location: "迎西书库", status: "借出" },
  ]);
});

test("parses business apps down to name, url, and SSO type", () => {
  const apps = parseApps(JSON.stringify({ rows: [
    { APP_NAME: "课表示例", URL: "http://192.168.200.7/login/NeuSoftCas", SSO_TYPE: "cas" },
    { name: "", url: "http://example.invalid" },
  ] }));
  assert.deepEqual(apps, [{ name: "课表示例", url: "http://192.168.200.7/login/NeuSoftCas", ssoType: "cas" }]);
});