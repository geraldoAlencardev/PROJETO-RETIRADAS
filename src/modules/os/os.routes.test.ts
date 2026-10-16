import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/prisma.js', () => ({ prisma: {} }));
vi.mock('../usuarios/usuarios.repository.js', () => ({
  buscarPorLogin: vi.fn(),
  buscarPorId: vi.fn(),
  criarUsuario: vi.fn(),
}));
vi.mock('./os.repository.js', () => ({
  listarOs: vi.fn(),
  contarPorStatus: vi.fn(),
  buscarOsPorId: vi.fn(),
  listarHistorico: vi.fn(),
}));
vi.mock('./os.service.js', async () => {
  // Mantém as classes de erro reais; só a execução da transação é simulada.
  const real = await vi.importActual<typeof import('./os.service.js')>('./os.service.js');
  return { ...real, executarEvento: vi.fn() };
});

import { buildApp } from '../../app.js';
import { COOKIE_NOME } from '../usuarios/auth.plugin.js';
import { buscarPorId, type Usuario } from '../usuarios/usuarios.repository.js';
import {
  buscarOsPorId,
  contarPorStatus,
  listarHistorico,
  listarOs,
  type OsDetalhe,
} from './os.repository.js';
import { executarEvento, OsNaoEncontradaError, TransicaoInvalidaError } from './os.service.js';

const usuario: Usuario = {
  id: '11111111-1111-1111-1111-111111111111',
  nome: 'Administrador',
  login: 'admin',
  senha_hash: 'não-usado-nestes-testes',
  ativo: true,
};

const OS_ID = '22222222-2222-2222-2222-222222222222';

const osExemplo: OsDetalhe = {
  id: OS_ID,
  osExternaId: 'OS-9001',
  clienteNome: 'Maria Souza',
  contratoId: 'CT-1001',
  bairro: 'Centro',
  endereco: 'Rua das Flores, 100',
  dataAbertura: '2026-09-29',
  status: 'PENDENTE',
  dataEntradaStatus: new Date('2026-09-29T12:00:00Z'),
  dataUltimaInteracao: null,
  qtdTentativasContato: 0,
  agendamentoVigente: null,
};

beforeEach(() => {
  vi.mocked(buscarPorId).mockReset();
  vi.mocked(listarOs).mockReset();
  vi.mocked(contarPorStatus).mockReset();
  vi.mocked(buscarOsPorId).mockReset();
  vi.mocked(listarHistorico).mockReset();
  vi.mocked(executarEvento).mockReset();

  vi.mocked(buscarPorId).mockResolvedValue(usuario);
  vi.mocked(listarOs).mockResolvedValue({ itens: [], total: 0 });
});

// Gera um cookie de sessão válido sem passar pelo login (que é lento por causa do bcrypt).
async function sessao() {
  const app = buildApp();
  await app.ready();
  const token = app.jwt.sign({ sub: usuario.id });
  return { app, cookies: { [COOKIE_NOME]: token } };
}

