import type { SourceProtocol } from './protocols.js';

// --- Internal Request Representation ---
//
// The internal request shape is what the router core reasons about. Client
// adapters convert wire-format requests (Anthropic Messages, OpenAI Chat
// Completions, …) into this shape; provider adapters convert it back to their
// upstream wire format. Keeping the IR protocol-neutral means the router
// engine does not need to know which provider it is talking to.

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatMessageIR {
  role: ChatRole;
  // M3 keeps content as a plain string. The type is left open so M7+ can
  // introduce a `ContentPart[]` without breaking the wire.
  content: string;
  // Optional tool call / tool result id, only used by the `tool` role.
  toolCallId?: string;
}

export interface ChatRequestIR {
  sourceProtocol: SourceProtocol;
  // The model name as the client requested it (e.g. "claude-3-5-sonnet" or
  // "gpt-4o-mini"). The router resolves this to a candidate and passes the
  // real model name to the upstream via the provider adapter.
  requestedModel: string;
  system: string | null;
  messages: ChatMessageIR[];
  maxTokens: number | null;
  temperature: number | null;
  topP: number | null;
  stream: boolean;
  // Generic metadata for the upstream (Anthropic `metadata.user_id` etc.).
  metadata: Record<string, string>;
  // The original wire-format request, kept for debugging and audit.
  rawRequest: unknown;
}

// --- Internal Response Representation ---

export interface ChatUsageIR {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface NormalizedChatResponse {
  id: string;
  model: string;
  // The assistant message text. M3 keeps it as a plain string.
  content: string;
  // Normalized stop reason: "end_turn" / "stop" / "length" / "tool_use" / etc.
  // Adapters are responsible for mapping provider-specific values.
  stopReason: string | null;
  usage: ChatUsageIR | null;
  // The original provider response, kept for audit / passthrough.
  rawResponse: unknown;
}

// --- External (wire-format) request shapes ---
//
// These are the shapes adapters need to convert FROM (when receiving a client
// request) or convert INTO (when sending to upstream). They mirror the public
// Anthropic and OpenAI APIs; M3 only consumes the text-message fields and
// ignores tools/tool_choice/structured-output/etc. for now.

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result' | string;
  text?: string;
  // tool_use / tool_result / image have additional fields; left loose for M3.
  [key: string]: unknown;
}

export interface AnthropicMessagesRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | AnthropicContentBlock[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  metadata?: { user_id?: string; [k: string]: unknown };
  tools?: unknown;
  tool_choice?: unknown;
  [key: string]: unknown;
}

export interface AnthropicMessagesResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  [key: string]: unknown;
}

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'function';
  // For tool/function messages, OpenAI uses `content` to carry the result text.
  content?: string | null;
  // For assistant messages, tool calls may be present.
  tool_calls?: unknown;
  // For tool messages, the id of the call this is responding to.
  tool_call_id?: string;
  name?: string;
  [key: string]: unknown;
}

export interface OpenAIChatCompletionsRequest {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  n?: number;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  user?: string;
  tools?: unknown;
  tool_choice?: unknown;
  response_format?: unknown;
  [key: string]: unknown;
}

export interface OpenAIChatChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string | null;
    refusal?: string | null;
  };
  finish_reason:
    | 'stop'
    | 'length'
    | 'tool_calls'
    | 'content_filter'
    | 'function_call'
    | string
    | null;
  logprobs?: unknown;
}

export interface OpenAIChatCompletionsResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: OpenAIChatChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  system_fingerprint?: string;
  [key: string]: unknown;
}

// OpenAI Responses API (used by Codex and newer OpenAI models).

export interface OpenAIResponsesInputItem {
  type?: 'message' | 'function_call' | 'function_call_output' | string;
  role?: 'user' | 'assistant' | 'system' | 'developer' | 'tool' | string;
  content?: string | unknown;
  call_id?: string;
  [key: string]: unknown;
}

export interface OpenAIResponsesContentPart {
  type: 'text' | 'input_text' | 'output_text';
  text: string;
  [key: string]: unknown;
}

export interface OpenAIResponsesRequest {
  model: string;
  input: string | OpenAIResponsesInputItem[];
  instructions?: string | OpenAIResponsesContentPart[];
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  metadata?: { user_id?: string; [k: string]: unknown };
  tools?: unknown;
  tool_choice?: unknown;
  reasoning?: unknown;
  [key: string]: unknown;
}

export interface OpenAIResponsesOutputText {
  type: 'output_text';
  text: string;
  annotations?: unknown[];
}

export interface OpenAIResponsesOutputMessage {
  type: 'message';
  id: string;
  role: 'assistant';
  content: OpenAIResponsesOutputText[];
  [key: string]: unknown;
}

export interface OpenAIResponsesResponse {
  id: string;
  object: 'response';
  created_at: number;
  status: 'completed' | 'in_progress' | 'failed' | 'incomplete' | string;
  error: unknown;
  incomplete_details: { reason: string } | null;
  instructions: string | null;
  max_output_tokens: number | null;
  model: string;
  output: OpenAIResponsesOutputMessage[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// Wire-format error shapes. M3 normalizes these into our NormalizedError
// classes; the gateway then maps the class to a status code.

export interface AnthropicErrorBody {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

export interface OpenAIErrorBody {
  error: {
    message: string;
    type?: string;
    code?: string | null;
    param?: string | null;
  };
}
