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
 * Inspect a wire-format request and determine which adapter capabilities are
 * required. The check is intentionally lightweight: it looks at the raw JSON
 * body so it works for Anthropic Messages, OpenAI Chat Completions, and
 * OpenAI Responses without re-parsing each protocol.
 */
export function requiredCapabilities(rawRequest: unknown): RequiredCapabilities {
  const required: RequiredCapabilities = {};
  if (!rawRequest || typeof rawRequest !== 'object') return required;
  const req = rawRequest as Record<string, unknown>;

  // Streaming check.
  if (req['stream'] === true) {
    required.streaming = true;
  }

  // Tools check: Anthropic `tools` / OpenAI `tools` or `tool_choice`.
  if (Array.isArray(req['tools']) && req['tools'].length > 0) {
    required.tools = true;
  }
  if (req['tool_choice'] !== undefined && req['tool_choice'] !== 'none') {
    required.tools = true;
    required.toolChoice = true;
  }

  // JSON mode check: OpenAI `response_format` or `json_mode`.
  if (req['response_format'] !== undefined || req['json_mode'] === true) {
    required.jsonMode = true;
  }

  // Thinking / reasoning check: Anthropic `thinking` or Responses `reasoning`.
  if (req['thinking'] !== undefined && req['thinking'] !== null) {
    required.thinking = true;
  }
  if (req['reasoning'] !== undefined && req['reasoning'] !== null) {
    required.thinking = true;
  }

  // Vision check: look for image content in messages.
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

  // Responses API input items can also carry images.
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
 * Convenience helper: check whether a single capability is required by the
 * given wire-format request.
 */
export function requestRequiresCapability(
  rawRequest: unknown,
  capability: RequiredCapability,
): boolean {
  return !!requiredCapabilities(rawRequest)[capability];
}
