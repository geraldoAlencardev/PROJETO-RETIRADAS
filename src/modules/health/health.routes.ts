import type { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/prisma.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'degraded', db: 'indisponivel' });
    }
  });
}
