import type { Executor } from '../../shared/db.js';
import { prisma } from '../../shared/prisma.js';
import { decidirTransicao, type EventoOs } from './maquina-de-estados.js';
import type { StatusOs } from './status.js';

export class OsNaoEncontradaError extends Error {
  constructor() {
    super('OS não encontrada');
    this.name = 'OsNaoEncontradaError';
  }
}

export class TransicaoInvalidaError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'TransicaoInvalidaError';
  }
}

export interface TransicaoAplicada {
  de: StatusOs;
  para: StatusOs;
  codigo: string | null;
}

export interface PedidoEvento {
  osId: string;
  /** Nulo em eventos automáticos do sistema (sincronização com o IXC, prazos). */
  usuarioId: string | null;
  evento: EventoOs;
  /** Justificativa opcional, gravada no histórico. */
  motivo?: string;
}

const STATUS_DE_CONCLUSAO: readonly StatusOs[] = ['RETIRADA_OK', 'REATIVACAO_CONCLUIDA'];

/**
 * Ponto único que muda o status de uma OS. Deve rodar dentro de uma transação (`tx`):
 *  1. trava a linha da OS (FOR UPDATE), para duas ações simultâneas não se atropelarem;
 *  2. pergunta à máquina de estados se a transição é permitida;
 *  3. atualiza o status e grava o histórico (narrativa) e o log de alteração (auditoria).
 * Se o status não muda (ex.: reagendamento), nada é gravado aqui.
 */
export async function aplicarEvento(
  tx: Executor,
  pedido: PedidoEvento,
): Promise<TransicaoAplicada> {
  const { osId, usuarioId, evento, motivo } = pedido;

  const linhas = await tx.$queryRaw<{ status: StatusOs; qtdFalhasCiclo: number }[]>`
    SELECT status::text AS status, qtd_falhas_ciclo AS "qtdFalhasCiclo"
      FROM os
     WHERE id = ${osId}::uuid
       FOR UPDATE`;
  const atual = linhas[0];
  if (!atual) throw new OsNaoEncontradaError();

  const resultado = decidirTransicao(atual.status, evento);
  if (!resultado.ok) throw new TransicaoInvalidaError(resultado.motivo);

  const { de, para, codigo } = resultado;

  if (de !== para) {
    // O trigger do banco atualiza data_entrada_status sozinho.
    await tx.$executeRaw`UPDATE os SET status = ${para}::status_os WHERE id = ${osId}::uuid`;

    const tipoEvento = STATUS_DE_CONCLUSAO.includes(para) ? 'CONCLUSAO' : 'MUDANCA_STATUS';
    const descricao = `Status alterado de ${de} para ${para}${codigo ? ` (${codigo})` : ''}`;
    await tx.$executeRaw`
      INSERT INTO historico_evento (os_id, usuario_id, data_hora, tipo_evento, descricao, motivo)
      VALUES (${osId}::uuid, ${usuarioId}::uuid, clock_timestamp(), ${tipoEvento}, ${descricao},
              ${motivo ?? null})`;

    await tx.$executeRaw`
      INSERT INTO log_alteracao (os_id, usuario_id, campo_alterado, valor_anterior, valor_novo)
      VALUES (${osId}::uuid, ${usuarioId}::uuid, 'status', ${de}, ${para})`;
  }

  if (resultado.reiniciaCicloFalhas && atual.qtdFalhasCiclo !== 0) {
    await tx.$executeRaw`UPDATE os SET qtd_falhas_ciclo = 0 WHERE id = ${osId}::uuid`;
    await tx.$executeRaw`
      INSERT INTO log_alteracao (os_id, usuario_id, campo_alterado, valor_anterior, valor_novo)
      VALUES (${osId}::uuid, ${usuarioId}::uuid, 'qtd_falhas_ciclo',
              ${String(atual.qtdFalhasCiclo)}, '0')`;
  }

  return { de, para, codigo };
}

/** Versão que abre a própria transação, para quem só precisa aplicar um evento. */
export function executarEvento(pedido: PedidoEvento): Promise<TransicaoAplicada> {
  return prisma.$transaction((tx: Executor) => aplicarEvento(tx, pedido));
}
