import { NormalizedError } from '@manageyourllm/shared';

export interface ApiError {
  error: {
    message: string;
    type: string;
    code: string;
  };
}

export interface ApiResult<T> {
  data: T;
}

export class ApiClientError extends NormalizedError {
  readonly status: number;

  constructor(status: number, body: ApiError) {
    super(body.error.code, body.error.message, { type: body.error.type });
    this.name = 'ApiClientError';
    this.status = status;
  }
}

function isApiErrorShape(value: unknown): value is ApiError {
  if (!value || typeof value !== 'object') return false;
  const err = (value as { error?: unknown }).error;
  if (!err || typeof err !== 'object') return false;
  const e = err as { message?: unknown; type?: unknown; code?: unknown };
  return typeof e.message === 'string' && typeof e.type === 'string' && typeof e.code === 'string';
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}...`;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const contentType = res.headers.get('content-type') ?? '';
  const isJson = contentType.toLowerCase().includes('application/json');
  let parsed: unknown = undefined;
  if (isJson && text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }
  if (!res.ok) {
    const err: ApiError = isApiErrorShape(parsed)
      ? parsed
      : {
          error: {
            message: text ? truncate(text, 500) : `HTTP ${res.status}`,
            type: 'http_error',
            code: 'http_error',
          },
        };
    throw new ApiClientError(res.status, err);
  }
  return (parsed as T) ?? (undefined as T);
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  delete: <T>(url: string) => request<T>('DELETE', url),
};
