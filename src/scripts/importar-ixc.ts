// Importa OS a partir de um arquivo JSON no formato da resposta do IXC (su_oss_chamado),
// sem nenhuma chamada ao IXC. Útil em desenvolvimento e para cargas manuais.
// Aceita { "registros": [...] } (a resposta do IXC como vem) ou diretamente uma lista [...].
// Uso: npm run ixc:importar -- caminho/arquivo.json
import { readFile } from 'node:fs/promises';
import { importarRegistros } from '../modules/integracao-ixc/importacao.service.js';
import { prisma } from '../shared/prisma.js';

async function main() {
  const caminho = process.argv[2];
  if (!caminho) throw new Error('Uso: npm run ixc:importar -- <arquivo.json>');

  const conteudo: unknown = JSON.parse(await readFile(caminho, 'utf8'));
  const registros = Array.isArray(conteudo)
    ? conteudo
    : (conteudo as { registros?: unknown }).registros;
  if (!Array.isArray(registros)) {
    throw new Error('O arquivo deve ter uma lista "registros" ou ser uma lista de registros.');
  }

  const resumo = await importarRegistros(registros);
  console.log(
    `✔ ${resumo.recebidos} recebidos: ${resumo.criadas} criadas, ${resumo.atualizadas} atualizadas, ` +
      `${resumo.finalizadas} finalizadas, ${resumo.ignoradas} ignoradas, ${resumo.comErro} com erro.`,
  );
  for (const { osExternaId, erro } of resumo.erros) {
    console.log(`  ✖ OS ${osExternaId ?? '(sem id)'}: ${erro}`);
  }
}

main()
  .catch((err: unknown) => {
    console.error(`✖ ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
