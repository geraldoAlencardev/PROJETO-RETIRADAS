import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tx, comandos, estado } = vi.hoisted(() => ({
  tx: { $queryRaw: vi.fn(), $executeRaw: vi.fn() },
  comandos: [] as { sql: string; valores: unknown[] }[],
  estado: {
    status: 'EM_CONTATO' as string | null,
    vigente: null as { dataPrevista: string; horario: string | null } | null,
  },
}));

vi.mock('../../shared/prisma.js', () => ({
  prisma: { $transaction: (fn: (t: unknown) => unknown) => fn(tx) },
}));
vi.mock('../os/os.service.js', async () => {
  const real = await vi.importActual<typeof import('../os/os.service.js')>('../os/os.service.js');
  return { ...real, aplicarEvento: vi.fn() };
});

import { aplicarEvento, OsNaoEncontradaError, TransicaoInvalidaError } from '../os/os.service.js';
import {
  agendar,
  AgendamentoInvalidoError,
  reverterAgendamento,
  SemAgendamentoVigenteError,
} from './agendamento.service.js';

const OS_ID = '22222222-2222-2222-2222-222222222222';
const USUARIO_ID = '11111111-1111-1111-1111-111111111111';

const sqls = () => comandos.map((c) => c.sql);
const historico = () => comandos.find((c) => c.sql.includes('INSERT INTO historico_evento'))!;

beforeEach(() => {
  comandos.length = 0;
  estado.status = 'EM_CONTATO';
  estado.vigente = null;
  vi.mocked(aplicarEvento).mockReset();
  vi.mocked(aplicarEvento).mockResolvedValue({ de: 'EM_CONTATO', para: 'AGENDADA', codigo: 'T03' });
  tx.$queryRaw.mockReset();
  tx.$executeRaw.mockReset();

  tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...valores: unknown[]) => {
    const sql = strings.join('?');
    comandos.push({ sql, valores });
    if (sql.includes('FOR UPDATE')) return estado.status ? [{ status: estado.status }] : [];
    if (sql.includes('INSERT INTO agendamento')) {
      return [
        {
          id: '44444444-4444-4444-4444-444444444444',
          dataPrevista: valores[2],
          horario: valores[3],
          dataHoraRegistro: new Date('2026-10-29T12:00:00Z'),
          tipoMotivo: valores[4],
          motivoDetalhe: valores[5],
        },
      ];
    }
    if (sql.includes('UPDATE agendamento')) return estado.vigente ? [estado.vigente] : [];
    if (sql.includes('FROM agendamento')) return estado.vigente ? [estado.vigente] : [];
    return [];
  });
  tx.$executeRaw.mockImplementation(
    async (strings: TemplateStringsArray, ...valores: unknown[]) => {
      comandos.push({ sql: strings.join('?'), valores });
      return 1;
    },
  );
});

