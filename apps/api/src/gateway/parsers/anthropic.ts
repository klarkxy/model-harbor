import type {
  ChatRequestIR,
  AnthropicMessagesRequest,
  AnthropicContentBlock,
} from '@manageyourllm/shared';
import { ValidationError } from '@manageyourllm/shared';

function extractText(content: string | AnthropicContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .join('');
}

function extractSystem(system: AnthropicMessagesRequest['system']): string | null {
  if (system === undefined || system === null) return null;
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system
      .map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
      .join('');
  }
  return String(system);
}

export function parseAnthropicMessages(body: unknown): ChatRequestIR {
  const req = body as AnthropicMessagesRequest;
  if (!req || typeof req !== 'object') {
    throw new ValidationError('请求体必须是 JSON 对象');
  }
  if (!req.model || typeof req.model !== 'string') {
    throw new ValidationError('缺少 model 字段');
  }
  if (!Array.isArray(req.messages) || req.messages.length === 0) {
    throw new ValidationError('messages 必须是非空数组');
  }

  const messages = req.messages.map((msg, index) => {
    if (!msg || typeof msg !== 'object') {
      throw new ValidationError(`messages[${index}] 必须是对象`);
    }
    if (msg.role !== 'user' && msg.role !== 'assistant') {
      throw new ValidationError(`messages[${index}].role 必须是 user 或 assistant`);
    }
    return {
      role: msg.role,
      content: extractText(msg.content),
    };
  });

  return {
    sourceProtocol: 'anthropic',
    requestedModel: req.model,
    system: extractSystem(req.system),
    messages,
    maxTokens: typeof req.max_tokens === 'number' ? req.max_tokens : null,
    temperature: typeof req.temperature === 'number' ? req.temperature : null,
    topP: typeof req.top_p === 'number' ? req.top_p : null,
    stream: req.stream === true,
    metadata: req.metadata?.user_id ? { user_id: req.metadata.user_id } : {},
    rawRequest: body,
  };
}
