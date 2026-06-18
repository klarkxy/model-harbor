import type { ProviderHttpRequest, ProviderHttpResponse } from '../providers/types.js';

export interface SendOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface SendOutcome {
  response?: ProviderHttpResponse;
  transportError?: { name: string; message: string; code?: string };
}

// Send an HTTP request to the upstream provider. Uses the platform fetch (Node
// 20+ / undici) with an AbortController for the timeout. Returns either a
// response or a transport error — never throws. The caller decides how to
// classify transport errors via the adapter's normalizeError.
export async function sendUpstreamRequest(
  req: ProviderHttpRequest,
  options: SendOptions,
): Promise<SendOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, options.timeoutMs));
  const onParentAbort = (): void => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', onParentAbort);
  }
  try {
    console.error(`[modelharbor upstream] --> ${req.method} ${req.url}`);
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: controller.signal,
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const bodyText = await res.text();
    const bodyJson = tryParseJson(bodyText);
    const bodyPreview = bodyText.slice(0, 500);
    console.error(`[modelharbor upstream] <-- ${res.status} ${req.url} body=${bodyPreview}`);
    return {
      response: {
        status: res.status,
        headers,
        bodyText,
        bodyJson,
      },
    };
  } catch (err) {
    const e = err as { name?: string; message?: string; cause?: { code?: string } };
    const name = e.name === 'AbortError' ? 'timeout' : (e.name ?? 'error');
    const code = e.cause?.code ?? (e.name === 'AbortError' ? 'ETIMEDOUT' : undefined);
    const transportError = {
      name,
      message: e.message ?? String(err),
      ...(code !== undefined ? { code } : {}),
    };
    console.error(`[modelharbor upstream] <-- transport error ${req.url}`, transportError);
    return {
      transportError,
    };
  } finally {
    clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener('abort', onParentAbort);
  }
}

function tryParseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
