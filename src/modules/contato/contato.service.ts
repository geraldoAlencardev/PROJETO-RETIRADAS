import type { Executor } from '../../shared/db.js';
import { prisma } from '../../shared/prisma.js';
import { aplicarEvento, OsNaoEncontradaError, type TransicaoAplicada } from '../os/os.service.js';
import type { Canal } from './canal.js';

export interface TentativaRegistrada {
  id: string;
  dataHora: Date;
  canal: Canal;
  sucesso: boolean;
  observacao: string | null;
}

interface PedidoTentativa {
  osId: string;
  usuarioId: string;
  canal: Canal;
  sucesso: boolean;
  observacao?: string;
}

/**
 * Registra uma tentativa de contato (RF10) e atualiza o status da OS, tudo na mesma transação:
 *  1. trava a OS (FOR UPDATE);
 *  2. insere a tentativa — o trigger do banco atualiza os contadores (total, sem sucesso e o
 *     contador oculto do ciclo) e a data da última interação;
 *  3. lê o contador oculto já atualizado;
 *  4. registra a tentativa no histórico;
 *  5. pede à máquina de estados o novo status (T01, T04 ou T06).
 * Se a máquina recusar (ex.: OS já agendada), o erro desfaz a transação inteira, inclusive a
 * tentativa que acabou de ser inserida.
 */
export function registrarTentativa(
  pedido: PedidoTentativa,
): Promise<{ tentativa: TentativaRegistrada; transicao: TransicaoAplicada }> {
  return prisma.$transaction(async (tx: Executor) => {
    const { osId, usuarioId, canal, sucesso } = pedido;
    const observacao = pedido.observacao ?? null;

    const trava = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM os WHERE id = ${osId}::uuid FOR UPDATE`;
    if (!trava[0]) throw new OsNaoEncontradaError();

    const inseridas = await tx.$queryRaw<TentativaRegistrada[]>`
      INSERT INTO tentativa_contato (os_id, usuario_id, canal, sucesso, observacao)
      VALUES (${osId}::uuid, ${usuarioId}::uuid, ${canal}::canal_contato, ${sucesso}::boolean,
              ${observacao})
      RETURNING id, data_hora AS "dataHora", canal::text AS canal, sucesso, observacao`;
    const tentativa = inseridas[0]!;

    const contadores = await tx.$queryRaw<{ falhasCiclo: number }[]>`
      SELECT qtd_falhas_ciclo AS "falhasCiclo" FROM os WHERE id = ${osId}::uuid`;
    const falhasCiclo = contadores[0]!.falhasCiclo;

    const resultado = sucesso ? 'com sucesso' : 'sem sucesso';
    const descricao = `Tentativa de contato por ${canal}: ${resultado}${observacao ? ` — ${observacao}` : ''}`;
    await tx.$executeRaw`
      INSERT INTO historico_evento (os_id, usuario_id, data_hora, tipo_evento, descricao)
      VALUES (${osId}::uuid, ${usuarioId}::uuid, clock_timestamp(), 'TENTATIVA_CONTATO',
              ${descricao})`;

    const transicao = await aplicarEvento(tx, {
      osId,
      usuarioId,
      evento: { tipo: 'TENTATIVA_CONTATO', sucesso, falhasCiclo },
    });

    return { tentativa, transicao };
  });
}
