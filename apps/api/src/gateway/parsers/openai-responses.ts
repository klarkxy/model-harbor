import type {
  ChatRequestIR,
  OpenAIResponsesRequest,
  OpenAIResponsesInputItem,
} from '@manageyourllm/shared';
import { ValidationError } from '@manageyourllm/shared';

function extractText(content: unknown): string {
  if (content === undefined || content === null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String(part.text) : ''))
      .join('');
  }
  return String(content);
}

function extractSystem(instructions: OpenAIResponsesRequest['instructions']): string | null {
  if (instructions === undefined || instructions === null) return null;
  if (typeof instructions === 'string') return instructions;
  if (Array.isArray(instructions)) {
    return instructions
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String(part.text) : ''))
      .join('');
  }
  return String(instructions);
}

function inputItemToMessage(item: OpenAIResponsesInputItem): {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCallId?: string;
} {
  const role = item.role ?? 'user';
  if (role === 'system' || role === 'developer') {
    return { role: 'system', content: extractText(item.content) };
  }
  if (role === 'assistant') {
    return { role: 'assistant', content: extractText(item.content) };
  }
  if (role === 'tool') {
    return { role: 'tool', content: extractText(item.content), toolCallId: item.call_id };
  }
  return { role: 'user', content: extractText(item.content) };
}

export function parseOpenAIResponses(body: unknown): ChatRequestIR {
  const req = body as OpenAIResponsesRequest;
  if (!req || typeof req !== 'object') {
    throw new ValidationError('请求体必须是 JSON 对象');
  }
  if (!req.model || typeof req.model !== 'string') {
    throw new ValidationError('缺少 model 字段');
  }

  const systemParts: string[] = [];
  const messages: ChatRequestIR['messages'] = [];

  if (typeof req.input === 'string') {
    messages.push({ role: 'user', content: req.input });
  } else if (Array.isArray(req.input)) {
    for (const item of req.input) {
      if (!item || typeof item !== 'object') continue;
      const mapped = inputItemToMessage(item);
      if (mapped.role === 'system') {
        systemParts.push(mapped.content);
      } else {
        messages.push({
          role: mapped.role,
          content: mapped.content,
          toolCallId: mapped.toolCallId,
        });
      }
    }
  } else {
    throw new ValidationError('input 必须是字符串或数组');
  }

  if (messages.length === 0) {
    throw new ValidationError('input 中必须至少包含一条用户消息');
  }

  return {
    sourceProtocol: 'codex',
    requestedModel: req.model,
    system: systemParts.length > 0 ? systemParts.join('\n') : extractSystem(req.instructions),
    messages,
    maxTokens: typeof req.max_output_tokens === 'number' ? req.max_output_tokens : null,
    temperature: typeof req.temperature === 'number' ? req.temperature : null,
    topP: typeof req.top_p === 'number' ? req.top_p : null,
    stream: req.stream === true,
    metadata: req.metadata?.user_id ? { user_id: req.metadata.user_id } : {},
    rawRequest: body,
  };
}