describe('agendar', () => {
  it('primeiro agendamento: trava a OS, grava a data, o histórico e aplica AGENDAR (T03)', async () => {
    const r = await agendar({
      osId: OS_ID,
      usuarioId: USUARIO_ID,
      dataPrevista: '2026-11-03',
      horario: '14:30',
    });

    expect(r.agendamento).toMatchObject({
      dataPrevista: '2026-11-03',
      horario: '14:30',
      tipoMotivo: null,
    });
    expect(r.transicao).toEqual({ de: 'EM_CONTATO', para: 'AGENDADA', codigo: 'T03' });
    expect(historico().valores).toContain('AGENDAMENTO');
    expect(historico().valores).toContain('Retirada agendada para 03/11/2026 às 14:30');
    expect(aplicarEvento).toHaveBeenCalledWith(tx, {
      osId: OS_ID,
      usuarioId: USUARIO_ID,
      evento: { tipo: 'AGENDAR' },
      motivo: undefined,
    });
    expect(sqls().some((s) => s.includes('log_alteracao'))).toBe(false);

    const ordem = ['FOR UPDATE', 'INSERT INTO agendamento', 'INSERT INTO historico_evento'];
    const posicoes = ordem.map((trecho) => sqls().findIndex((s) => s.includes(trecho)));
    expect(posicoes).toEqual([...posicoes].sort((a, b) => a - b));
  });

  it('reagendamento (OS já AGENDADA): exige o motivo, descreve de/para e grava no log (T08)', async () => {
    estado.status = 'AGENDADA';
    estado.vigente = { dataPrevista: '2026-11-03', horario: null };
    vi.mocked(aplicarEvento).mockResolvedValue({ de: 'AGENDADA', para: 'AGENDADA', codigo: 'T08' });

    await agendar({
      osId: OS_ID,
      usuarioId: USUARIO_ID,
      dataPrevista: '2026-11-05',
      tipoMotivo: 'CLIENTE',
      motivoDetalhe: 'Cliente viaja',
    });

    expect(historico().valores).toContain(
      'Retirada reagendada de 03/11/2026 para 05/11/2026 (motivo: CLIENTE)',
    );
    const log = comandos.find((c) => c.sql.includes('INSERT INTO log_alteracao'))!;
    expect(log.valores).toEqual([OS_ID, USUARIO_ID, '03/11/2026', '05/11/2026']);
    expect(aplicarEvento).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ evento: { tipo: 'REAGENDAR' }, motivo: 'Cliente viaja' }),
    );
  });

  it('recusa reagendamento sem tipoMotivo, antes de gravar', async () => {
    estado.status = 'AGENDADA';
    await expect(
      agendar({ osId: OS_ID, usuarioId: USUARIO_ID, dataPrevista: '2026-11-05' }),
    ).rejects.toBeInstanceOf(AgendamentoInvalidoError);
    expect(sqls().some((s) => s.includes('INSERT'))).toBe(false);
  });

  it('recusa tipoMotivo no primeiro agendamento', async () => {
    await expect(
      agendar({
        osId: OS_ID,
        usuarioId: USUARIO_ID,
        dataPrevista: '2026-11-05',
        tipoMotivo: 'EMPRESA',
      }),
    ).rejects.toBeInstanceOf(AgendamentoInvalidoError);
  });

  it('OS inexistente', async () => {
    estado.status = null;
    await expect(
      agendar({ osId: OS_ID, usuarioId: USUARIO_ID, dataPrevista: '2026-11-05' }),
    ).rejects.toBeInstanceOf(OsNaoEncontradaError);
  });

  it('propaga a recusa da máquina de estados (a transação desfaz o que foi gravado)', async () => {
    estado.status = 'EM_EXTRAVIO';
    vi.mocked(aplicarEvento).mockRejectedValue(new TransicaoInvalidaError('não permitido'));
    await expect(
      agendar({ osId: OS_ID, usuarioId: USUARIO_ID, dataPrevista: '2026-11-05' }),
    ).rejects.toBeInstanceOf(TransicaoInvalidaError);
  });
});

describe('reverterAgendamento', () => {
  it('aplica T07, desmarca o agendamento vigente e registra no histórico com o motivo', async () => {
    estado.vigente = { dataPrevista: '2026-11-03', horario: '09:00' };
    vi.mocked(aplicarEvento).mockResolvedValue({
      de: 'AGENDADA',
      para: 'EM_CONTATO',
      codigo: 'T07',
    });

    const t = await reverterAgendamento({
      osId: OS_ID,
      usuarioId: USUARIO_ID,
      motivo: 'Cliente desistiu',
    });

    expect(t).toEqual({ de: 'AGENDADA', para: 'EM_CONTATO', codigo: 'T07' });
    expect(aplicarEvento).toHaveBeenCalledWith(tx, {
      osId: OS_ID,
      usuarioId: USUARIO_ID,
      evento: { tipo: 'REVERTER_AGENDAMENTO' },
      motivo: 'Cliente desistiu',
    });
    expect(sqls().some((s) => s.includes('SET vigente = false'))).toBe(true);
    expect(historico().valores).toEqual(
      expect.arrayContaining(['Agendamento de 03/11/2026 às 09:00 revertido', 'Cliente desistiu']),
    );
  });

  it('sem agendamento vigente: erro (e a transação desfaz a mudança de status)', async () => {
    vi.mocked(aplicarEvento).mockResolvedValue({
      de: 'AGENDADA',
      para: 'EM_CONTATO',
      codigo: 'T07',
    });
    await expect(
      reverterAgendamento({ osId: OS_ID, usuarioId: USUARIO_ID, motivo: 'x' }),
    ).rejects.toBeInstanceOf(SemAgendamentoVigenteError);
  });
});
