import { api } from '../client.js';
import type { GenerateSnippetRequest, GenerateSnippetResponse } from '@manageyourllm/contracts';

export async function generateSnippet(
  body: GenerateSnippetRequest,
): Promise<GenerateSnippetResponse['data']> {
  const res = await api.post<GenerateSnippetResponse>('/api/admin/snippets/generate', body);
  return res.data;
}
