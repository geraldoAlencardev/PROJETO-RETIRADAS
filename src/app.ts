import Fastify from 'fastify';
import { healthRoutes } from './modules/health/health.routes.js';

export function buildApp() {
  const app = Fastify({ logger: true });
  app.register(healthRoutes);
  return app;
}
