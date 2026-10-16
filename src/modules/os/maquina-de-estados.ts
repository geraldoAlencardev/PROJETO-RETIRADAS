// Máquina de estados da OS (RN06 e mapa de transições T01–T15).
// Função pura: dado o status atual e um evento, diz se a transição é permitida e para onde vai.
// Não acessa o banco, o que a torna fácil de testar. Quem aplica o resultado é o os.service.
import type { StatusOs } from './status.js';

/** Quantidade de tentativas sem sucesso (no ciclo) que leva a OS para Em extravio (RN02). */
export const FALHAS_PARA_EXTRAVIO = 3;

export type EventoOs =
  // `falhasCiclo` é o valor do contador oculto DEPOIS de registrar esta tentativa.
  | { tipo: 'TENTATIVA_CONTATO'; sucesso: boolean; falhasCiclo: number }
  | { tipo: 'AGENDAR' }
  | { tipo: 'REAGENDAR' }
  | { tipo: 'REVERTER_AGENDAMENTO' }
  | { tipo: 'CONCLUIR_RETIRADA' }
  | { tipo: 'MARCAR_ATRASADA' }
  | { tipo: 'GERAR_MULTA' }
  | { tipo: 'INICIAR_REATIVACAO' }
  | { tipo: 'CONCLUIR_REATIVACAO' }
  | { tipo: 'EXPIRAR_REATIVACAO' };

export type TipoEvento = EventoOs['tipo'];

export type ResultadoTransicao =
  | {
      ok: true;
      de: StatusOs;
      para: StatusOs;
      /** Código do mapa de transições (T01...). Nulo quando a OS permanece no mesmo status. */
      codigo: string | null;
      /** Quando verdadeiro, o contador oculto de falhas deve voltar a zero. */
      reiniciaCicloFalhas: boolean;
    }
  | { ok: false; motivo: string };

export const STATUS_FINAIS: readonly StatusOs[] = [
  'RETIRADA_OK',
  'REATIVACAO_CONCLUIDA',
  'MULTA_GERADA',
];

interface RegraSimples {
  para: StatusOs;
  /** Status de origem permitidos e o código da transição correspondente. */
  origens: Partial<Record<StatusOs, string>>;
}

const REGRAS: Record<Exclude<TipoEvento, 'TENTATIVA_CONTATO'>, RegraSimples> = {
  // T03: o agendamento leva a OS para AGENDADA.
  AGENDAR: {
    para: 'AGENDADA',
    origens: { PENDENTE: 'T03', EM_CONTATO: 'T03', ATRASADA: 'T03' },
  },
  // T08: reagendamento mantém o status (o histórico de datas fica na tabela agendamento, RN04).
  REAGENDAR: { para: 'AGENDADA', origens: { AGENDADA: 'T08' } },
  // T07: reversão do agendamento (RN01).
  REVERTER_AGENDAMENTO: { para: 'EM_CONTATO', origens: { AGENDADA: 'T07' } },
  // T09
  CONCLUIR_RETIRADA: { para: 'RETIRADA_OK', origens: { AGENDADA: 'T09' } },
  // T02 e T05: calculado automaticamente (RN03).
  MARCAR_ATRASADA: { para: 'ATRASADA', origens: { PENDENTE: 'T02', EM_CONTATO: 'T05' } },
  // T10
  GERAR_MULTA: { para: 'MULTA_GERADA', origens: { EM_EXTRAVIO: 'T10' } },
  // T11
  INICIAR_REATIVACAO: { para: 'EM_REATIVACAO', origens: { EM_EXTRAVIO: 'T11' } },
  // T13
  CONCLUIR_REATIVACAO: { para: 'REATIVACAO_CONCLUIDA', origens: { EM_REATIVACAO: 'T13' } },
  // T12: timeout de 5 dias úteis (RN11); volta para Pendente e recomeça o ciclo de falhas.
  EXPIRAR_REATIVACAO: { para: 'PENDENTE', origens: { EM_REATIVACAO: 'T12' } },
};

const ORIGENS_TENTATIVA: readonly StatusOs[] = ['PENDENTE', 'EM_CONTATO', 'ATRASADA'];

function recusar(motivo: string): ResultadoTransicao {
  return { ok: false, motivo };
}

export function decidirTransicao(status: StatusOs, evento: EventoOs): ResultadoTransicao {
  if (STATUS_FINAIS.includes(status)) {
    return recusar(`A OS está em ${status}, que é um status final.`);
  }

  if (evento.tipo === 'TENTATIVA_CONTATO') {
    if (!ORIGENS_TENTATIVA.includes(status)) {
      return recusar(`Não é possível registrar tentativa de contato com a OS em ${status}.`);
    }
    // 3ª falha do ciclo: Em extravio (T04). Também vale a partir de Atrasada.
    if (!evento.sucesso && evento.falhasCiclo >= FALHAS_PARA_EXTRAVIO) {
      return {
        ok: true,
        de: status,
        para: 'EM_EXTRAVIO',
        codigo: 'T04',
        reiniciaCicloFalhas: false,
      };
    }
    // Primeira tentativa (T01) ou nova tentativa de uma OS atrasada (T06) levam a Em contato.
    const codigo = status === 'PENDENTE' ? 'T01' : status === 'ATRASADA' ? 'T06' : null;
    return { ok: true, de: status, para: 'EM_CONTATO', codigo, reiniciaCicloFalhas: false };
  }

  const regra = REGRAS[evento.tipo];
  const codigo = regra.origens[status];
  if (codigo === undefined) {
    return recusar(`A ação ${evento.tipo} não é permitida com a OS em ${status}.`);
  }
  return {
    ok: true,
    de: status,
    para: regra.para,
    codigo,
    reiniciaCicloFalhas: evento.tipo === 'EXPIRAR_REATIVACAO',
  };
}
