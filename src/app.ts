import Fastify from 'fastify';
import { env } from './config/env.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { authPlugin } from './modules/usuarios/auth.plugin.js';
import { authRoutes } from './modules/usuarios/auth.routes.js';
import { osRoutes } from './modules/os/os.routes.js';

export function buildApp() {
  const app = Fastify({ logger: env.NODE_ENV !== 'test' });

  app.register(authPlugin);
  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(osRoutes);

  return app;
}
