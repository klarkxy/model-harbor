import type { ChatUsageIR } from '@manageyourllm/shared';

export interface StreamTransformerOptions {
  requestedModel: string;
  sourceProtocol: 'openai' | 'anthropic' | 'codex';
  onUsage?: (usage: ChatUsageIR | null) => void;
  onComplete?: (payload: { content: string; usage: ChatUsageIR | null }) => void;
}

const encoder = new TextEncoder();

export function createStreamTransformer(
  options: StreamTransformerOptions,
): TransformStream<Uint8Array, Uint8Array> {
  const { requestedModel, sourceProtocol, onUsage, onComplete } = options;
  let buffer = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let usageReported = false;
  let completedReported = false;
  let assistantContent = '';

  function reportUsage(override?: ChatUsageIR | null) {
    if (usageReported) return;
    usageReported = true;
    const usage =
      override === null || (inputTokens === 0 && outputTokens === 0)
        ? override ?? null
        : {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
          };
    onUsage?.(usage);
  }

  function reportComplete(override?: ChatUsageIR | null) {
    if (completedReported) return;
    completedReported = true;
    const usage =
      override === null || (inputTokens === 0 && outputTokens === 0)
        ? override ?? null
        : {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
          };
    onComplete?.({ content: assistantContent, usage });
  }

  function applyOpenAIUsage(usage: unknown) {
    if (!usage || typeof usage !== 'object') return;
    const u = usage as Record<string, unknown>;
    if (typeof u.prompt_tokens === 'number') inputTokens = u.prompt_tokens;
    if (typeof u.input_tokens === 'number') inputTokens = u.input_tokens;
    if (typeof u.completion_tokens === 'number') outputTokens = u.completion_tokens;
    if (typeof u.output_tokens === 'number') outputTokens = u.output_tokens;
  }

  function rewriteModelInObject(obj: Record<string, unknown>) {
    if (typeof obj.model === 'string') {
      obj.model = requestedModel;
    }
    if (obj.response && typeof obj.response === 'object') {
      const response = obj.response as Record<string, unknown>;
      if (typeof response.model === 'string') {
        response.model = requestedModel;
      }
      if (response.usage && typeof response.usage === 'object') {
        applyOpenAIUsage(response.usage);
      }
    }
  }

  function processOpenAIEvent(
    data: string,
    controller: TransformStreamDefaultController<Uint8Array>,
  ) {
    if (data === '[DONE]') {
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      reportUsage();
      return;
    }

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(data) as Record<string, unknown>;
    } catch {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ error: 'malformed upstream event' })}\n\n`),
      );
      reportUsage(null);
      controller.terminate();
      return;
    }

    rewriteModelInObject(obj);
    applyOpenAIUsage(obj.usage);

    const choice = (obj.choices as Array<Record<string, unknown>> | undefined)?.[0];
    const delta = choice?.delta as Record<string, unknown> | undefined;
    if (typeof delta?.content === 'string') {
      assistantContent += delta.content;
    }

    controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
  }

  function processAnthropicEvent(
    data: string,
    controller: TransformStreamDefaultController<Uint8Array>,
  ) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(data) as Record<string, unknown>;
    } catch {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ error: 'malformed upstream event' })}\n\n`),
      );
      reportUsage(null);
      controller.terminate();
      return;
    }

    if (obj.message && typeof obj.message === 'object') {
      const message = obj.message as Record<string, unknown>;
      if (typeof message.model === 'string') {
        message.model = requestedModel;
      }
      const usage = message.usage;
      if (usage && typeof usage === 'object') {
        const u = usage as Record<string, unknown>;
        if (typeof u.input_tokens === 'number') inputTokens = u.input_tokens;
      }
    }

    if (obj.usage && typeof obj.usage === 'object') {
      const u = obj.usage as Record<string, unknown>;
      if (typeof u.output_tokens === 'number') outputTokens = u.output_tokens;
    }

    if (obj.content_block && typeof obj.content_block === 'object') {
      const block = obj.content_block as Record<string, unknown>;
      if (typeof block.text === 'string') assistantContent += block.text;
    }

    if (obj.delta && typeof obj.delta === 'object') {
      const delta = obj.delta as Record<string, unknown>;
      if (typeof delta.text === 'string') assistantContent += delta.text;
    }

    controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
  }

  function processEvent(block: string, controller: TransformStreamDefaultController<Uint8Array>) {
    const lines = block.split('\n').map((l) => l.replace(/\r$/, ''));
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        dataLines.push(line.slice('data: '.length));
      }
    }
    if (dataLines.length === 0) return;
    const data = dataLines.join('\n');

    if (sourceProtocol === 'anthropic') {
      processAnthropicEvent(data, controller);
    } else {
      processOpenAIEvent(data, controller);
    }
  }

  return new TransformStream({
    transform(chunk, controller) {
      buffer += new TextDecoder().decode(chunk, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        if (part.trim().length === 0) continue;
        processEvent(part, controller);
      }
    },
    flush(controller) {
      if (buffer.trim().length > 0) {
        processEvent(buffer, controller);
      }
      reportUsage();
      reportComplete();
      controller.terminate();
    },
  });
}