describe('autenticação obrigatória', () => {
  it.each(['/os', '/os/resumo', `/os/${OS_ID}`, `/os/${OS_ID}/historico`])(
    'GET %s retorna 401 sem sessão',
    async (url) => {
      const app = buildApp();
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
    },
  );

  it('POST /os/:id/acoes retorna 401 sem sessão', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/os/${OS_ID}/acoes`,
      payload: { acao: 'CONCLUIR_RETIRADA' },
    });
    expect(res.statusCode).toBe(401);
    expect(executarEvento).not.toHaveBeenCalled();
  });
});

describe('GET /os', () => {
  it('usa os padrões: página 1, 20 por página, sem filtros', async () => {
    const { app, cookies } = await sessao();
    vi.mocked(listarOs).mockResolvedValue({ itens: [osExemplo], total: 45 });

    const res = await app.inject({ method: 'GET', url: '/os', cookies });

    expect(res.statusCode).toBe(200);
    expect(listarOs).toHaveBeenCalledWith({
      status: undefined,
      busca: undefined,
      limite: 20,
      deslocamento: 0,
    });
    const corpo = res.json();
    expect(corpo).toMatchObject({ total: 45, pagina: 1, tamanho: 20, totalPaginas: 3 });
    expect(corpo.itens).toHaveLength(1);
    expect(corpo.itens[0]).toMatchObject({ osExternaId: 'OS-9001', status: 'PENDENTE' });
  });

  it('calcula o deslocamento a partir da página e do tamanho', async () => {
    const { app, cookies } = await sessao();
    await app.inject({ method: 'GET', url: '/os?pagina=3&tamanho=10', cookies });
    expect(listarOs).toHaveBeenCalledWith(
      expect.objectContaining({ limite: 10, deslocamento: 20 }),
    );
  });

  it('aceita status separados por vírgula, em qualquer caixa', async () => {
    const { app, cookies } = await sessao();
    await app.inject({ method: 'GET', url: '/os?status=pendente,ATRASADA', cookies });
    expect(listarOs).toHaveBeenCalledWith(
      expect.objectContaining({ status: ['PENDENTE', 'ATRASADA'] }),
    );
  });

  it('aceita o parâmetro status repetido', async () => {
    const { app, cookies } = await sessao();
    await app.inject({ method: 'GET', url: '/os?status=PENDENTE&status=EM_CONTATO', cookies });
    expect(listarOs).toHaveBeenCalledWith(
      expect.objectContaining({ status: ['PENDENTE', 'EM_CONTATO'] }),
    );
  });

  it('repassa a busca sem espaços nas pontas e ignora busca vazia', async () => {
    const { app, cookies } = await sessao();
    await app.inject({ method: 'GET', url: '/os?busca=%20%20maria%20', cookies });
    expect(listarOs).toHaveBeenLastCalledWith(expect.objectContaining({ busca: 'maria' }));

    await app.inject({ method: 'GET', url: '/os?busca=%20%20', cookies });
    expect(listarOs).toHaveBeenLastCalledWith(expect.objectContaining({ busca: undefined }));
  });

  it.each([
    ['status inexistente', '/os?status=INVENTADO'],
    ['página zero', '/os?pagina=0'],
    ['tamanho acima do limite', '/os?tamanho=101'],
    ['tamanho zero', '/os?tamanho=0'],
    ['página não numérica', '/os?pagina=abc'],
    ['busca longa demais', `/os?busca=${'a'.repeat(101)}`],
  ])('retorna 400 para %s', async (_descricao, url) => {
    const { app, cookies } = await sessao();
    const res = await app.inject({ method: 'GET', url, cookies });
    expect(res.statusCode).toBe(400);
    expect(listarOs).not.toHaveBeenCalled();
  });
});

describe('GET /os/resumo', () => {
  it('retorna a contagem por status', async () => {
    const { app, cookies } = await sessao();
    const resumo = {
      total: 3,
      porStatus: {
        PENDENTE: 2,
        EM_CONTATO: 1,
        AGENDADA: 0,
        ATRASADA: 0,
        EM_EXTRAVIO: 0,
        MULTA_GERADA: 0,
        EM_REATIVACAO: 0,
        REATIVACAO_CONCLUIDA: 0,
        RETIRADA_OK: 0,
      },
    };
    vi.mocked(contarPorStatus).mockResolvedValue(resumo);

    const res = await app.inject({ method: 'GET', url: '/os/resumo', cookies });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(resumo);
  });
});

describe('GET /os/:id', () => {
  it('retorna a OS encontrada', async () => {
    const { app, cookies } = await sessao();
    vi.mocked(buscarOsPorId).mockResolvedValue(osExemplo);

    const res = await app.inject({ method: 'GET', url: `/os/${OS_ID}`, cookies });

    expect(res.statusCode).toBe(200);
    expect(buscarOsPorId).toHaveBeenCalledWith(OS_ID);
    expect(res.json()).toMatchObject({ id: OS_ID, agendamentoVigente: null });
  });

  it('retorna 404 quando a OS não existe', async () => {
    const { app, cookies } = await sessao();
    vi.mocked(buscarOsPorId).mockResolvedValue(null);

    const res = await app.inject({ method: 'GET', url: `/os/${OS_ID}`, cookies });
    expect(res.statusCode).toBe(404);
  });

  it('retorna 400 para identificador que não é UUID', async () => {
    const { app, cookies } = await sessao();
    const res = await app.inject({ method: 'GET', url: '/os/nao-e-uuid', cookies });
    expect(res.statusCode).toBe(400);
    expect(buscarOsPorId).not.toHaveBeenCalled();
  });
});

describe('GET /os/:id/historico', () => {
  it('retorna a linha do tempo da OS', async () => {
    const { app, cookies } = await sessao();
    vi.mocked(buscarOsPorId).mockResolvedValue(osExemplo);
    vi.mocked(listarHistorico).mockResolvedValue([
      {
        id: '33333333-3333-3333-3333-333333333333',
        dataHora: new Date('2026-09-29T12:00:00Z'),
        tipoEvento: 'RECEBIMENTO',
        descricao: 'OS recebida do sistema externo',
        motivo: null,
        usuarioNome: null,
      },
    ]);

    const res = await app.inject({ method: 'GET', url: `/os/${OS_ID}/historico`, cookies });

    expect(res.statusCode).toBe(200);
    expect(listarHistorico).toHaveBeenCalledWith(OS_ID);
    expect(res.json().itens).toHaveLength(1);
    expect(res.json().itens[0]).toMatchObject({ tipoEvento: 'RECEBIMENTO' });
  });

  it('retorna 404 quando a OS não existe', async () => {
    const { app, cookies } = await sessao();
    vi.mocked(buscarOsPorId).mockResolvedValue(null);

    const res = await app.inject({ method: 'GET', url: `/os/${OS_ID}/historico`, cookies });
    expect(res.statusCode).toBe(404);
    expect(listarHistorico).not.toHaveBeenCalled();
  });

  it('retorna 400 para identificador que não é UUID', async () => {
    const { app, cookies } = await sessao();
    const res = await app.inject({ method: 'GET', url: '/os/xyz/historico', cookies });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /os/:id/acoes', () => {
  const transicao = { de: 'AGENDADA', para: 'RETIRADA_OK', codigo: 'T09' } as const;

  async function postar(payload: unknown, url = `/os/${OS_ID}/acoes`) {
    const { app, cookies } = await sessao();
    return app.inject({ method: 'POST', url, cookies, payload: payload as object });
  }

  it('aplica a ação como o usuário logado e devolve a transição e a OS atualizada', async () => {
    vi.mocked(executarEvento).mockResolvedValue(transicao);
    vi.mocked(buscarOsPorId).mockResolvedValue({ ...osExemplo, status: 'RETIRADA_OK' });

    const res = await postar({ acao: 'CONCLUIR_RETIRADA', motivo: '  Equipamento recolhido  ' });

    expect(res.statusCode).toBe(200);
    expect(executarEvento).toHaveBeenCalledWith({
      osId: OS_ID,
      usuarioId: usuario.id,
      evento: { tipo: 'CONCLUIR_RETIRADA' },
      motivo: 'Equipamento recolhido',
    });
    expect(res.json()).toMatchObject({ transicao, os: { status: 'RETIRADA_OK' } });
  });

  it('o motivo é opcional', async () => {
    vi.mocked(executarEvento).mockResolvedValue(transicao);
    vi.mocked(buscarOsPorId).mockResolvedValue(osExemplo);

    const res = await postar({ acao: 'CONCLUIR_RETIRADA' });

    expect(res.statusCode).toBe(200);
    expect(executarEvento).toHaveBeenCalledWith(expect.objectContaining({ motivo: undefined }));
  });

  it.each(['CONCLUIR_RETIRADA', 'GERAR_MULTA', 'INICIAR_REATIVACAO', 'CONCLUIR_REATIVACAO'])(
    'aceita a ação %s',
    async (acao) => {
      vi.mocked(executarEvento).mockResolvedValue(transicao);
      vi.mocked(buscarOsPorId).mockResolvedValue(osExemplo);

      const res = await postar({ acao });

      expect(res.statusCode).toBe(200);
      expect(executarEvento).toHaveBeenCalledWith(
        expect.objectContaining({ evento: { tipo: acao } }),
      );
    },
  );

  it('retorna 409 com o motivo quando a máquina de estados recusa a transição', async () => {
    vi.mocked(executarEvento).mockRejectedValue(
      new TransicaoInvalidaError('A ação CONCLUIR_RETIRADA não é permitida com a OS em PENDENTE.'),
    );

    const res = await postar({ acao: 'CONCLUIR_RETIRADA' });

    expect(res.statusCode).toBe(409);
    expect(res.json().erro).toContain('PENDENTE');
  });

  it('retorna 404 quando a OS não existe', async () => {
    vi.mocked(executarEvento).mockRejectedValue(new OsNaoEncontradaError());

    const res = await postar({ acao: 'CONCLUIR_RETIRADA' });
    expect(res.statusCode).toBe(404);
  });

  it.each([
    ['ação desconhecida', { acao: 'APAGAR_TUDO' }],
    ['ação que tem rota própria', { acao: 'AGENDAR' }],
    ['ação ausente', {}],
    ['motivo longo demais', { acao: 'GERAR_MULTA', motivo: 'x'.repeat(501) }],
  ])('retorna 400 para %s', async (_descricao, payload) => {
    const res = await postar(payload);
    expect(res.statusCode).toBe(400);
    expect(executarEvento).not.toHaveBeenCalled();
  });

  it('retorna 400 para identificador que não é UUID', async () => {
    const res = await postar({ acao: 'CONCLUIR_RETIRADA' }, '/os/xyz/acoes');
    expect(res.statusCode).toBe(400);
    expect(executarEvento).not.toHaveBeenCalled();
  });

  it('não esconde erros inesperados (retorna 500)', async () => {
    vi.mocked(executarEvento).mockRejectedValue(new Error('falha de banco'));

    const res = await postar({ acao: 'CONCLUIR_RETIRADA' });
    expect(res.statusCode).toBe(500);
  });
});
