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
  protocoloExterno: string | null;
  /** Nulo enquanto o nome não vier do cadastro de clientes do IXC. */
  clienteNome: string | null;
  clienteExternoId: string | null;
  contratoId: string;
  bairro: string | null;
  endereco: string;
  referencia: string | null;
  dataAbertura: string;
  status: StatusOs;
  /** Status do chamado no IXC (só consulta). */
  statusExterno: string | null;
  dataEntradaStatus: Date;
  dataUltimaInteracao: Date | null;
  qtdTentativasContato: number;
  /** Total acumulado de tentativas sem sucesso (nunca zera). */
  qtdTentativasSemSucesso: number;
  /** Falhas no ciclo atual; na 3ª a OS vai para Em extravio (RN02). */
  qtdFalhasCiclo: number;
  reagendamentosCliente: number;
  reagendamentosEmpresa: number;
  /** Data prevista do agendamento vigente ('YYYY-MM-DD'), se houver. */
  dataPrevista: string | null;
  horarioPrevisto: string | null;
  atualizadoEm: Date;
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
             protocolo_externo                      AS "protocoloExterno",
             cliente_nome                           AS "clienteNome",
             cliente_externo_id                     AS "clienteExternoId",
             contrato_id                            AS "contratoId",
             bairro,
             endereco,
             referencia,
             to_char(data_abertura, 'YYYY-MM-DD')   AS "dataAbertura",
             status::text                           AS status,
             status_externo                         AS "statusExterno",
             data_entrada_status                    AS "dataEntradaStatus",
             data_ultima_interacao                  AS "dataUltimaInteracao",
             qtd_tentativas_contato                 AS "qtdTentativasContato",
             qtd_tentativas_sem_sucesso             AS "qtdTentativasSemSucesso",
             qtd_falhas_ciclo                       AS "qtdFalhasCiclo",
             (SELECT COUNT(*)::int FROM agendamento a
               WHERE a.os_id = os.id AND a.tipo_motivo = 'CLIENTE') AS "reagendamentosCliente",
             (SELECT COUNT(*)::int FROM agendamento a
               WHERE a.os_id = os.id AND a.tipo_motivo = 'EMPRESA') AS "reagendamentosEmpresa",
             (SELECT to_char(a.data_prevista, 'YYYY-MM-DD') FROM agendamento a
               WHERE a.os_id = os.id AND a.vigente)             AS "dataPrevista",
             (SELECT to_char(a.horario, 'HH24:MI') FROM agendamento a
               WHERE a.os_id = os.id AND a.vigente)             AS "horarioPrevisto",
             atualizado_em                          AS "atualizadoEm"
        FROM os
       WHERE (${statusCsv}::text IS NULL
              OR status::text = ANY (string_to_array(${statusCsv}::text, ',')))
         AND (${busca}::text IS NULL
              OR cliente_nome ILIKE ${busca}::text
              OR contrato_id ILIKE ${busca}::text
              OR os_externa_id ILIKE ${busca}::text
              OR protocolo_externo ILIKE ${busca}::text
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
              OR protocolo_externo ILIKE ${busca}::text
              OR bairro ILIKE ${busca}::text)`,
  ]);

  return { itens, total: contagem[0]?.total ?? 0 };
}

export async function contarPorStatus(): Promise<{
  total: number;
  porStatus: Record<StatusOs, number>;
  /** Total de reagendamentos por quem motivou (RN04). */
  reagendamentos: { cliente: number; empresa: number };
}> {
  const linhas: { status: StatusOs; quantidade: number }[] = await prisma.$queryRaw`
    SELECT status::text AS status, COUNT(*)::int AS quantidade
      FROM os
     GROUP BY status`;

  // Todos os status aparecem na resposta, inclusive os que têm zero OS.
  const porStatus = Object.fromEntries(STATUS_OS.map((s) => [s, 0])) as Record<StatusOs, number>;
  for (const linha of linhas) porStatus[linha.status] = linha.quantidade;

  const total = Object.values(porStatus).reduce((soma, n) => soma + n, 0);

  const reag = await prisma.$queryRaw<{ tipo: 'CLIENTE' | 'EMPRESA'; quantidade: number }[]>`
    SELECT tipo_motivo::text AS tipo, COUNT(*)::int AS quantidade
      FROM agendamento
     WHERE tipo_motivo IS NOT NULL
     GROUP BY tipo_motivo`;
  const reagendamentos = { cliente: 0, empresa: 0 };
  for (const r of reag) reagendamentos[r.tipo === 'CLIENTE' ? 'cliente' : 'empresa'] = r.quantidade;

  return { total, porStatus, reagendamentos };
}

export async function buscarOsPorId(id: string): Promise<OsDetalhe | null> {
  const linhas = await prisma.$queryRaw<OsLinha[]>`
    SELECT id,
           os_externa_id                          AS "osExternaId",
           protocolo_externo                      AS "protocoloExterno",
           cliente_nome                           AS "clienteNome",
           cliente_externo_id                     AS "clienteExternoId",
           contrato_id                            AS "contratoId",
           bairro,
           endereco,
           referencia,
           to_char(data_abertura, 'YYYY-MM-DD')   AS "dataAbertura",
           status::text                           AS status,
           status_externo                         AS "statusExterno",
           data_entrada_status                    AS "dataEntradaStatus",
           data_ultima_interacao                  AS "dataUltimaInteracao",
           qtd_tentativas_contato                 AS "qtdTentativasContato",
           qtd_tentativas_sem_sucesso             AS "qtdTentativasSemSucesso",
           qtd_falhas_ciclo                       AS "qtdFalhasCiclo",
           (SELECT COUNT(*)::int FROM agendamento a
             WHERE a.os_id = os.id AND a.tipo_motivo = 'CLIENTE') AS "reagendamentosCliente",
           (SELECT COUNT(*)::int FROM agendamento a
             WHERE a.os_id = os.id AND a.tipo_motivo = 'EMPRESA') AS "reagendamentosEmpresa",
           (SELECT to_char(a.data_prevista, 'YYYY-MM-DD') FROM agendamento a
             WHERE a.os_id = os.id AND a.vigente)             AS "dataPrevista",
           (SELECT to_char(a.horario, 'HH24:MI') FROM agendamento a
             WHERE a.os_id = os.id AND a.vigente)             AS "horarioPrevisto",
           atualizado_em                          AS "atualizadoEm"
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

export interface EventoHistorico {
  id: string;
  dataHora: Date;
  tipoEvento: string;
  descricao: string;
  motivo: string | null;
  /** Nulo em eventos automáticos do sistema. */
  usuarioNome: string | null;
}

/** Linha do tempo da OS (RF25), do evento mais antigo para o mais recente. */
export async function listarHistorico(osId: string): Promise<EventoHistorico[]> {
  return prisma.$queryRaw<EventoHistorico[]>`
    SELECT h.id,
           h.data_hora    AS "dataHora",
           h.tipo_evento  AS "tipoEvento",
           h.descricao,
           h.motivo,
           u.nome         AS "usuarioNome"
      FROM historico_evento h
      LEFT JOIN usuario u ON u.id = h.usuario_id
     WHERE h.os_id = ${osId}::uuid
     ORDER BY h.data_hora, h.id`;
}
