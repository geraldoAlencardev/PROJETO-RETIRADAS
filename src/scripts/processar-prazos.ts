// Roda uma vez a rotina de prazos (Atrasada e timeout da reativação), fora do servidor.
// Uso: npm run prazos:processar
import { processarPrazos } from '../modules/prazos/prazos.service.js';
import { prisma } from '../shared/prisma.js';

processarPrazos()
  .then((r) =>
    console.log(
      `✔ ${r.verificadas} OS verificadas: ${r.atrasadas} atrasadas, ` +
        `${r.reativacoesExpiradas} reativações expiradas, ${r.comErro} com erro.`,
    ),
  )
  .catch((err: unknown) => {
    console.error(`✖ ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
