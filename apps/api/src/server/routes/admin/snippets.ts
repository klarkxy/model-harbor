import type { FastifyInstance } from 'fastify';
import {
  generateSnippetRequestSchema,
  generateSnippetResponseSchema,
} from '@manageyourllm/contracts';
import { ValidationError } from '@manageyourllm/shared';
import { SnippetService } from '../../../application/snippet.service.js';
import { SettingsService } from '../../../application/settings.service.js';
import type { Db } from '../../../infrastructure/db/client.js';

export interface SnippetRouteDeps {
  db: Db;
}

export async function snippetRoutes(app: FastifyInstance, deps: SnippetRouteDeps): Promise<void> {
  const service = new SnippetService();
  const settingsService = new SettingsService(deps.db);

  app.post('/generate', async (req) => {
    const parsed = generateSnippetRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid snippet request', { issues: parsed.error.issues });
    }
    const body = parsed.data;
    const settings = await settingsService.getSettings();
    const gatewayUrl = service.buildGatewayUrl(settings);
    const apiKey = body.apiKey ?? '<your-client-key>';
    const result = service.generate({
      client: body.client,
      model: body.model,
      apiKey,
      gatewayUrl,
    });
    return generateSnippetResponseSchema.parse({ data: result });
  });
}
