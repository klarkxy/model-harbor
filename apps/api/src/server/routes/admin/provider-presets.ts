import type { FastifyInstance } from 'fastify';
import { listPresetsResponseSchema } from '@manageyourllm/contracts';
import { ProviderPresetService } from '../../../application/provider-preset.service.js';
import { serializeForContract } from '../../helpers/contract-serializer.js';

export type ProviderPresetRouteDeps = Record<string, never>;

export async function providerPresetRoutes(
  app: FastifyInstance,
  _deps: ProviderPresetRouteDeps,
): Promise<void> {
  const service = new ProviderPresetService();

  app.get('/', async () => {
    const presets = await service.listPresets();
    return listPresetsResponseSchema.parse({ data: serializeForContract(presets) });
  });
}
