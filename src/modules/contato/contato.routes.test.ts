import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/prisma.js', () => ({ prisma: {} }));
vi.mock('../usuarios/usuarios.repository.js', () => ({
  buscarPorLogin: vi.fn(),
  buscarPorId: vi.fn(),
  criarUsuario: vi.fn(),
}));
vi.mock('../os/os.repository.js', () => ({
  listarOs: vi.fn(),
  contarPorStatus: vi.fn(),
  buscarOsPorId: vi.fn(),
  listarHistorico: vi.fn(),
}));
vi.mock('./contato.repository.js', () => ({ listarTentativas: vi.fn() }));
vi.mock('./contato.service.js', () => ({ registrarTentativa: vi.fn() }));

import { buildApp } from '../../app.js';
import { buscarOsPorId, type OsDetalhe } from '../os/os.repository.js';
import { OsNaoEncontradaError, TransicaoInvalidaError } from '../os/os.service.js';
import { COOKIE_NOME } from '../usuarios/auth.plugin.js';
import { buscarPorId, type Usuario } from '../usuarios/usuarios.repository.js';
import { CANAIS } from './canal.js';
import { listarTentativas } from './contato.repository.js';
import { registrarTentativa } from './contato.service.js';

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
  status: 'EM_CONTATO',
  dataEntradaStatus: new Date('2026-10-16T12:00:00Z'),
  dataUltimaInteracao: new Date('2026-10-16T12:00:00Z'),
  qtdTentativasContato: 1,
  agendamentoVigente: null,
};

const tentativaRegistrada = {
  id: '33333333-3333-3333-3333-333333333333',
  dataHora: new Date('2026-10-16T12:00:00Z'),
  canal: 'TELEFONE' as const,
  sucesso: false,
  observacao: null,
};
const transicao = { de: 'PENDENTE', para: 'EM_CONTATO', codigo: 'T01' } as const;

beforeEach(() => {
  vi.mocked(buscarPorId).mockReset();
  vi.mocked(buscarOsPorId).mockReset();
  vi.mocked(listarTentativas).mockReset();
  vi.mocked(registrarTentativa).mockReset();

  vi.mocked(buscarPorId).mockResolvedValue(usuario);
  vi.mocked(buscarOsPorId).mockResolvedValue(osExemplo);
  vi.mocked(registrarTentativa).mockResolvedValue({ tentativa: tentativaRegistrada, transicao });
});

async function sessao() {
  const app = buildApp();
  await app.ready();
  const token = app.jwt.sign({ sub: usuario.id });
  return { app, cookies: { [COOKIE_NOME]: token } };
}

async function postar(payload: unknown, url = `/os/${OS_ID}/tentativas`) {
  const { app, cookies } = await sessao();
  return app.inject({ method: 'POST', url, cookies, payload: payload as object });
}

