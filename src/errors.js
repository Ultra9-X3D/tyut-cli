export const ERROR_CODES = [
  "campus_network_required",
  "login_required",
  "session_expired",
  "upstream_unavailable",
  "not_supported",
];

export class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

export function appError(code, message) {
  return new AppError(code, message);
}

export function toAppError(err) {
  if (err instanceof AppError) return err;
  const code = err?.code || err?.cause?.code || "";
  const network = ["ENOTFOUND", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"].includes(code)
    || /timeout|network|fetch failed|ECONN/i.test(String(err?.message || err));
  if (network) return new AppError("upstream_unavailable", "学校服务暂时无法连接。");
  return new AppError("upstream_unavailable", "学校服务暂时无法使用。");
}

export function networkError(err, kind) {
  const code = err?.code || err?.cause?.code || "";
  const network = ["ENOTFOUND", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"].includes(code)
    || /timeout|network|fetch failed|certificate|UNABLE_TO_VERIFY/i.test(String(err?.message || err));
  if (network && (kind === "academic" || kind === "library")) {
    return new AppError("campus_network_required", "当前网络访问不了校园网服务，请连接校园网后重试。");
  }
  if (network && kind === "cas") {
    return new AppError("upstream_unavailable", "统一认证暂时无法连接。");
  }
  return new AppError("upstream_unavailable", "学校服务暂时无法使用。");
}