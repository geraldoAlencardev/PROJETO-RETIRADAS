import { prisma } from '../../shared/prisma.js';
import type { Canal } from './canal.js';

export interface Tentativa {
  id: string;
  dataHora: Date;
  canal: Canal;
  sucesso: boolean;
  observacao: string | null;
  usuarioNome: string;
}

/** Detalhamento de todas as tentativas de contato da OS (RF12), da mais antiga para a mais recente. */
export async function listarTentativas(osId: string): Promise<Tentativa[]> {
  return prisma.$queryRaw<Tentativa[]>`
    SELECT t.id,
           t.data_hora   AS "dataHora",
           t.canal::text AS canal,
           t.sucesso,
           t.observacao,
           u.nome        AS "usuarioNome"
      FROM tentativa_contato t
      JOIN usuario u ON u.id = t.usuario_id
     WHERE t.os_id = ${osId}::uuid
     ORDER BY t.data_hora, t.id`;
}
