import { describe, expect, it } from 'vitest';
import { CalendarioUtil, dataLocal } from './dias-uteis.js';

// Outubro/2026: 01 = quinta, 02 = sexta, 03 = sábado, 04 = domingo, 05 = segunda
describe('CalendarioUtil', () => {
  const cal = new CalendarioUtil(new Set(['2026-10-12'])); // segunda, feriado

  it('identifica dias úteis, fins de semana e feriados', () => {
    expect(cal.isDiaUtil('2026-10-02')).toBe(true);
    expect(cal.isDiaUtil('2026-10-03')).toBe(false);
    expect(cal.isDiaUtil('2026-10-04')).toBe(false);
    expect(cal.isDiaUtil('2026-10-12')).toBe(false);
  });

  it('soma dias úteis pulando fim de semana', () => {
    expect(cal.somarDiasUteis('2026-10-02', 1)).toBe('2026-10-05');
    expect(cal.somarDiasUteis('2026-10-01', 5)).toBe('2026-10-08');
  });

  it('soma dias úteis pulando feriado', () => {
    // sex 09 + 1 dia útil: sáb, dom e seg(feriado) são pulados → terça 13
    expect(cal.somarDiasUteis('2026-10-09', 1)).toBe('2026-10-13');
  });

  it('conta dias úteis em (inicio, fim]', () => {
    expect(cal.diasUteisEntre('2026-10-01', '2026-10-01')).toBe(0);
    expect(cal.diasUteisEntre('2026-10-02', '2026-10-05')).toBe(1);
    expect(cal.diasUteisEntre('2026-10-01', '2026-10-08')).toBe(5);
    expect(cal.diasUteisEntre('2026-10-09', '2026-10-13')).toBe(1);
  });

  it('é consistente: somar n e contar entre dá n', () => {
    const fim = cal.somarDiasUteis('2026-10-01', 7);
    expect(cal.diasUteisEntre('2026-10-01', fim)).toBe(7);
  });
});

describe('dataLocal', () => {
  it('converte instante UTC para a data no fuso de negócio', () => {
    // 01:30 UTC de 02/10 ainda é 22:30 de 01/10 em Salvador (UTC-3)
    expect(dataLocal(new Date('2026-10-02T01:30:00Z'), 'America/Bahia')).toBe('2026-10-01');
  });
});
