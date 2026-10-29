import { describe, expect, it } from 'vitest';
import { CalendarioUtil } from '../feriado/dias-uteis.js';
import { STATUS_OS } from '../os/status.js';
import { eventoDoPrazo, prazoVencido } from './regras.js';

const TZ = 'America/Bahia';
// 15:00 em Salvador (UTC-3) = 18:00 UTC
const em = (data: string) => new Date(`${data}T18:00:00Z`);

// Outubro/2026: 02 = sexta, 05 = segunda, 09 = sexta, 12 = segunda
describe('prazoVencido (5 dias úteis)', () => {
  const semFeriados = new CalendarioUtil(new Set());

  it('vence no 5º dia útil seguinte à referência', () => {
    expect(prazoVencido(semFeriados, em('2026-10-02'), em('2026-10-08'), TZ)).toBe(false); // 4
    expect(prazoVencido(semFeriados, em('2026-10-02'), em('2026-10-09'), TZ)).toBe(true); // 5
  });

  it('não conta fim de semana', () => {
    // sex 02 → seg 05 é só 1 dia útil
    expect(prazoVencido(semFeriados, em('2026-10-02'), em('2026-10-05'), TZ)).toBe(false);
  });

  it('não conta feriado', () => {
    const comFeriado = new CalendarioUtil(new Set(['2026-10-12']));
    // sex 09 + 5 dias úteis pulando seg 12 (feriado): ter 13, qua 14, qui 15, sex 16, seg 19
    expect(prazoVencido(comFeriado, em('2026-10-09'), em('2026-10-16'), TZ)).toBe(false);
    expect(prazoVencido(comFeriado, em('2026-10-09'), em('2026-10-19'), TZ)).toBe(true);
  });

  it('usa a data no fuso de negócio, não em UTC', () => {
    // 01:30 UTC de sáb 03 ainda é sex 02 em Salvador
    const referencia = new Date('2026-10-03T01:30:00Z');
    expect(prazoVencido(semFeriados, referencia, em('2026-10-09'), TZ)).toBe(true);
  });
});

describe('eventoDoPrazo', () => {
  it('Pendente e Em contato ficam Atrasada; Em reativação expira', () => {
    expect(eventoDoPrazo('PENDENTE')).toEqual({ tipo: 'MARCAR_ATRASADA' });
    expect(eventoDoPrazo('EM_CONTATO')).toEqual({ tipo: 'MARCAR_ATRASADA' });
    expect(eventoDoPrazo('EM_REATIVACAO')).toEqual({ tipo: 'EXPIRAR_REATIVACAO' });
  });

  it('os demais status não têm prazo automático', () => {
    const comPrazo = ['PENDENTE', 'EM_CONTATO', 'EM_REATIVACAO'];
    for (const status of STATUS_OS.filter((s) => !comPrazo.includes(s))) {
      expect(eventoDoPrazo(status)).toBeNull();
    }
  });
});
