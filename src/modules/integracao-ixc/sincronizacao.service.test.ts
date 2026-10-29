import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, gravacoes, estado } = vi.hoisted(() => ({
  prismaMock: { $queryRaw: vi.fn(), $executeRaw: vi.fn() },
  gravacoes: [] as unknown[][],
  estado: {
    ultima: null as { situacao: string; liberadaEm: Date | null } | null,
    erroInsert: null as Error | null,
  },
}));

vi.mock('../../shared/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('./importacao.service.js', async () => {
  const real =
    await vi.importActual<typeof import('./importacao.service.js')>('./importacao.service.js');
  return { ...real, importarRegistro: vi.fn() };
});

import type { FonteOsIxc } from './fonte-ixc.js';
import { importarRegistro } from './importacao.service.js';
import {
  executarSincronizacao,
  iniciarSincronizacao,
  SincronizacaoEmAndamentoError,
  SincronizacaoRecenteError,
} from './sincronizacao.service.js';

const SINC_ID = '55555555-5555-5555-5555-555555555555';
const USUARIO_ID = '11111111-1111-1111-1111-111111111111';
const opcoes = { tamanhoPagina: 2, pausaMs: 0, maxPaginas: 10 };

/** Fonte simulada com `total` registros, em páginas de `opcoes.tamanhoPagina`. */
function fonteCom(total: number): FonteOsIxc & { paginasPedidas: number[] } {
  const paginasPedidas: number[] = [];
  return {
    paginasPedidas,
    async buscarPagina(pagina, tamanho) {
      paginasPedidas.push(pagina);
      const inicio = (pagina - 1) * tamanho;
      const registros = Array.from(
        { length: Math.max(0, Math.min(tamanho, total - inicio)) },
        (_, i) => ({
          id: String(inicio + i + 1),
        }),
      );
      return { total: String(total), registros };
    },
  };
}

/** Última gravação de progresso: [paginas, recebidos, criadas, ..., situacao, fim?, erro]. */
const ultimaGravacao = () => gravacoes[gravacoes.length - 1]!;

beforeEach(() => {
  gravacoes.length = 0;
  estado.ultima = null;
  estado.erroInsert = null;
  vi.mocked(importarRegistro).mockReset().mockResolvedValue({ tipo: 'CRIADA', osExternaId: 'x' });
  prismaMock.$queryRaw.mockReset().mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('INSERT INTO sincronizacao')) {
      if (estado.erroInsert) throw estado.erroInsert;
      return [{ id: SINC_ID }];
    }
    if (sql.includes('FROM sincronizacao')) return estado.ultima ? [estado.ultima] : [];
    return [];
  });
  prismaMock.$executeRaw
    .mockReset()
    .mockImplementation(async (strings: TemplateStringsArray, ...valores: unknown[]) => {
      if (strings.join('?').includes('SET paginas')) gravacoes.push(valores.slice(0, -1));
      return 1;
    });
});

describe('iniciarSincronizacao', () => {
  it('registra a execução e devolve o id', async () => {
    await expect(iniciarSincronizacao(USUARIO_ID)).resolves.toBe(SINC_ID);
  });

  it('recusa se há outra em andamento', async () => {
    estado.ultima = { situacao: 'EM_ANDAMENTO', liberadaEm: null };
    await expect(iniciarSincronizacao(USUARIO_ID)).rejects.toBeInstanceOf(
      SincronizacaoEmAndamentoError,
    );
  });

  it('recusa antes do intervalo mínimo, informando quando libera', async () => {
    const liberadaEm = new Date(Date.now() + 60_000);
    estado.ultima = { situacao: 'CONCLUIDA', liberadaEm };
    await expect(iniciarSincronizacao(USUARIO_ID)).rejects.toEqual(
      expect.objectContaining({ liberadaEm }),
    );
    await expect(iniciarSincronizacao(USUARIO_ID)).rejects.toBeInstanceOf(
      SincronizacaoRecenteError,
    );
  });

  it('libera depois do intervalo mínimo', async () => {
    estado.ultima = { situacao: 'CONCLUIDA', liberadaEm: new Date(Date.now() - 1000) };
    await expect(iniciarSincronizacao(USUARIO_ID)).resolves.toBe(SINC_ID);
  });

  it('dois cliques simultâneos: o índice único barra o segundo', async () => {
    estado.erroInsert = new Error('duplicate key value violates "ux_sincronizacao_em_andamento"');
    await expect(iniciarSincronizacao(USUARIO_ID)).rejects.toBeInstanceOf(
      SincronizacaoEmAndamentoError,
    );
  });
});

describe('executarSincronizacao', () => {
  it('lê todas as páginas, uma por vez, e importa cada registro', async () => {
    const fonte = fonteCom(5); // páginas de 2: 2 + 2 + 1

    const resumo = await executarSincronizacao(SINC_ID, fonte, opcoes);

    expect(fonte.paginasPedidas).toEqual([1, 2, 3]);
    expect(importarRegistro).toHaveBeenCalledTimes(5);
    expect(resumo).toMatchObject({ recebidos: 5, criadas: 5 });
    expect(ultimaGravacao()).toEqual([3, 5, 5, 0, 0, 0, 0, 'CONCLUIDA', true, null]);
  });

  it('total zero: uma página só e conclui', async () => {
    const fonte = fonteCom(0);
    await executarSincronizacao(SINC_ID, fonte, opcoes);
    expect(fonte.paginasPedidas).toEqual([1]);
    expect(ultimaGravacao()).toContain('CONCLUIDA');
  });

  it('para no primeiro erro da fonte, sem novas tentativas, e grava a falha', async () => {
    const fonte: FonteOsIxc = {
      buscarPagina: vi
        .fn()
        .mockResolvedValueOnce({ total: '6', registros: [{}, {}] })
        .mockRejectedValueOnce(new Error('IXC respondeu 429')),
    };

    const resumo = await executarSincronizacao(SINC_ID, fonte, opcoes);

    expect(fonte.buscarPagina).toHaveBeenCalledTimes(2);
    expect(resumo.recebidos).toBe(2);
    const fim = ultimaGravacao();
    expect(fim).toContain('FALHOU');
    expect(fim).toContain(true);
  });

  it('respeita o teto de páginas', async () => {
    const fonte = fonteCom(100);
    await executarSincronizacao(SINC_ID, fonte, { ...opcoes, maxPaginas: 3 });
    expect(fonte.paginasPedidas).toEqual([1, 2, 3]);
    expect(ultimaGravacao()).toContain('FALHOU');
  });

  it('falha com resposta sem total válido', async () => {
    const fonte: FonteOsIxc = { buscarPagina: async () => ({ total: 'abc', registros: [] }) };
    await executarSincronizacao(SINC_ID, fonte, opcoes);
    expect(ultimaGravacao()).toContain('FALHOU');
  });

  it('encerra se a página vier vazia antes do fim previsto', async () => {
    const fonte: FonteOsIxc & { paginasPedidas: number[] } = {
      paginasPedidas: [],
      async buscarPagina(pagina) {
        this.paginasPedidas.push(pagina);
        return { total: '10', registros: pagina === 1 ? [{}, {}] : [] };
      },
    };
    await executarSincronizacao(SINC_ID, fonte, opcoes);
    expect(fonte.paginasPedidas).toEqual([1, 2]);
    expect(ultimaGravacao()).toContain('CONCLUIDA');
  });
});
