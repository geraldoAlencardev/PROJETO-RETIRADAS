// Regras de prazo em dias úteis (RN03 e RN11). Funções puras, sem banco.
import { CalendarioUtil, dataLocal } from '../feriado/dias-uteis.js';
import type { EventoOs } from '../os/maquina-de-estados.js';
import type { StatusOs } from '../os/status.js';

/** Dias úteis sem interação para Atrasada (RN03) e de timeout de Em reativação (RN11). */
export const PRAZO_DIAS_UTEIS = 5;

/** Evento automático que o vencimento do prazo dispara em cada status (nulo = sem prazo). */
export function eventoDoPrazo(status: StatusOs): EventoOs | null {
  switch (status) {
    case 'PENDENTE':
    case 'EM_CONTATO':
      return { tipo: 'MARCAR_ATRASADA' }; // T02 / T05
    case 'EM_REATIVACAO':
      return { tipo: 'EXPIRAR_REATIVACAO' }; // T12
    default:
      return null;
  }
}

/**
 * O prazo venceu quando já se passaram PRAZO_DIAS_UTEIS dias úteis desde a referência.
 * As contas são feitas em datas de negócio (fuso TZ_NEGOCIO); o dia da referência não conta.
 * Ex.: interação na sexta 02/10 → vence na sexta 09/10 (5º dia útil seguinte), sem feriados.
 */
export function prazoVencido(
  calendario: CalendarioUtil,
  referencia: Date,
  agora: Date,
  timeZone: string,
): boolean {
  const dias = calendario.diasUteisEntre(
    dataLocal(referencia, timeZone),
    dataLocal(agora, timeZone),
  );
  return dias >= PRAZO_DIAS_UTEIS;
}
