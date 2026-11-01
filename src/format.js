const WEEKDAY_NAMES = ["", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];

function line(label, value) {
  return `${label}  ${value == null || value === "" ? "—" : value}`;
}

export function formatText(command, data) {
  if (command === "doctor") {
    return [
      `Node.js  ${data.nodeVersion}  ${data.nodeOk ? "通过" : "需要 20 或更高版本"}`,
      `会话  ${data.sessionExists ? "已保存" : "未登录"}`,
      ...data.endpoints.map((item) => `${item.label}  ${item.ok ? "可访问" : "不可访问"}`),
    ].join("\n");
  }
  if (command === "auth.login") return "已登录。密码没有保存。";
  if (command === "auth.status") return data.loggedIn ? "已登录。" : "未登录。";
  if (command === "auth.logout") return "已退出，本机登录状态已删除。";
  if (command === "course.today") {
    const head = `第 ${data.week} 周  ${WEEKDAY_NAMES[data.weekday] || ""}`;
    if (!data.courses.length) return `${head}\n今天没有课。`;
    return [head, ...data.courses.map(formatCourse)].join("\n");
  }
  if (command === "course.list") {
    const head = data.filterWeek ? `第 ${data.filterWeek} 周课表` : "本学期课表";
    if (!data.courses.length) return `${head}\n没有课程。`;
    return [head, ...data.courses.map(formatCourse)].join("\n");
  }
  if (command === "grade.list") {
    if (!data.courses.length) return "没有课程成绩。";
    let term = null;
    const lines = [];
    for (const course of data.courses) {
      if (course.term !== term) {
        term = course.term;
        lines.push(term || "未分组");
      }
      lines.push(`${course.courseId}  ${course.name}  ${course.credits}学分  ${course.score}${course.failReason ? `  ${course.failReason}` : ""}`);
    }
    return lines.join("\n");
  }
  if (command === "grade.summary") {
    return [
      line("姓名", data.name),
      line("学号", data.studentId),
      line("班级", data.className),
      line("要求总学分", data.requiredCredits),
      line("已修课程学分", data.completedCredits),
      line("平均成绩", data.averageScore),
      line("加权学分成绩", data.weightedScore),
      line("GPA", data.gpa),
      line("GPA专业排名", data.gpaMajorRank),
      line("GPA班级排名", data.gpaClassRank),
      line("尚不及格学分", data.outstandingFailedCredits),
      line("曾不及格学分", data.priorFailedCredits),
      line("已修自主实践学分", data.practiceCredits),
    ].join("\n");
  }
  if (command === "plan.status") {
    return data.categories.map((item) => `${item.name}  应修 ${item.requiredCredits ?? "—"}  已修 ${item.completedCredits ?? "—"}  ${item.completedCount ?? "—"}门`).join("\n");
  }
  if (command === "library.search") {
    if (!data.books.length) return "没有找到馆藏。";
    return data.books.map((book) => [
      book.title,
      `  ${book.author || "责任者未知"}  ${book.publisher || ""}`,
      `  索书号 ${book.callNumbers.join("，") || "—"}  复本 ${book.copies ?? "—"}  可借 ${book.available ?? "—"}`,
      `  marc ${book.marcNo}`,
    ].join("\n")).join("\n");
  }
  if (command === "library.item") {
    if (!data.holdings.length) return "没有馆藏副本。";
    return data.holdings.map((item) => `${item.callNumber}  ${item.barcode}  ${item.location}  ${item.status}`).join("\n");
  }
  if (command === "apps") {
    if (!data.apps.length) return "没有业务应用。";
    return data.apps.map((app) => `${app.name}\n  ${app.url}\n  单点类型 ${app.ssoType || "—"}`).join("\n");
  }
  return JSON.stringify(data, null, 2);
}

function formatCourse(course) {
  const span = course.sectionCount > 1 && course.startSection ? `${course.startSection}-${course.startSection + course.sectionCount - 1}节` : `${course.startSection || "?"}节`;
  return `${WEEKDAY_NAMES[course.weekday] || "时间未定"}  ${span}  ${course.name}  ${course.location || course.campus || "地点未定"}  ${course.teacher || ""}  ${course.weeksText || ""}`.replace(/\s+/g, " ").trim();
}