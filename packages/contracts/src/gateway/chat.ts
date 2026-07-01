import { z } from 'zod';
import { successEnvelope } from '../envelope.js';

// 网关聊天相关端点的占位契约。Phase 0 只保留最小结构，
// 后续阶段由 provider adapter 填入具体字段。

export const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.array(z.record(z.unknown()))]),
  tool_call_id: z.string().optional(),
});

export const chatCompletionRequestSchema = z.object({
  model: z.string(),
  messages: z.array(chatMessageSchema),
  stream: z.boolean().optional().default(false),
  max_tokens: z.number().int().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  tools: z.array(z.unknown()).optional(),
  tool_choice: z.unknown().optional(),
  response_format: z.unknown().optional(),
});

export const chatCompletionChoiceSchema = z.object({
  index: z.number().int(),
  message: chatMessageSchema,
  finish_reason: z.string().nullable(),
});

export const chatCompletionResponseSchema = successEnvelope(
  z.object({
    id: z.string(),
    object: z.literal('chat.completion'),
    created: z.number().int(),
    model: z.string(),
    choices: z.array(chatCompletionChoiceSchema),
    usage: z
      .object({
        prompt_tokens: z.number().int(),
        completion_tokens: z.number().int(),
        total_tokens: z.number().int(),
      })
      .optional(),
  }),
);

export const messagesRequestSchema = z.object({
  model: z.string(),
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.union([z.string(), z.array(z.record(z.unknown()))]),
    }),
  ),
  max_tokens: z.number().int().optional(),
  stream: z.boolean().optional().default(false),
  system: z.union([z.string(), z.array(z.record(z.unknown()))]).optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  thinking: z.unknown().optional(),
});

export const messagesResponseSchema = successEnvelope(
  z.object({
    id: z.string(),
    type: z.literal('message'),
    role: z.literal('assistant'),
    content: z.array(z.record(z.unknown())),
    model: z.string(),
    stop_reason: z.string().nullable(),
    usage: z
      .object({
        input_tokens: z.number().int(),
        output_tokens: z.number().int(),
      })
      .optional(),
  }),
);

export const responsesRequestSchema = z.object({
  model: z.string(),
  input: z.union([z.string(), z.array(z.record(z.unknown()))]),
  instructions: z.union([z.string(), z.array(z.record(z.unknown()))]).optional(),
  stream: z.boolean().optional().default(false),
  max_output_tokens: z.number().int().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  reasoning: z.unknown().optional(),
});

export const responsesResponseSchema = successEnvelope(
  z.object({
    id: z.string(),
    object: z.literal('response'),
    created_at: z.number().int(),
    model: z.string(),
    output: z.array(z.record(z.unknown())),
    usage: z
      .object({
        input_tokens: z.number().int(),
        output_tokens: z.number().int(),
        total_tokens: z.number().int(),
      })
      .optional(),
  }),
);

export type ChatCompletionRequest = z.infer<typeof chatCompletionRequestSchema>;
export type ChatCompletionResponse = z.infer<typeof chatCompletionResponseSchema>;
export type MessagesRequest = z.infer<typeof messagesRequestSchema>;
export type MessagesResponse = z.infer<typeof messagesResponseSchema>;
export type ResponsesRequest = z.infer<typeof responsesRequestSchema>;
export type ResponsesResponse = z.infer<typeof responsesResponseSchema>;
