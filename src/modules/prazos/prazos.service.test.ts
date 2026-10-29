import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, tx, estado } = vi.hoisted(() => {
  const tx = { $queryRaw: vi.fn(), $executeRaw: vi.fn() };
  return {
    tx,
    prismaMock: {
      $queryRaw: vi.fn(),
      $transaction: (fn: (t: unknown) => unknown) => fn(tx),
    },
    estado: { travada: new Map<string, { status: string; referencia: Date }>() },
  };
});

vi.mock('../../shared/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../feriado/feriado.repository.js', () => ({ carregarFeriados: vi.fn() }));
vi.mock('../os/os.service.js', async () => {
  const real = await vi.importActual<typeof import('../os/os.service.js')>('../os/os.service.js');
  return { ...real, aplicarEvento: vi.fn() };
});

import { carregarFeriados } from '../feriado/feriado.repository.js';
import { aplicarEvento, TransicaoInvalidaError } from '../os/os.service.js';
import { processarPrazos } from './prazos.service.js';

// qui 29/10/2026, 15:00 em Salvador
const AGORA = new Date('2026-10-29T18:00:00Z');
const em = (data: string) => new Date(`${data}T18:00:00Z`);

function candidata(id: string, status: string, referencia: Date) {
  estado.travada.set(id, { status, referencia });
  return { id, status, referencia };
}

beforeEach(() => {
  estado.travada.clear();
  vi.mocked(carregarFeriados).mockReset().mockResolvedValue(new Set());
  vi.mocked(aplicarEvento)
    .mockReset()
    .mockResolvedValue({} as never);
  prismaMock.$queryRaw.mockReset().mockResolvedValue([]);
  tx.$queryRaw.mockReset().mockImplementation(async (_s: TemplateStringsArray, id: string) => {
    const linha = estado.travada.get(id);
    return linha ? [linha] : [];
  });
});

describe('processarPrazos', () => {
  it('sem candidatas, não carrega feriados nem abre transações', async () => {
    await expect(processarPrazos(AGORA)).resolves.toEqual({
      verificadas: 0,
      atrasadas: 0,
      reativacoesExpiradas: 0,
      comErro: 0,
    });
    expect(carregarFeriados).not.toHaveBeenCalled();
  });

  it('marca Atrasada e expira a reativação quando o prazo de 5 dias úteis venceu', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      candidata('a', 'PENDENTE', em('2026-10-22')), // qui → qui: 5 dias úteis
      candidata('b', 'EM_CONTATO', em('2026-10-21')),
      candidata('c', 'EM_REATIVACAO', em('2026-10-20')),
    ]);

    const resumo = await processarPrazos(AGORA);

    expect(resumo).toEqual({ verificadas: 3, atrasadas: 2, reativacoesExpiradas: 1, comErro: 0 });
    expect(carregarFeriados).toHaveBeenCalledWith('2026-10-20', '2026-10-29');
    expect(aplicarEvento).toHaveBeenCalledWith(tx, {
      osId: 'a',
      usuarioId: null,
      evento: { tipo: 'MARCAR_ATRASADA' },
      motivo: 'Prazo de 5 dias úteis vencido',
    });
    expect(aplicarEvento).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ osId: 'c', evento: { tipo: 'EXPIRAR_REATIVACAO' } }),
    );
  });

  it('não aplica quando, por causa de fim de semana ou feriado, ainda não venceu', async () => {
    // sex 23 → qui 29: seg 26, ter 27, qua 28, qui 29 = 4 dias úteis
    prismaMock.$queryRaw.mockResolvedValue([candidata('a', 'PENDENTE', em('2026-10-23'))]);
    await processarPrazos(AGORA);
    expect(aplicarEvento).not.toHaveBeenCalled();

    // qui 22 → qui 29 seria 5, mas com feriado na segunda 26 são 4
    vi.mocked(carregarFeriados).mockResolvedValue(new Set(['2026-10-26']));
    prismaMock.$queryRaw.mockResolvedValue([candidata('b', 'PENDENTE', em('2026-10-22'))]);
    await processarPrazos(AGORA);
    expect(aplicarEvento).not.toHaveBeenCalled();
  });

  it('reavalia com a linha travada: interação registrada no meio do caminho é respeitada', async () => {
    prismaMock.$queryRaw.mockResolvedValue([candidata('a', 'EM_CONTATO', em('2026-10-20'))]);
    estado.travada.set('a', { status: 'EM_CONTATO', referencia: em('2026-10-29') }); // tentativa agora

    const resumo = await processarPrazos(AGORA);

    expect(resumo.atrasadas).toBe(0);
    expect(aplicarEvento).not.toHaveBeenCalled();
  });

  it('reavalia o status: OS que já saiu do status é ignorada', async () => {
    prismaMock.$queryRaw.mockResolvedValue([candidata('a', 'PENDENTE', em('2026-10-20'))]);
    estado.travada.set('a', { status: 'AGENDADA', referencia: em('2026-10-20') });

    await processarPrazos(AGORA);
    expect(aplicarEvento).not.toHaveBeenCalled();
  });

  it('um erro numa OS não impede as demais', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      candidata('a', 'PENDENTE', em('2026-10-20')),
      candidata('b', 'PENDENTE', em('2026-10-20')),
      candidata('c', 'PENDENTE', em('2026-10-20')),
    ]);
    vi.mocked(aplicarEvento)
      .mockRejectedValueOnce(new Error('falha inesperada'))
      .mockRejectedValueOnce(new TransicaoInvalidaError('já mudou'))
      .mockResolvedValueOnce({} as never);

    const resumo = await processarPrazos(AGORA);

    expect(resumo).toMatchObject({ atrasadas: 1, comErro: 1 });
    expect(aplicarEvento).toHaveBeenCalledTimes(3);
  });
});
