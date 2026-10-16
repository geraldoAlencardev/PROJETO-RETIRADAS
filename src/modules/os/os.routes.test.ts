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
}));

import { buildApp } from '../../app.js';
import { COOKIE_NOME } from '../usuarios/auth.plugin.js';
import { buscarPorId, type Usuario } from '../usuarios/usuarios.repository.js';
import { buscarOsPorId, contarPorStatus, listarOs, type OsDetalhe } from './os.repository.js';

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
  it.each(['/os', '/os/resumo', `/os/${OS_ID}`])('GET %s retorna 401 sem sessão', async (url) => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(401);
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
        AGUARDANDO: 0,
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
