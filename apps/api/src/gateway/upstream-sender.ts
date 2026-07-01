import { ProviderTimeoutError } from '@manageyourllm/shared';
import type { ProviderHttpRequest } from './providers/adapter.js';

export interface UpstreamSenderDeps {
  fetch?: typeof fetch;
}

export interface UpstreamResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  latencyMs: number;
}

export interface UpstreamStreamSuccessResponse {
  ok: true;
  status: number;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array>;
}

export interface UpstreamStreamErrorResponse {
  ok: false;
  status: number;
  body: unknown;
}

export class UpstreamSender {
  constructor(private readonly deps: UpstreamSenderDeps = {}) {}

  async send(request: ProviderHttpRequest & { timeoutMs: number }): Promise<UpstreamResponse> {
    const fetchFn = this.deps.fetch ?? globalThis.fetch;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), request.timeoutMs);
    const startedAt = performance.now();

    try {
      const res = await fetchFn(request.url, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: controller.signal,
      });
      const latencyMs = Math.round(performance.now() - startedAt);
      clearTimeout(timeoutId);

      const text = await res.text();
      let body: unknown = null;
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }

      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return { status: res.status, headers, body, latencyMs };
    } catch (err) {
      clearTimeout(timeoutId);
      const latencyMs = Math.round(performance.now() - startedAt);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ProviderTimeoutError('上游请求超时', {
          url: request.url,
          timeoutMs: request.timeoutMs,
          latencyMs,
        });
      }
      throw new ProviderTimeoutError(
        `上游请求失败: ${err instanceof Error ? err.message : String(err)}`,
        {
          url: request.url,
          latencyMs,
        },
      );
    }
  }

  async sendStream(
    request: ProviderHttpRequest & { timeoutMs: number; firstTokenTimeoutMs?: number },
  ): Promise<UpstreamStreamSuccessResponse | UpstreamStreamErrorResponse> {
    const fetchFn = this.deps.fetch ?? globalThis.fetch;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), request.timeoutMs);

    try {
      const res = await fetchFn(request.url, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key] = value;
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        let body: unknown = null;
        if (text.length > 0) {
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
        }
        return { ok: false, status: res.status, body };
      }

      const body = this.applyFirstTokenTimeout(res.body, controller, request.firstTokenTimeoutMs);
      return { ok: true, status: res.status, headers, body };
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ProviderTimeoutError('上游流式请求超时', {
          url: request.url,
          timeoutMs: request.timeoutMs,
        });
      }
      throw new ProviderTimeoutError(
        `上游流式请求失败: ${err instanceof Error ? err.message : String(err)}`,
        { url: request.url },
      );
    }
  }

  private applyFirstTokenTimeout(
    source: ReadableStream<Uint8Array>,
    controller: AbortController,
    firstTokenTimeoutMs: number | undefined,
  ): ReadableStream<Uint8Array> {
    if (!firstTokenTimeoutMs) return source;

    let firstTokenTimer: ReturnType<typeof setTimeout> | undefined;

    return source.pipeThrough(
      new TransformStream({
        start() {
          firstTokenTimer = setTimeout(() => controller.abort(), firstTokenTimeoutMs);
        },
        transform(chunk, ctl) {
          if (firstTokenTimer) {
            clearTimeout(firstTokenTimer);
            firstTokenTimer = undefined;
          }
          ctl.enqueue(chunk);
        },
        flush() {
          if (firstTokenTimer) {
            clearTimeout(firstTokenTimer);
            firstTokenTimer = undefined;
          }
        },
      }),
    );
  }
}
