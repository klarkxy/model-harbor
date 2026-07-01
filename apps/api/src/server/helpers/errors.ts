import type { FastifyReply } from 'fastify';

export interface NotFoundError {
  error: {
    message: string;
    type: 'not_found';
    code: string;
  };
}

export function notFound(reply: FastifyReply, message: string, code: string): FastifyReply {
  return reply.status(404).send({
    error: { message, type: 'not_found', code },
  });
}
