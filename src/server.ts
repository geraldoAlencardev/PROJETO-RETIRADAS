import { buildApp } from './app.js';
import { env } from './config/env.js';
import { iniciarRotinaPrazos } from './modules/prazos/rotina.js';
import { prisma } from './shared/prisma.js';

const app = buildApp();

let pararRotinaPrazos: (() => void) | undefined;

app.addHook('onReady', async () => {
  if (env.ROTINA_PRAZOS_MINUTOS > 0) {
    pararRotinaPrazos = iniciarRotinaPrazos(app.log, env.ROTINA_PRAZOS_MINUTOS);
  }
});

app.addHook('onClose', async () => {
  pararRotinaPrazos?.();
  await prisma.$disconnect();
});

app.listen({ port: env.PORT, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
