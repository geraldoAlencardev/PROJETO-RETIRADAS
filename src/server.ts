import { buildApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './shared/prisma.js';

const app = buildApp();

app.addHook('onClose', async () => {
  await prisma.$disconnect();
});

app.listen({ port: env.PORT, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
