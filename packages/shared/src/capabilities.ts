import type { SourceProtocol } from './protocols.js';

export type UsageAvailability = 'always' | 'on_demand' | 'unavailable';

export interface ProviderCapabilities {
  protocols: readonly SourceProtocol[];
  supportsStreaming: boolean;
  supportsSystemPrompt: boolean;
  supportsTools: boolean;
  supportsToolChoice: boolean;
  supportsVision: boolean;
  supportsJsonMode: boolean;
  supportsThinking: boolean;
  usageAvailability: UsageAvailability;
}

export type RequiredCapability =
  | 'streaming'
  | 'tools'
  | 'toolChoice'
  | 'vision'
  | 'jsonMode'
  | 'thinking';

export interface RequiredCapabilities {
  streaming?: boolean;
  tools?: boolean;
  toolChoice?: boolean;
  vision?: boolean;
  jsonMode?: boolean;
  thinking?: boolean;
}

/**
 * 检查 wire-format 请求需要哪些 adapter 能力。
 * 这个检查故意保持轻量：它直接查看原始 JSON body，因此对 Anthropic Messages、
 * OpenAI Chat Completions 和 OpenAI Responses 都能工作，无需为每种协议重新解析。
 */
export function requiredCapabilities(rawRequest: unknown): RequiredCapabilities {
  const required: RequiredCapabilities = {};
  if (!rawRequest || typeof rawRequest !== 'object') return required;
  const req = rawRequest as Record<string, unknown>;

  // 流式检查
  if (req['stream'] === true) {
    required.streaming = true;
  }

  // Tools 检查：Anthropic `tools` / OpenAI `tools` 或 `tool_choice`。
  if (Array.isArray(req['tools']) && req['tools'].length > 0) {
    required.tools = true;
  }
  if (req['tool_choice'] !== undefined && req['tool_choice'] !== 'none') {
    required.tools = true;
    required.toolChoice = true;
  }

  // JSON 模式检查：OpenAI `response_format` 或 `json_mode`。
  if (req['response_format'] !== undefined || req['json_mode'] === true) {
    required.jsonMode = true;
  }

  // Thinking / reasoning 检查：Anthropic `thinking` 或 Responses `reasoning`。
  if (req['thinking'] !== undefined && req['thinking'] !== null) {
    required.thinking = true;
  }
  if (req['reasoning'] !== undefined && req['reasoning'] !== null) {
    required.thinking = true;
  }

  // 视觉检查：在 messages 中查找图片内容。
  const messages = req['messages'];
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (!msg || typeof msg !== 'object') continue;
      const content = (msg as Record<string, unknown>)['content'];
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part && typeof part === 'object') {
            const type = (part as Record<string, unknown>)['type'];
            if (type === 'image' || type === 'image_url') {
              required.vision = true;
            }
          }
        }
      }
    }
  }

  // Responses API 的 input items 也可能携带图片。
  const input = req['input'];
  if (Array.isArray(input)) {
    for (const item of input) {
      if (!item || typeof item !== 'object') continue;
      const content = (item as Record<string, unknown>)['content'];
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part && typeof part === 'object') {
            const type = (part as Record<string, unknown>)['type'];
            if (type === 'image' || type === 'image_url' || type === 'input_image') {
              required.vision = true;
            }
          }
        }
      }
    }
  }

  return required;
}

/**
 * 便捷辅助函数：判断单个能力是否被给定 wire-format 请求需要。
 */
export function requestRequiresCapability(
  rawRequest: unknown,
  capability: RequiredCapability,
): boolean {
  return !!requiredCapabilities(rawRequest)[capability];
}

/**
 * 判断请求是否需要跨协议转换目前不支持的“高级”能力。
 * 当前 IR 只保留文本和基础采样参数，tools/tool_choice/response_format/thinking/vision
 * 等字段在 Anthropic ↔ OpenAI 等转换路径会被静默丢弃，因此带这些能力的请求
 * 必须走原生同协议 endpoint，否则应视为不支持。
 */
export function requestRequiresAdvancedCrossProtocol(rawRequest: unknown): boolean {
  const caps = requiredCapabilities(rawRequest);
  return !!(caps.tools || caps.toolChoice || caps.jsonMode || caps.thinking || caps.vision);
}
