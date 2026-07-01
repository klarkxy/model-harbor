// 将 repository 返回的 Date 对象递归转换为 ISO 字符串，以匹配 contracts 中的 z.string().datetime() 类型。
export function serializeForContract<T>(value: T): T {
  if (value instanceof Date) {
    return value.toISOString() as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeForContract(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = serializeForContract(val);
    }
    return result as unknown as T;
  }
  return value;
}
