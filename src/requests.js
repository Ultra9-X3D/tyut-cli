export const URLS = {
  casLogin: "https://cas.tyut.edu.cn/tpass/login?service=https%3A%2F%2Fone.tyut.edu.cn%2Ftp_up%2F",
  casProbe: "https://cas.tyut.edu.cn/tpass/login",
  academicEntry: "http://192.168.200.7/login/NeuSoftCas",
  academicProbe: "http://192.168.200.7/",
  scheduleIndex: "http://192.168.200.7/Tresources/A1Xskb/XsKbIndex",
  schedule: "http://192.168.200.7/Tresources/A1Xskb/GetXsKb",
  grades: "http://192.168.200.7/Tschedule/C6Cjgl/GetKccjResult",
  summary: "http://192.168.200.7/Tschedule/C6Cjgl/GetXskccjResult",
  plan: "http://192.168.200.7/Tschedule/C6Cjgl/GetFakcResult",
  apps: "https://one.tyut.edu.cn/tp_up/up/appstore/applist/getBusinessAppsList",
  librarySearch: "http://202.207.250.5/opac/openlink.php",
  libraryItem: "http://202.207.250.5/opac/item.php",
  libraryProbe: "http://202.207.250.5/opac/openlink.php",
};

export const RELAXED_TLS_HOSTS = new Set(["cas.tyut.edu.cn", "one.tyut.edu.cn"]);

export function rejectUnauthorized(hostname) {
  return !RELAXED_TLS_HOSTS.has(hostname);
}

export function buildScheduleBody() {
  const body = new URLSearchParams();
  body.set("pagination[conditionJson]", JSON.stringify({ zxjxjhh: "", isshowllkb: "1", isshowsykb: "" }));
  body.set("pagination[sort]", "kch,kxh,skzc desc,skxq,skjc");
  body.set("pagination[order]", "desc");
  return body.toString();
}

export function buildGradeBody() {
  return new URLSearchParams({ order: "zxjxjhh desc,kch" }).toString();
}

export function buildPlanBody() {
  return "";
}

export function buildAppsBody() {
  return JSON.stringify({ TYPE: "1", name: "", app_english_name: "", categorys: "" });
}

export function buildLibrarySearchUrl(query, page = 1) {
  const url = new URL(URLS.librarySearch);
  url.searchParams.set("strSearchType", "title");
  url.searchParams.set("strText", query);
  url.searchParams.set("match_flag", "forward");
  url.searchParams.set("displaypg", "20");
  url.searchParams.set("page", String(page || 1));
  return url.toString();
}

export function buildLibraryItemUrl(marcNo) {
  const url = new URL(URLS.libraryItem);
  url.searchParams.set("marc_no", marcNo);
  return url.toString();
}