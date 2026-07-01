import 'fastify';
import type { ClientKeyRow, ClientRow } from '../../infrastructure/db/schema.js';
import type { SourceProtocol } from '@manageyourllm/shared';

declare module 'fastify' {
  interface FastifyRequest {
    clientKey?: ClientKeyRow;
    client?: ClientRow;
    requestTraceId?: string;
    sourceProtocol?: SourceProtocol;
    requestStartTime?: number;
  }
}
