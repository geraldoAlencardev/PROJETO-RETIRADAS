import { prisma } from '../../shared/prisma.js';
import { escaparLike } from '../../shared/like.js';
import { STATUS_OS, type StatusOs } from './status.js';

// Observações sobre o SQL direto (Prisma $queryRaw):
// - Os aliases entre aspas ("osExternaId") já devolvem as colunas em camelCase.
// - COUNT(*) vira bigint no Prisma; por isso o ::int.
// - Datas (`date`) saem como texto 'YYYY-MM-DD' (to_char) para evitar conversão de fuso.
// - Os filtros usam parâmetros que podem ser NULL ("sem filtro"), mantendo a consulta fixa.

export interface OsLinha {
  id: string;
  osExternaId: string;
  clienteNome: string;
  contratoId: string;
  bairro: string | null;
  endereco: string;
  dataAbertura: string;
  status: StatusOs;
  dataEntradaStatus: Date;
  dataUltimaInteracao: Date | null;
  qtdTentativasContato: number;
}

export interface AgendamentoVigente {
  dataPrevista: string;
  horario: string | null;
}

export interface OsDetalhe extends OsLinha {
  agendamentoVigente: AgendamentoVigente | null;
}

export interface FiltroOs {
  status?: StatusOs[];
  busca?: string;
  limite: number;
  deslocamento: number;
}

export async function listarOs(filtro: FiltroOs): Promise<{ itens: OsLinha[]; total: number }> {
  // Lista de status vira texto "A,B,C" (ou NULL); o SQL a transforma de volta em lista.
  const statusCsv = filtro.status?.length ? filtro.status.join(',') : null;
  const busca = filtro.busca ? `%${escaparLike(filtro.busca)}%` : null;

  // Atenção: o WHERE abaixo é idêntico nas duas consultas (itens da página e total).
  const [itens, contagem] = await Promise.all([
    prisma.$queryRaw<OsLinha[]>`
      SELECT id,
             os_externa_id                          AS "osExternaId",
             cliente_nome                           AS "clienteNome",
             contrato_id                            AS "contratoId",
             bairro,
             endereco,
             to_char(data_abertura, 'YYYY-MM-DD')   AS "dataAbertura",
             status::text                           AS status,
             data_entrada_status                    AS "dataEntradaStatus",
             data_ultima_interacao                  AS "dataUltimaInteracao",
             qtd_tentativas_contato                 AS "qtdTentativasContato"
        FROM os
       WHERE (${statusCsv}::text IS NULL
              OR status::text = ANY (string_to_array(${statusCsv}::text, ',')))
         AND (${busca}::text IS NULL
              OR cliente_nome ILIKE ${busca}::text
              OR contrato_id ILIKE ${busca}::text
              OR os_externa_id ILIKE ${busca}::text
              OR bairro ILIKE ${busca}::text)
       ORDER BY data_abertura, os_externa_id
       LIMIT ${filtro.limite}::int OFFSET ${filtro.deslocamento}::int`,
    prisma.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::int AS total
        FROM os
       WHERE (${statusCsv}::text IS NULL
              OR status::text = ANY (string_to_array(${statusCsv}::text, ',')))
         AND (${busca}::text IS NULL
              OR cliente_nome ILIKE ${busca}::text
              OR contrato_id ILIKE ${busca}::text
              OR os_externa_id ILIKE ${busca}::text
              OR bairro ILIKE ${busca}::text)`,
  ]);

  return { itens, total: contagem[0]?.total ?? 0 };
}

export async function contarPorStatus(): Promise<{
  total: number;
  porStatus: Record<StatusOs, number>;
}> {
  const linhas: { status: StatusOs; quantidade: number }[] = await prisma.$queryRaw`
    SELECT status::text AS status, COUNT(*)::int AS quantidade
      FROM os
     GROUP BY status`;

  // Todos os status aparecem na resposta, inclusive os que têm zero OS.
  const porStatus = Object.fromEntries(STATUS_OS.map((s) => [s, 0])) as Record<StatusOs, number>;
  for (const linha of linhas) porStatus[linha.status] = linha.quantidade;

  const total = Object.values(porStatus).reduce((soma, n) => soma + n, 0);
  return { total, porStatus };
}

export async function buscarOsPorId(id: string): Promise<OsDetalhe | null> {
  const linhas = await prisma.$queryRaw<OsLinha[]>`
    SELECT id,
           os_externa_id                          AS "osExternaId",
           cliente_nome                           AS "clienteNome",
           contrato_id                            AS "contratoId",
           bairro,
           endereco,
           to_char(data_abertura, 'YYYY-MM-DD')   AS "dataAbertura",
           status::text                           AS status,
           data_entrada_status                    AS "dataEntradaStatus",
           data_ultima_interacao                  AS "dataUltimaInteracao",
           qtd_tentativas_contato                 AS "qtdTentativasContato"
      FROM os
     WHERE id = ${id}::uuid`;
  const os = linhas[0];
  if (!os) return null;

  const agendamentos = await prisma.$queryRaw<AgendamentoVigente[]>`
    SELECT to_char(data_prevista, 'YYYY-MM-DD') AS "dataPrevista",
           to_char(horario, 'HH24:MI')          AS horario
      FROM agendamento
     WHERE os_id = ${id}::uuid AND vigente`;

  return { ...os, agendamentoVigente: agendamentos[0] ?? null };
}
