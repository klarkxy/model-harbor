/**
 * 解析 HTTP `Retry-After` 头，返回毫秒数。
 *
 * 支持两种格式：
 * - 秒数整数/小数（如 "120"）
 * - HTTP-date（如 "Wed, 21 Oct 2025 07:28:00 GMT"）
 *
 * 解析失败返回 undefined。
 */
export function parseRetryAfterHeader(value: string | undefined, now = new Date()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;

  // 1. 尝试解析为秒数
  const seconds = Number(trimmed);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }

  // 2. 尝试解析为 HTTP-date
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) {
    const deltaMs = date - now.getTime();
    return deltaMs > 0 ? deltaMs : 0;
  }

  return undefined;
}
