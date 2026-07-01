import type { SourceProtocol } from './protocols.js';

// --- 内部请求表示 ---
//
// 内部请求形状是路由核心进行推理的对象。客户端 adapter 将 wire-format 请求
//（Anthropic Messages、OpenAI Chat Completions 等）转换为此形状；provider
// adapter 再将其转换回各自的上游 wire format。保持 IR 协议无关意味着路由
// 引擎不需要知道它正在与哪个 provider 通信。

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatMessageIR {
  role: ChatRole;
  // M3 保持 content 为纯字符串；未来可扩展为 ContentPart[] 而不破坏 wire。
  content: string;
  // tool / tool result 的 id，仅用于 `tool` 角色。
  toolCallId?: string;
}

export interface ChatRequestIR {
  sourceProtocol: SourceProtocol;
  // 客户端请求的模型名（例如 "claude-3-5-sonnet" 或 "gpt-4o-mini"）。
  // 路由将其解析为候选，并通过 provider adapter 把真实模型名传给上游。
  requestedModel: string;
  system: string | null;
  messages: ChatMessageIR[];
  maxTokens: number | null;
  temperature: number | null;
  topP: number | null;
  stream: boolean;
  // 通用上游元数据（Anthropic `metadata.user_id` 等）。
  metadata: Record<string, string>;
  // 原始 wire-format 请求，用于调试与审计。
  rawRequest: unknown;
}

// --- 内部响应表示 ---

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
  // 助手消息文本。M3 保持为纯字符串。
  content: string;
  // 归一化的停止原因："end_turn" / "stop" / "length" / "tool_use" 等。
  // adapter 负责将 provider 专有值映射过来。
  stopReason: string | null;
  usage: ChatUsageIR | null;
  // 原始 provider 响应，用于审计 / 透传。
  rawResponse: unknown;
}

// --- 外部（wire-format）请求形状 ---
//
// 这些形状是 adapter 需要从其转换（接收客户端请求时）或转换为其（发送给上游时）。
// 它们镜像公开的 Anthropic 和 OpenAI API；ManageYourLLM 目前只消费文本消息字段，
// 忽略 tools/tool_choice/structured-output 等高级字段。

export interface AnthropicContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result' | string;
  text?: string;
  // tool_use / tool_result / image 还有其他字段；M3 保持宽松。
  [key: string]: unknown;
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
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
  thinking?: unknown;
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
  // tool/function 消息使用 `content` 承载结果文本。
  content?: string | null;
  // assistant 消息可包含 tool calls。
  tool_calls?: unknown;
  // tool 消息：所响应调用的 id。
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

// OpenAI Responses API（Codex 与部分新 OpenAI 模型使用）。

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

// Wire-format 错误形状。ManageYourLLM 将其归一化为 NormalizedError 类；
// 网关再把这些类映射为状态码。

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
