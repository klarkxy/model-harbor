import { z } from 'zod';
import { successEnvelope } from '../envelope.js';

export const SNIPPET_CLIENTS = [
  'claude_code',
  'codex_cli',
  'opencode',
  'hermes',
  'cherry_studio',
  'generic_openai',
  'openai_python',
  'openai_node',
  'anthropic_python',
  'anthropic_node',
] as const;

export const snippetClientSchema = z.enum(SNIPPET_CLIENTS);

export const generateSnippetRequestSchema = z.object({
  client: snippetClientSchema,
  model: z.string().min(1, 'model is required'),
  clientKeyId: z.string().optional(),
  apiKey: z.string().optional(),
});

export const generateSnippetResponseSchema = successEnvelope(
  z.object({
    client: snippetClientSchema,
    model: z.string(),
    apiKey: z.string(),
    gatewayUrl: z.string(),
    content: z.string(),
  }),
);

export type SnippetClient = z.infer<typeof snippetClientSchema>;
export type GenerateSnippetRequest = z.infer<typeof generateSnippetRequestSchema>;
export type GenerateSnippetResponse = z.infer<typeof generateSnippetResponseSchema>;
