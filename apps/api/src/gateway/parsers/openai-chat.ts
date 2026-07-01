import type {
  ChatRequestIR,
  OpenAIChatCompletionsRequest,
  OpenAIChatMessage,
} from '@manageyourllm/shared';
import { ValidationError } from '@manageyourllm/shared';

function extractTextContent(content: OpenAIChatMessage['content']): string {
  if (content === undefined || content === null) return '';
  if (typeof content === 'string') return content;
  return String(content);
}

export function parseOpenAIChatCompletions(body: unknown): ChatRequestIR {
  const req = body as OpenAIChatCompletionsRequest;
  if (!req || typeof req !== 'object') {
    throw new ValidationError('请求体必须是 JSON 对象');
  }
  if (!req.model || typeof req.model !== 'string') {
    throw new ValidationError('缺少 model 字段');
  }
  if (!Array.isArray(req.messages) || req.messages.length === 0) {
    throw new ValidationError('messages 必须是非空数组');
  }

  const systemParts: string[] = [];
  const messages = req.messages.map((msg, index) => {
    if (!msg || typeof msg !== 'object') {
      throw new ValidationError(`messages[${index}] 必须是对象`);
    }
    const content = extractTextContent(msg.content);
    if (msg.role === 'system') {
      systemParts.push(content);
    }
    if (msg.role === 'tool') {
      return {
        role: 'tool' as const,
        content,
        toolCallId: msg.tool_call_id,
      };
    }
    if (msg.role !== 'user' && msg.role !== 'assistant' && msg.role !== 'system') {
      throw new ValidationError(`messages[${index}].role 不支持的值: ${msg.role}`);
    }
    return {
      role: msg.role,
      content,
    };
  });

  // 过滤掉 system 消息，因为它们已被合并到 IR.system。
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');

  return {
    sourceProtocol: 'openai',
    requestedModel: req.model,
    system: systemParts.length > 0 ? systemParts.join('\n') : null,
    messages: nonSystemMessages,
    maxTokens: typeof req.max_tokens === 'number' ? req.max_tokens : null,
    temperature: typeof req.temperature === 'number' ? req.temperature : null,
    topP: typeof req.top_p === 'number' ? req.top_p : null,
    stream: req.stream === true,
    metadata: req.user ? { user_id: req.user } : {},
    rawRequest: body,
  };
}