describe('autenticação obrigatória', () => {
  it('POST /os/:id/tentativas retorna 401 sem sessão', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/os/${OS_ID}/tentativas`,
      payload: { canal: 'TELEFONE', sucesso: false },
    });
    expect(res.statusCode).toBe(401);
    expect(registrarTentativa).not.toHaveBeenCalled();
  });

  it('GET /os/:id/tentativas retorna 401 sem sessão', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: `/os/${OS_ID}/tentativas` });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /os/:id/tentativas', () => {
  it('registra a tentativa como o usuário logado e devolve tentativa, transição e OS', async () => {
    const res = await postar({
      canal: 'TELEFONE',
      sucesso: false,
      observacao: '  Telefone desligado  ',
    });

    expect(res.statusCode).toBe(201);
    expect(registrarTentativa).toHaveBeenCalledWith({
      osId: OS_ID,
      usuarioId: usuario.id,
      canal: 'TELEFONE',
      sucesso: false,
      observacao: 'Telefone desligado',
    });
    expect(res.json()).toMatchObject({
      tentativa: { id: tentativaRegistrada.id, sucesso: false },
      transicao,
      os: { id: OS_ID, status: 'EM_CONTATO' },
    });
  });

  it('aceita sucesso = false (caixa desmarcada) e sucesso = true', async () => {
    expect((await postar({ canal: 'EMAIL', sucesso: false })).statusCode).toBe(201);
    expect((await postar({ canal: 'EMAIL', sucesso: true })).statusCode).toBe(201);
  });

  it('a observação é opcional: ausente ou vazia vira "sem observação"', async () => {
    await postar({ canal: 'TELEFONE', sucesso: true });
    expect(registrarTentativa).toHaveBeenLastCalledWith(
      expect.objectContaining({ observacao: undefined }),
    );

    await postar({ canal: 'TELEFONE', sucesso: true, observacao: '   ' });
    expect(registrarTentativa).toHaveBeenLastCalledWith(
      expect.objectContaining({ observacao: undefined }),
    );
  });

  it.each(CANAIS)('aceita o canal %s', async (canal) => {
    const res = await postar({ canal, sucesso: true });
    expect(res.statusCode).toBe(201);
  });

  it('não aceita o usuário vindo do corpo da requisição (usa sempre o da sessão)', async () => {
    await postar({
      canal: 'TELEFONE',
      sucesso: true,
      usuarioId: '99999999-9999-9999-9999-999999999999',
    });
    expect(registrarTentativa).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: usuario.id }),
    );
  });

  it.each([
    ['canal inexistente', { canal: 'POMBO', sucesso: true }],
    ['canal ausente', { sucesso: true }],
    ['sucesso ausente', { canal: 'TELEFONE' }],
    ['sucesso como texto', { canal: 'TELEFONE', sucesso: 'true' }],
    ['sucesso como número', { canal: 'TELEFONE', sucesso: 1 }],
    ['observação longa demais', { canal: 'TELEFONE', sucesso: true, observacao: 'x'.repeat(1001) }],
    ['corpo vazio', {}],
  ])('retorna 400 para %s', async (_descricao, payload) => {
    const res = await postar(payload);
    expect(res.statusCode).toBe(400);
    expect(registrarTentativa).not.toHaveBeenCalled();
  });

  it('retorna 400 para identificador que não é UUID', async () => {
    const res = await postar({ canal: 'TELEFONE', sucesso: true }, '/os/xyz/tentativas');
    expect(res.statusCode).toBe(400);
    expect(registrarTentativa).not.toHaveBeenCalled();
  });

  it('retorna 404 quando a OS não existe', async () => {
    vi.mocked(registrarTentativa).mockRejectedValue(new OsNaoEncontradaError());
    const res = await postar({ canal: 'TELEFONE', sucesso: true });
    expect(res.statusCode).toBe(404);
  });

  it('retorna 409 com o motivo quando o status da OS não permite tentativas', async () => {
    vi.mocked(registrarTentativa).mockRejectedValue(
      new TransicaoInvalidaError(
        'Não é possível registrar tentativa de contato com a OS em AGENDADA.',
      ),
    );
    const res = await postar({ canal: 'TELEFONE', sucesso: true });
    expect(res.statusCode).toBe(409);
    expect(res.json().erro).toContain('AGENDADA');
  });

  it('não esconde erros inesperados (retorna 500)', async () => {
    vi.mocked(registrarTentativa).mockRejectedValue(new Error('falha de banco'));
    const res = await postar({ canal: 'TELEFONE', sucesso: true });
    expect(res.statusCode).toBe(500);
  });
});

describe('GET /os/:id/tentativas', () => {
  it('retorna o detalhamento das tentativas da OS', async () => {
    const { app, cookies } = await sessao();
    vi.mocked(listarTentativas).mockResolvedValue([
      {
        id: tentativaRegistrada.id,
        dataHora: tentativaRegistrada.dataHora,
        canal: 'TELEFONE',
        sucesso: false,
        observacao: 'Sem resposta',
        usuarioNome: 'Administrador',
      },
    ]);

    const res = await app.inject({ method: 'GET', url: `/os/${OS_ID}/tentativas`, cookies });

    expect(res.statusCode).toBe(200);
    expect(listarTentativas).toHaveBeenCalledWith(OS_ID);
    expect(res.json().itens).toHaveLength(1);
    expect(res.json().itens[0]).toMatchObject({
      canal: 'TELEFONE',
      sucesso: false,
      observacao: 'Sem resposta',
      usuarioNome: 'Administrador',
    });
  });

  it('retorna 404 quando a OS não existe', async () => {
    const { app, cookies } = await sessao();
    vi.mocked(buscarOsPorId).mockResolvedValue(null);

    const res = await app.inject({ method: 'GET', url: `/os/${OS_ID}/tentativas`, cookies });
    expect(res.statusCode).toBe(404);
    expect(listarTentativas).not.toHaveBeenCalled();
  });

  it('retorna 400 para identificador que não é UUID', async () => {
    const { app, cookies } = await sessao();
    const res = await app.inject({ method: 'GET', url: '/os/xyz/tentativas', cookies });
    expect(res.statusCode).toBe(400);
  });
});
