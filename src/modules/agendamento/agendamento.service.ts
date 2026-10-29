import type { Executor } from '../../shared/db.js';
import { prisma } from '../../shared/prisma.js';
import { aplicarEvento, OsNaoEncontradaError, type TransicaoAplicada } from '../os/os.service.js';
import type { StatusOs } from '../os/status.js';
import type { TipoMotivo } from './motivo.js';

/** Pedido coerente no formato, mas incompatível com a situação da OS (vira 400 na rota). */
export class AgendamentoInvalidoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'AgendamentoInvalidoError';
  }
}

export class SemAgendamentoVigenteError extends Error {
  constructor() {
    super('A OS não tem agendamento vigente.');
    this.name = 'SemAgendamentoVigenteError';
  }
}

export interface AgendamentoRegistrado {
  id: string;
  dataPrevista: string;
  horario: string | null;
  dataHoraRegistro: Date;
  tipoMotivo: TipoMotivo | null;
  motivoDetalhe: string | null;
}

interface PedidoAgendamento {
  osId: string;
  usuarioId: string;
  /** 'YYYY-MM-DD' */
  dataPrevista: string;
  /** 'HH:MM' */
  horario?: string;
  tipoMotivo?: TipoMotivo;
  motivoDetalhe?: string;
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY', para as descrições do histórico. */
function dataBr(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

function quando(dataPrevista: string, horario: string | null | undefined): string {
  return `${dataBr(dataPrevista)}${horario ? ` às ${horario}` : ''}`;
}

/**
 * Agenda (T03) ou reagenda (T08) a retirada, conforme o status atual da OS:
 *  - OS em AGENDADA → reagendamento: exige `tipoMotivo` (cliente ou empresa, RN04);
 *  - outros status → primeiro agendamento: `tipoMotivo` não se aplica.
 * Cada chamada grava uma nova linha em `agendamento`; o trigger do banco desmarca a anterior,
 * mantendo o histórico completo (RN04). A máquina de estados recusa status em que não se agenda.
 */
export function agendar(
  pedido: PedidoAgendamento,
): Promise<{ agendamento: AgendamentoRegistrado; transicao: TransicaoAplicada }> {
  return prisma.$transaction(async (tx: Executor) => {
    const { osId, usuarioId, dataPrevista } = pedido;
    const horario = pedido.horario ?? null;
    const tipoMotivo = pedido.tipoMotivo ?? null;
    const motivoDetalhe = pedido.motivoDetalhe ?? null;

    const linhas = await tx.$queryRaw<{ status: StatusOs }[]>`
      SELECT status::text AS status FROM os WHERE id = ${osId}::uuid FOR UPDATE`;
    const atual = linhas[0];
    if (!atual) throw new OsNaoEncontradaError();

    const reagendamento = atual.status === 'AGENDADA';
    if (reagendamento && !tipoMotivo) {
      throw new AgendamentoInvalidoError(
        'Informe quem motivou o reagendamento (tipoMotivo: CLIENTE ou EMPRESA).',
      );
    }
    if (!reagendamento && tipoMotivo) {
      throw new AgendamentoInvalidoError('tipoMotivo só se aplica a reagendamento.');
    }

    // Data vigente antes deste registro (só existe no reagendamento), para o histórico e o log.
    const anteriores = reagendamento
      ? await tx.$queryRaw<{ dataPrevista: string; horario: string | null }[]>`
          SELECT to_char(data_prevista, 'YYYY-MM-DD') AS "dataPrevista",
                 to_char(horario, 'HH24:MI')          AS horario
            FROM agendamento
           WHERE os_id = ${osId}::uuid AND vigente`
      : [];
    const anterior = anteriores[0];

    const inseridos = await tx.$queryRaw<AgendamentoRegistrado[]>`
      INSERT INTO agendamento (os_id, usuario_id, data_prevista, horario, vigente,
                               tipo_motivo, motivo_detalhe)
      VALUES (${osId}::uuid, ${usuarioId}::uuid, ${dataPrevista}::date, ${horario}::time, true,
              ${tipoMotivo}::tipo_motivo_reagendamento, ${motivoDetalhe})
      RETURNING id,
                to_char(data_prevista, 'YYYY-MM-DD') AS "dataPrevista",
                to_char(horario, 'HH24:MI')          AS horario,
                data_hora_registro                   AS "dataHoraRegistro",
                tipo_motivo::text                    AS "tipoMotivo",
                motivo_detalhe                       AS "motivoDetalhe"`;
    const agendamento = inseridos[0]!;

    const novo = quando(dataPrevista, horario);
    const descricao = reagendamento
      ? `Retirada reagendada${anterior ? ` de ${quando(anterior.dataPrevista, anterior.horario)}` : ''} para ${novo} (motivo: ${tipoMotivo})`
      : `Retirada agendada para ${novo}`;
    await tx.$executeRaw`
      INSERT INTO historico_evento (os_id, usuario_id, data_hora, tipo_evento, descricao, motivo)
      VALUES (${osId}::uuid, ${usuarioId}::uuid, clock_timestamp(),
              ${reagendamento ? 'REAGENDAMENTO' : 'AGENDAMENTO'}, ${descricao}, ${motivoDetalhe})`;

    if (reagendamento) {
      await tx.$executeRaw`
        INSERT INTO log_alteracao (os_id, usuario_id, campo_alterado, valor_anterior, valor_novo)
        VALUES (${osId}::uuid, ${usuarioId}::uuid, 'agendamento.data_prevista',
                ${anterior ? quando(anterior.dataPrevista, anterior.horario) : null}, ${novo})`;
    }

    const transicao = await aplicarEvento(tx, {
      osId,
      usuarioId,
      evento: { tipo: reagendamento ? 'REAGENDAR' : 'AGENDAR' },
      motivo: motivoDetalhe ?? undefined,
    });

    return { agendamento, transicao };
  });
}

/**
 * Reverte o agendamento (T07, RN01): a OS volta para Em contato e o agendamento vigente deixa
 * de valer (continua no histórico). O motivo é obrigatório e vai para o histórico.
 */
export function reverterAgendamento(pedido: {
  osId: string;
  usuarioId: string;
  motivo: string;
}): Promise<TransicaoAplicada> {
  return prisma.$transaction(async (tx: Executor) => {
    const { osId, usuarioId, motivo } = pedido;

    // Trava a OS e valida que está em AGENDADA antes de mexer no agendamento.
    const transicao = await aplicarEvento(tx, {
      osId,
      usuarioId,
      evento: { tipo: 'REVERTER_AGENDAMENTO' },
      motivo,
    });

    const desmarcados = await tx.$queryRaw<{ dataPrevista: string; horario: string | null }[]>`
      UPDATE agendamento
         SET vigente = false
       WHERE os_id = ${osId}::uuid AND vigente
      RETURNING to_char(data_prevista, 'YYYY-MM-DD') AS "dataPrevista",
                to_char(horario, 'HH24:MI')          AS horario`;
    const desmarcado = desmarcados[0];
    if (!desmarcado) throw new SemAgendamentoVigenteError();

    await tx.$executeRaw`
      INSERT INTO historico_evento (os_id, usuario_id, data_hora, tipo_evento, descricao, motivo)
      VALUES (${osId}::uuid, ${usuarioId}::uuid, clock_timestamp(), 'REVERSAO_AGENDAMENTO',
              ${`Agendamento de ${quando(desmarcado.dataPrevista, desmarcado.horario)} revertido`},
              ${motivo})`;

    return transicao;
  });
}
