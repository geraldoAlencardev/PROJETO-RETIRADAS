import Fastify from 'fastify';
import { env } from './config/env.js';
import { agendamentoRoutes } from './modules/agendamento/agendamento.routes.js';
import { contatoRoutes } from './modules/contato/contato.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import type { FonteOsIxc } from './modules/integracao-ixc/fonte-ixc.js';
import { sincronizacaoRoutes } from './modules/integracao-ixc/sincronizacao.routes.js';
import { osRoutes } from './modules/os/os.routes.js';
import { authPlugin } from './modules/usuarios/auth.plugin.js';
import { authRoutes } from './modules/usuarios/auth.routes.js';
import { usuariosRoutes } from './modules/usuarios/usuarios.routes.js';

export interface OpcoesApp {
  /** Fonte das OS do IXC (somente leitura). Sem ela, a sincronização fica indisponível. */
  fonteOsIxc?: FonteOsIxc;
}

export function buildApp(opcoes: OpcoesApp = {}) {
  const app = Fastify({ logger: env.NODE_ENV !== 'test' });

  app.register(authPlugin);
  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(usuariosRoutes);
  app.register(osRoutes);
  app.register(contatoRoutes);
  app.register(agendamentoRoutes);
  app.register(sincronizacaoRoutes, { fonte: opcoes.fonteOsIxc });

  return app;
}
