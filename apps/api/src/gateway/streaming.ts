import type { ChatUsageIR, SourceProtocol } from '@manageyourllm/shared';

export interface StreamTransformerOptions {
  requestedModel: string;
  sourceProtocol: SourceProtocol;
  endpointProtocol?: SourceProtocol;
  streamStartTime: number;
  onUsage?: (usage: ChatUsageIR | null) => void;
  onComplete?: (payload: { content: string; usage: ChatUsageIR | null }) => void;
  onFirstToken?: (latencyMs: number) => void;
  onStreamEnd?: (usage: ChatUsageIR | null) => void;
  onError?: (error: { message: string }) => void;
}

const encoder = new TextEncoder();

export function createStreamTransformer(
  options: StreamTransformerOptions,
): TransformStream<Uint8Array, Uint8Array> {
  const {
    requestedModel,
    sourceProtocol,
    endpointProtocol: endpointProtocolOption,
    streamStartTime,
    onUsage,
    onComplete,
    onFirstToken,
    onStreamEnd,
    onError,
  } = options;
  const endpointProtocol = endpointProtocolOption ?? sourceProtocol;
  let buffer = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let usageReported = false;
  let completedReported = false;
  let firstTokenReported = false;
  let streamEndReported = false;
  let assistantContent = '';

  // 跨协议转换状态
  let streamMessageId = '';
  let anthropicMessageStarted = false;
  let anthropicContentBlockStarted = false;
  let openAIFinishReported = false;
  let stopReason: string | null = null;

  const isOpenAIUpstreamToAnthropic =
    sourceProtocol === 'anthropic' && endpointProtocol === 'openai';
  const isAnthropicUpstreamToOpenAI =
    sourceProtocol === 'openai' && endpointProtocol === 'anthropic';
  const needsCrossProtocolConversion = isOpenAIUpstreamToAnthropic || isAnthropicUpstreamToOpenAI;

  function reportFirstToken() {
    if (firstTokenReported) return;
    firstTokenReported = true;
    onFirstToken?.(Math.max(0, Date.now() - streamStartTime));
  }

  function reportUsage(override?: ChatUsageIR | null) {
    if (usageReported) return;
    usageReported = true;
    const usage =
      override === null || (inputTokens === 0 && outputTokens === 0)
        ? (override ?? null)
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
        ? (override ?? null)
        : {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
          };
    onComplete?.({ content: assistantContent, usage });
  }

  function reportStreamEnd(override?: ChatUsageIR | null) {
    if (streamEndReported) return;
    streamEndReported = true;
    const usage =
      override === null || (inputTokens === 0 && outputTokens === 0)
        ? (override ?? null)
        : {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
          };
    onStreamEnd?.(usage);
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
    if (obj.message && typeof obj.message === 'object') {
      const message = obj.message as Record<string, unknown>;
      if (typeof message.model === 'string') {
        message.model = requestedModel;
      }
    }
  }

  function enqueueObject(
    obj: Record<string, unknown>,
    controller: TransformStreamDefaultController<Uint8Array>,
  ) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
  }

  function enqueueError(controller: TransformStreamDefaultController<Uint8Array>, message: string) {
    enqueueObject({ error: message }, controller);
    reportUsage(null);
    onError?.({ message });
    controller.terminate();
  }

  function parseEvent(
    data: string,
    controller: TransformStreamDefaultController<Uint8Array>,
  ): Record<string, unknown> | null {
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      enqueueError(controller, 'malformed upstream event');
      return null;
    }
  }

  // --- OpenAI 上游事件解析 ---

  interface OpenAIChunkInfo {
    id?: string;
    role?: string;
    content?: string;
    finishReason: string | null;
    usage?: Record<string, unknown>;
  }

  function parseOpenAIChunk(obj: Record<string, unknown>): OpenAIChunkInfo {
    const choice = (obj.choices as Array<Record<string, unknown>> | undefined)?.[0];
    const delta = choice?.delta as Record<string, unknown> | undefined;
    return {
      id: typeof obj.id === 'string' ? obj.id : undefined,
      role: typeof delta?.role === 'string' ? delta.role : undefined,
      content: typeof delta?.content === 'string' ? delta.content : undefined,
      finishReason: (choice?.finish_reason as string | null | undefined) ?? null,
      usage:
        obj.usage && typeof obj.usage === 'object'
          ? (obj.usage as Record<string, unknown>)
          : undefined,
    };
  }

  // --- Anthropic 上游事件解析 ---

  interface AnthropicEventInfo {
    eventType: string;
    id?: string;
    text?: string;
    inputTokens?: number;
    outputTokens?: number;
    stopReason?: string;
  }

  function parseAnthropicEvent(obj: Record<string, unknown>): AnthropicEventInfo {
    const eventType = typeof obj.type === 'string' ? obj.type : '';
    const info: AnthropicEventInfo = { eventType };

    if (eventType === 'message_start') {
      const message = obj.message as Record<string, unknown> | undefined;
      if (message) {
        info.id = typeof message.id === 'string' ? message.id : undefined;
        const usage = message.usage as Record<string, unknown> | undefined;
        if (usage && typeof usage.input_tokens === 'number') {
          info.inputTokens = usage.input_tokens;
        }
      }
    } else if (eventType === 'content_block_start') {
      const block = obj.content_block as Record<string, unknown> | undefined;
      if (typeof block?.text === 'string') {
        info.text = block.text;
      }
    } else if (eventType === 'content_block_delta') {
      const delta = obj.delta as Record<string, unknown> | undefined;
      if (typeof delta?.text === 'string') {
        info.text = delta.text;
      }
    } else if (eventType === 'message_delta') {
      const delta = obj.delta as Record<string, unknown> | undefined;
      if (typeof delta?.stop_reason === 'string') {
        info.stopReason = delta.stop_reason;
      }
      const usage = obj.usage as Record<string, unknown> | undefined;
      if (usage && typeof usage.output_tokens === 'number') {
        info.outputTokens = usage.output_tokens;
      }
    }

    return info;
  }

  // --- 停止原因映射 ---

  function mapOpenAIFinishReasonToAnthropic(reason: string | null): string | null {
    if (reason === 'stop') return 'end_turn';
    if (reason === 'length') return 'max_tokens';
    if (reason === 'tool_calls' || reason === 'function_call') return 'tool_use';
    return null;
  }

  function mapAnthropicStopReasonToOpenAI(reason: string | null): string | null {
    if (reason === 'end_turn') return 'stop';
    if (reason === 'max_tokens') return 'length';
    if (reason === 'tool_use') return 'tool_calls';
    if (reason === 'stop_sequence') return 'stop';
    return null;
  }

  function buildOpenAIUsage(): Record<string, number> | undefined {
    const total = inputTokens + outputTokens;
    if (inputTokens === 0 && outputTokens === 0) return undefined;
    return {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: total,
    };
  }

  // --- 原生处理 ---

  function processOpenAIEvent(
    data: string,
    controller: TransformStreamDefaultController<Uint8Array>,
  ) {
    if (data === '[DONE]') {
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      reportUsage();
      return;
    }

    const obj = parseEvent(data, controller);
    if (!obj) return;

    reportFirstToken();
    const info = parseOpenAIChunk(obj);
    if (info.id) streamMessageId = info.id;
    if (info.content != null) assistantContent += info.content;
    if (info.finishReason != null) stopReason = info.finishReason;
    if (info.usage) applyOpenAIUsage(info.usage);

    rewriteModelInObject(obj);
    enqueueObject(obj, controller);
  }

  function processAnthropicEvent(
    data: string,
    controller: TransformStreamDefaultController<Uint8Array>,
  ) {
    const obj = parseEvent(data, controller);
    if (!obj) return;

    reportFirstToken();
    const info = parseAnthropicEvent(obj);
    if (info.id) streamMessageId = info.id;
    if (info.inputTokens != null) inputTokens = info.inputTokens;
    if (info.outputTokens != null) outputTokens = info.outputTokens;
    if (info.stopReason != null) stopReason = info.stopReason;
    if (info.text != null) assistantContent += info.text;

    rewriteModelInObject(obj);
    enqueueObject(obj, controller);
  }

  // --- OpenAI 上游 → Anthropic 下游 ---

  function processOpenAIUpstreamAsAnthropic(
    data: string,
    isDone: boolean,
    controller: TransformStreamDefaultController<Uint8Array>,
  ) {
    if (isDone) {
      if (!anthropicMessageStarted) {
        // 极端情况：上游直接结束，仍至少发送一个 message_stop。
        enqueueObject({ type: 'message_stop' }, controller);
      } else if (!openAIFinishReported) {
        enqueueObject(
          {
            type: 'message_delta',
            delta: {
              stop_reason: mapOpenAIFinishReasonToAnthropic(stopReason),
              stop_sequence: null,
            },
            usage: { output_tokens: outputTokens },
          },
          controller,
        );
        enqueueObject({ type: 'message_stop' }, controller);
      }
      reportUsage();
      return;
    }

    const obj = parseEvent(data, controller);
    if (!obj) return;

    reportFirstToken();
    const info = parseOpenAIChunk(obj);
    if (info.id) streamMessageId = info.id;
    if (info.usage) applyOpenAIUsage(info.usage);
    if (info.content != null) assistantContent += info.content;
    if (info.finishReason != null) stopReason = info.finishReason;

    const events: Record<string, unknown>[] = [];

    if (!anthropicMessageStarted) {
      anthropicMessageStarted = true;
      events.push({
        type: 'message_start',
        message: {
          id: streamMessageId || 'unknown',
          type: 'message',
          role: 'assistant',
          model: requestedModel,
          usage: { input_tokens: inputTokens },
        },
      });
    }

    if (info.content != null && info.content !== '') {
      if (!anthropicContentBlockStarted) {
        anthropicContentBlockStarted = true;
        events.push({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        });
      }
      events.push({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: info.content },
      });
    }

    const isFinal =
      info.finishReason != null ||
      (info.usage != null && (obj.choices as unknown[] | undefined)?.length === 0);
    if (isFinal && !openAIFinishReported) {
      openAIFinishReported = true;
      events.push({
        type: 'message_delta',
        delta: {
          stop_reason: mapOpenAIFinishReasonToAnthropic(stopReason),
          stop_sequence: null,
        },
        usage: { output_tokens: outputTokens },
      });
      events.push({ type: 'message_stop' });
    }

    for (const event of events) {
      enqueueObject(event, controller);
    }
  }

  // --- Anthropic 上游 → OpenAI 下游 ---

  function processAnthropicUpstreamAsOpenAI(
    data: string,
    controller: TransformStreamDefaultController<Uint8Array>,
  ) {
    const obj = parseEvent(data, controller);
    if (!obj) return;

    reportFirstToken();
    const info = parseAnthropicEvent(obj);
    if (info.id) streamMessageId = info.id;
    if (info.inputTokens != null) inputTokens = info.inputTokens;
    if (info.outputTokens != null) outputTokens = info.outputTokens;
    if (info.stopReason != null) stopReason = info.stopReason;
    if (info.text != null) assistantContent += info.text;

    const events: Record<string, unknown>[] = [];

    if (info.eventType === 'message_start') {
      events.push({
        id: streamMessageId || 'unknown',
        object: 'chat.completion.chunk',
        model: requestedModel,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant' },
            finish_reason: null,
            logprobs: null,
          },
        ],
      });
    }

    if (
      (info.eventType === 'content_block_start' || info.eventType === 'content_block_delta') &&
      info.text != null
    ) {
      events.push({
        id: streamMessageId || 'unknown',
        object: 'chat.completion.chunk',
        model: requestedModel,
        choices: [
          {
            index: 0,
            delta: { content: info.text },
            finish_reason: null,
            logprobs: null,
          },
        ],
      });
    }

    if (info.eventType === 'message_delta') {
      openAIFinishReported = true;
      events.push({
        id: streamMessageId || 'unknown',
        object: 'chat.completion.chunk',
        model: requestedModel,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: mapAnthropicStopReasonToOpenAI(stopReason),
            logprobs: null,
          },
        ],
        usage: buildOpenAIUsage(),
      });
    }

    if (info.eventType === 'message_stop' && !openAIFinishReported) {
      openAIFinishReported = true;
      events.push({
        id: streamMessageId || 'unknown',
        object: 'chat.completion.chunk',
        model: requestedModel,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: mapAnthropicStopReasonToOpenAI(stopReason),
            logprobs: null,
          },
        ],
        usage: buildOpenAIUsage(),
      });
    }

    for (const event of events) {
      enqueueObject(event, controller);
    }

    if (info.eventType === 'message_stop') {
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      reportUsage();
    }
  }

  // --- 主分派 ---

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
    const isDone = data === '[DONE]';

    if (needsCrossProtocolConversion) {
      if (isOpenAIUpstreamToAnthropic) {
        processOpenAIUpstreamAsAnthropic(data, isDone, controller);
      } else {
        processAnthropicUpstreamAsOpenAI(data, controller);
      }
      return;
    }

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
      if (needsCrossProtocolConversion && isOpenAIUpstreamToAnthropic && !openAIFinishReported) {
        // 确保 Anthropic 下游收到 message_stop。
        enqueueObject(
          {
            type: 'message_delta',
            delta: {
              stop_reason: mapOpenAIFinishReasonToAnthropic(stopReason),
              stop_sequence: null,
            },
            usage: { output_tokens: outputTokens },
          },
          controller,
        );
        enqueueObject({ type: 'message_stop' }, controller);
        openAIFinishReported = true;
      }
      reportUsage();
      reportComplete();
      reportStreamEnd();
      controller.terminate();
    },
  });
}
