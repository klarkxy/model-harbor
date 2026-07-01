import type { FastifyInstance } from 'fastify';
import {
  listChannelsResponseSchema,
  channelResponseSchema,
  createChannelRequestSchema,
  updateChannelRequestSchema,
  replaceChannelMembersRequestSchema,
  successEnvelope,
} from '@manageyourllm/contracts';
import { ChannelService } from '../../../application/channel.service.js';
import { serializeForContract } from '../../helpers/contract-serializer.js';
import type { Db } from '../../../infrastructure/db/client.js';
import { z } from 'zod';

export interface ChannelRouteDeps {
  db: Db;
}

export async function channelRoutes(app: FastifyInstance, deps: ChannelRouteDeps): Promise<void> {
  const service = new ChannelService(deps.db);

  app.get('/', async () => {
    const channels = await service.listChannels();
    return listChannelsResponseSchema.parse({ data: serializeForContract(channels) });
  });

  app.get('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const channel = await service.getChannel(id);
    return channelResponseSchema.parse({ data: serializeForContract(channel) });
  });

  app.post('/', async (req) => {
    const body = createChannelRequestSchema.parse(req.body);
    const channel = await service.createChannel({
      name: body.name,
      displayName: body.displayName,
      description: body.description,
      enabled: body.enabled,
      members: body.members,
    });
    const withMembers = await service.getChannel(channel.id);
    return channelResponseSchema.parse({ data: serializeForContract(withMembers) });
  });

  app.patch('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = updateChannelRequestSchema.parse(req.body);
    const channel = await service.updateChannel(id, {
      name: body.name,
      displayName: body.displayName,
      description: body.description,
      enabled: body.enabled,
    });
    const withMembers = await service.getChannel(channel!.id);
    return channelResponseSchema.parse({ data: serializeForContract(withMembers) });
  });

  app.delete('/:id', async (req) => {
    const { id } = req.params as { id: string };
    await service.deleteChannel(id);
    return successEnvelope(z.object({ ok: z.boolean() })).parse({ data: { ok: true } });
  });

  app.post('/:id/members/replace', async (req) => {
    const { id } = req.params as { id: string };
    const body = replaceChannelMembersRequestSchema.parse(req.body);
    await service.replaceMembers(
      id,
      body.members.map((m) => ({
        modelId: m.modelId,
        enabled: m.enabled,
        priority: m.priority,
      })),
    );
    const withMembers = await service.getChannel(id);
    return channelResponseSchema.parse({ data: serializeForContract(withMembers) });
  });
}
