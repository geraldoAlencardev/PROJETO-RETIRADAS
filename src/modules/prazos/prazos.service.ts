import { env } from '../../config/env.js';
import type { Executor } from '../../shared/db.js';
import { prisma } from '../../shared/prisma.js';
import { CalendarioUtil, dataLocal } from '../feriado/dias-uteis.js';
import { carregarFeriados } from '../feriado/feriado.repository.js';
import { aplicarEvento, TransicaoInvalidaError } from '../os/os.service.js';
import type { StatusOs } from '../os/status.js';
import { eventoDoPrazo, PRAZO_DIAS_UTEIS, prazoVencido } from './regras.js';

export interface ResumoPrazos {
  verificadas: number;
  atrasadas: number;
  reativacoesExpiradas: number;
  /** OS em que a aplicação falhou por erro inesperado (as demais seguem normalmente). */
  comErro: number;
}

interface Candidata {
  id: string;
  status: StatusOs;
  referencia: Date;
}

// Referência do prazo:
//  - Pendente / Em contato: a mais recente entre a última interação e a entrada no status
//    (uma OS que acabou de voltar da reativação não fica atrasada pela interação antiga);
//  - Em reativação: a entrada no status.
// GREATEST ignora NULL, então uma OS sem nenhuma tentativa usa a entrada no status.
// Atenção: a expressão da referência é idêntica nas duas consultas abaixo.

/**
 * Aplica os eventos automáticos de prazo (Atrasada T02/T05 e timeout da reativação T12).
 * É idempotente e seguro de rodar em paralelo: cada OS é travada e reavaliada na própria
 * transação antes de mudar, então uma tentativa registrada no meio do caminho é respeitada.
 */
export async function processarPrazos(agora: Date = new Date()): Promise<ResumoPrazos> {
  const tz = env.TZ_NEGOCIO;

  // Pré-filtro barato: N dias úteis nunca são menos que N dias corridos.
  const candidatas = await prisma.$queryRaw<Candidata[]>`
    SELECT id, status::text AS status, referencia
      FROM (SELECT id, status,
                   CASE WHEN status = 'EM_REATIVACAO' THEN data_entrada_status
                        ELSE GREATEST(data_ultima_interacao, data_entrada_status) END AS referencia
              FROM os
             WHERE status IN ('PENDENTE', 'EM_CONTATO', 'EM_REATIVACAO')) c
     WHERE referencia < ${agora}::timestamptz - make_interval(days => ${PRAZO_DIAS_UTEIS}::int)`;

  const resumo: ResumoPrazos = {
    verificadas: candidatas.length,
    atrasadas: 0,
    reativacoesExpiradas: 0,
    comErro: 0,
  };
  if (candidatas.length === 0) return resumo;

  const maisAntiga = candidatas.reduce(
    (min, c) => (c.referencia < min ? c.referencia : min),
    agora,
  );
  const calendario = new CalendarioUtil(
    await carregarFeriados(dataLocal(maisAntiga, tz), dataLocal(agora, tz)),
  );

  for (const candidata of candidatas) {
    if (!prazoVencido(calendario, candidata.referencia, agora, tz)) continue;
    try {
      const aplicado = await prisma.$transaction(async (tx: Executor) => {
        // Reavalia com a linha travada: o status ou a última interação podem ter mudado.
        const linhas = await tx.$queryRaw<{ status: StatusOs; referencia: Date }[]>`
          SELECT status::text AS status,
                 CASE WHEN status = 'EM_REATIVACAO' THEN data_entrada_status
                      ELSE GREATEST(data_ultima_interacao, data_entrada_status) END AS referencia
            FROM os
           WHERE id = ${candidata.id}::uuid
             FOR UPDATE`;
        const atual = linhas[0];
        if (!atual || !prazoVencido(calendario, atual.referencia, agora, tz)) return null;
        const evento = eventoDoPrazo(atual.status);
        if (!evento) return null;

        await aplicarEvento(tx, {
          osId: candidata.id,
          usuarioId: null,
          evento,
          motivo: `Prazo de ${PRAZO_DIAS_UTEIS} dias úteis vencido`,
        });
        return evento.tipo;
      });
      if (aplicado === 'MARCAR_ATRASADA') resumo.atrasadas++;
      if (aplicado === 'EXPIRAR_REATIVACAO') resumo.reativacoesExpiradas++;
    } catch (erro) {
      if (erro instanceof TransicaoInvalidaError) continue;
      resumo.comErro++;
    }
  }

  return resumo;
}
