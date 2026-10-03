import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/prisma.js', () => ({ prisma: {} }));
vi.mock('./usuarios.repository.js', () => ({
  buscarPorLogin: vi.fn(),
  buscarPorId: vi.fn(),
  criarUsuario: vi.fn(),
}));

import { buildApp } from '../../app.js';
import { COOKIE_NOME } from './auth.plugin.js';
import { hashSenha } from './senha.js';
import { buscarPorId, buscarPorLogin, type Usuario } from './usuarios.repository.js';

const SENHA = 'SenhaForte123';
let usuario: Usuario;

beforeAll(async () => {
  usuario = {
    id: '11111111-1111-1111-1111-111111111111',
    nome: 'Administrador',
    login: 'admin',
    senha_hash: await hashSenha(SENHA),
    ativo: true,
  };
});

beforeEach(() => {
  vi.mocked(buscarPorLogin).mockReset();
  vi.mocked(buscarPorId).mockReset();
  vi.mocked(buscarPorLogin).mockImplementation(async (login) =>
    login === usuario.login ? usuario : null,
  );
  vi.mocked(buscarPorId).mockImplementation(async (id) => (id === usuario.id ? usuario : null));
});

async function logar(app: ReturnType<typeof buildApp>, login = 'admin', senha = SENHA) {
  return app.inject({ method: 'POST', url: '/auth/login', payload: { login, senha } });
}

describe('POST /auth/login', () => {
  it('autentica e entrega o JWT em cookie httpOnly, sem expor o hash', async () => {
    const app = buildApp();
    const res = await logar(app);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      usuario: { id: usuario.id, nome: 'Administrador', login: 'admin' },
    });
    expect(res.body).not.toContain('senha_hash');

    const cookie = res.cookies.find((c) => c.name === COOKIE_NOME);
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
    expect(cookie?.path).toBe('/');
  });

  it('aceita login em maiúsculas/com espaços (normaliza)', async () => {
    const app = buildApp();
    const res = await logar(app, '  ADMIN ');
    expect(res.statusCode).toBe(200);
  });

  it('rejeita senha errada e usuário inexistente com a mesma resposta', async () => {
    const app = buildApp();
    const errada = await logar(app, 'admin', 'senha-errada');
    const inexistente = await logar(app, 'fantasma', SENHA);

    expect(errada.statusCode).toBe(401);
    expect(inexistente.statusCode).toBe(401);
    expect(errada.json()).toEqual(inexistente.json());
    expect(errada.cookies).toHaveLength(0);
  });

  it('rejeita usuário inativo', async () => {
    vi.mocked(buscarPorLogin).mockResolvedValue({ ...usuario, ativo: false });
    const app = buildApp();
    expect((await logar(app)).statusCode).toBe(401);
  });

  it('retorna 400 quando faltam campos', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: {} });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /auth/me', () => {
  it('retorna 401 sem cookie', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('retorna 401 com token inválido', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      cookies: { [COOKIE_NOME]: 'token.invalido.aqui' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('retorna o usuário logado com cookie válido', async () => {
    const app = buildApp();
    const login = await logar(app);
    const token = login.cookies.find((c) => c.name === COOKIE_NOME)!.value;

    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      cookies: { [COOKIE_NOME]: token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      usuario: { id: usuario.id, nome: 'Administrador', login: 'admin' },
    });
  });

  it('perde o acesso imediatamente se o usuário for desativado', async () => {
    const app = buildApp();
    const login = await logar(app);
    const token = login.cookies.find((c) => c.name === COOKIE_NOME)!.value;

    vi.mocked(buscarPorId).mockResolvedValue({ ...usuario, ativo: false });
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      cookies: { [COOKIE_NOME]: token },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('limpa o cookie de sessão', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'POST', url: '/auth/logout' });
    expect(res.statusCode).toBe(204);
    const cookie = res.cookies.find((c) => c.name === COOKIE_NOME);
    expect(cookie?.value).toBe('');
  });
});
