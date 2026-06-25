const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

const SENSITIVE_KEY_NAMES = new Set([
  'authorization',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'auth-token',
  'x-apikey',
  'apikey',
]);

const SENSITIVE_PATTERNS: RegExp[] = [
  /\bck_[A-Za-z0-9_-]+\b/g,
  /\bmh_[A-Za-z0-9_-]+\b/g,
  /\bsk-[A-Za-z0-9]+\b/g,
  /Bearer\s+\S+/gi,
];

function byteLength(value: string): number {
  return encoder.encode(value).length;
}

function truncateString(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value;
  const ellipsis = '…';
  const ellipsisBytes = byteLength(ellipsis);
  if (maxBytes <= ellipsisBytes) return ellipsis;
  const bytes = encoder.encode(value);
  const slice = bytes.slice(0, maxBytes - ellipsisBytes);
  return `${decoder.decode(slice)}${ellipsis}`;
}

function redactString(value: string): string {
  let result = value;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function redactValue(value: unknown, maxBytes: number): unknown {
  if (typeof value === 'string') {
    return truncateString(redactString(value), maxBytes);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, maxBytes));
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEY_NAMES.has(lowerKey) && typeof val === 'string') {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactValue(val, maxBytes);
      }
    }
    return result;
  }
  return value;
}

export function redactAndTruncate(payload: unknown, maxBytes: number): unknown {
  if (maxBytes <= 0) return null;
  if (typeof payload === 'string') {
    return truncateString(redactString(payload), maxBytes);
  }
  const safe = redactValue(payload, maxBytes);
  const serialized = JSON.stringify(safe);
  if (byteLength(serialized) <= maxBytes) return safe;
  return {
    _truncated: true,
    preview: truncateString(serialized, maxBytes),
  };
}
