import { prisma } from '../../shared/prisma.js';
import type { TipoMotivo } from './motivo.js';

export interface Agendamento {
  id: string;
  dataPrevista: string;
  horario: string | null;
  dataHoraRegistro: Date;
  vigente: boolean;
  /** Nulo no primeiro agendamento; preenchido nos reagendamentos (RN04). */
  tipoMotivo: TipoMotivo | null;
  motivoDetalhe: string | null;
  usuarioNome: string;
}

/** Histórico completo de datas propostas para a OS (RN04), da mais antiga para a mais recente. */
export async function listarAgendamentos(osId: string): Promise<Agendamento[]> {
  return prisma.$queryRaw<Agendamento[]>`
    SELECT a.id,
           to_char(a.data_prevista, 'YYYY-MM-DD') AS "dataPrevista",
           to_char(a.horario, 'HH24:MI')          AS horario,
           a.data_hora_registro                   AS "dataHoraRegistro",
           a.vigente,
           a.tipo_motivo::text                    AS "tipoMotivo",
           a.motivo_detalhe                       AS "motivoDetalhe",
           u.nome                                 AS "usuarioNome"
      FROM agendamento a
      JOIN usuario u ON u.id = a.usuario_id
     WHERE a.os_id = ${osId}::uuid
     ORDER BY a.data_hora_registro, a.id`;
}
