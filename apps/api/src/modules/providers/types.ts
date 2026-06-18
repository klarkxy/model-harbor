import type {
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  ChatRequestIR,
  NormalizedChatResponse,
  OpenAIChatCompletionsRequest,
  OpenAIChatCompletionsResponse,
  ProviderCapabilities,
  ProviderType,
} from '@modelharbor/shared';

// HTTP request the adapter asks the engine to send to the upstream.
export interface ProviderHttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string; // JSON-encoded
}

// Raw HTTP response from the upstream.
export interface ProviderHttpResponse {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  // bodyJson is set when the response looks like JSON and was parsed successfully.
  bodyJson: unknown;
}

export interface ProviderRequestContext {
  // The IR produced by the gateway after candidate resolution. The adapter never
  // sees the client wire-format request; only the IR + the resolved real model
  // name and the upstream key.
  ir: ChatRequestIR;
  // The real model name to send upstream (e.g. upstream returns "claude-3-5-sonnet-20240620"
  // for the client's "claude-3-5-sonnet").
  realModelName: string;
  // Identifier of the upstream key (for logging / tracing).
  upstreamKeyId: string;
  // Per-request timeout in ms.
  timeoutMs: number;
  // Whether the gateway wants SSE.
  stream: boolean;
  // The base URL of the upstream key (e.g. "https://api.anthropic.com").
  // The adapter concatenates this with its protocol path (e.g. "/v1/messages")
  // to produce the final URL in `buildRequest`.
  baseUrl: string;
  // Optional full request path override. When set, the adapter uses this path
  // directly instead of the default protocol path.
  apiPath?: string;
  // The decrypted upstream API key. The adapter puts it on the request
  // (x-api-key for Anthropic, Authorization: Bearer for OpenAI). The engine
  // (M4 sender) is responsible for decrypting the upstream key and passing
  // it in here, and for not logging the resulting `buildRequest` output.
  apiKey: string;
}

export interface ProviderResponseContext {
  // The raw HTTP response from the upstream.
  response: ProviderHttpResponse;
  // Same context as for request building, useful for error normalization.
  request: ProviderRequestContext;
}

export interface ProviderStreamEventContext {
  // One SSE event: `event:` line value (or null for plain `data:` SSE) and the
  // raw `data:` payload text.
  event: string | null;
  data: string;
  request: ProviderRequestContext;
}

export interface ProviderErrorContext {
  // Either the upstream returned a non-2xx response (response is set) or the
  // request never reached the upstream (response is undefined, error is the
  // transport error).
  response: ProviderHttpResponse | undefined;
  request: ProviderRequestContext;
  transportError: unknown;
}

// Stream events are intentionally loose for M3 (streaming is M5). The shape is
// defined here so the adapter contract is complete; M5 will fill it in.
export type ProviderStreamEventResult =
  | { kind: 'open' }
  | { kind: 'delta'; text: string }
  | { kind: 'usage'; inputTokens: number; outputTokens: number; totalTokens: number }
  | { kind: 'stop'; reason: string | null }
  | { kind: 'ignored' };

// The adapter contract. Each provider type implements this.
export interface ProviderAdapter {
  readonly type: ProviderType;
  readonly capabilities: ProviderCapabilities;

  // Convert the IR + real model name into a wire-format HTTP request body.
  buildRequest(context: ProviderRequestContext): ProviderHttpRequest;

  // Non-streaming response: parse the upstream body and return a NormalizedChatResponse.
  normalizeResponse(context: ProviderResponseContext): NormalizedChatResponse;

  // Streaming: parse one SSE event. M3 returns { kind: "ignored" } for everything;
  // M5 will fill this in.
  normalizeStreamEvent(context: ProviderStreamEventContext): ProviderStreamEventResult;

  // Normalize any error (HTTP error body or transport error) into a
  // NormalizedProviderError. The engine then maps it to a status code.
  normalizeError(context: ProviderErrorContext): NormalizedProviderError;

  // Extract usage from a successful non-streaming response body, returning
  // null when the provider doesn't include usage in the body.
  extractUsage(context: ProviderResponseContext): NormalizedChatResponse['usage'];
}

// Categorized error returned by `normalizeError`. The engine maps each
// category to a final HTTP status; the exact provider-specific error text is
// preserved for debuggability but never leaked to the public.
export interface NormalizedProviderError {
  category:
    | 'provider_authentication'
    | 'provider_permission'
    | 'provider_rate_limit'
    | 'provider_quota'
    | 'provider_timeout'
    | 'provider_overloaded'
    | 'provider_model_not_found'
    | 'provider_bad_request'
    | 'provider_stream_error'
    | 'provider_unknown';
  // Provider's own error message (e.g. "Invalid API key"). Useful for audit
  // logs; the engine should NOT echo this to the client (it may carry
  // sensitive details).
  providerMessage: string | null;
  // Provider error type/code (e.g. "rate_limit_error", "tokens", 429).
  providerCode: string | null;
  // HTTP status from the upstream (if a response was received). 0 when the
  // request never reached the upstream.
  upstreamStatus: number;
}

// Convenience re-exports for adapter implementers.
export type { ChatRequestIR, NormalizedChatResponse, ProviderCapabilities, ProviderType };
export type AnthropicRequestShape = AnthropicMessagesRequest;
export type AnthropicResponseShape = AnthropicMessagesResponse;
export type OpenAIRequestShape = OpenAIChatCompletionsRequest;
export type OpenAIResponseShape = OpenAIChatCompletionsResponse;
