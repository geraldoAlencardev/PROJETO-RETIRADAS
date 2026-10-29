import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/prisma.js', () => ({ prisma: {} }));
vi.mock('./usuarios.repository.js', () => ({
  buscarPorLogin: vi.fn(),
  buscarPorId: vi.fn(),
  criarUsuario: vi.fn(),
  listarUsuarios: vi.fn(),
  buscarUsuarioPublico: vi.fn(),
  atualizarUsuario: vi.fn(),
}));
vi.mock('./senha.js', async () => {
  const real = await vi.importActual<typeof import('./senha.js')>('./senha.js');
  // bcrypt é lento; aqui só importa que a senha é transformada em hash.
  return { ...real, hashSenha: vi.fn(async (s: string) => `hash(${s})`) };
});

import { buildApp } from '../../app.js';
import { COOKIE_NOME } from './auth.plugin.js';
import {
  atualizarUsuario,
  buscarPorId,
  buscarPorLogin,
  buscarUsuarioPublico,
  criarUsuario,
  listarUsuarios,
  type Usuario,
} from './usuarios.repository.js';

const usuario: Usuario = {
  id: '11111111-1111-1111-1111-111111111111',
  nome: 'Administrador',
  login: 'admin',
  senha_hash: 'hash-secreto',
  ativo: true,
};
const OUTRO_ID = '33333333-3333-3333-3333-333333333333';
const publico = { id: OUTRO_ID, nome: 'Ana', login: 'ana', ativo: true };

beforeEach(() => {
  vi.mocked(buscarPorId).mockReset().mockResolvedValue(usuario);
  vi.mocked(buscarPorLogin).mockReset().mockResolvedValue(null);
  vi.mocked(criarUsuario).mockReset().mockResolvedValue({ id: OUTRO_ID });
  vi.mocked(listarUsuarios).mockReset().mockResolvedValue([]);
  vi.mocked(buscarUsuarioPublico)
    .mockReset()
    .mockResolvedValue(publico as never);
  vi.mocked(atualizarUsuario).mockReset().mockResolvedValue(true);
});

async function sessao() {
  const app = buildApp();
  await app.ready();
  return { app, cookies: { [COOKIE_NOME]: app.jwt.sign({ sub: usuario.id }) } };
}

describe('/usuarios', () => {
  it('exige sessão', async () => {
    const res = await buildApp().inject({ method: 'GET', url: '/usuarios' });
    expect(res.statusCode).toBe(401);
  });

  it('lista', async () => {
    const { app, cookies } = await sessao();
    const res = await app.inject({ method: 'GET', url: '/usuarios', cookies });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ itens: [] });
  });

  it('cria com login em minúsculas e senha em hash, sem devolver o hash', async () => {
    const { app, cookies } = await sessao();
    const res = await app.inject({
      method: 'POST',
      url: '/usuarios',
      cookies,
      payload: { nome: ' Ana ', login: 'ANA', senha: 'senha-forte-1' },
    });
    expect(res.statusCode).toBe(201);
    expect(criarUsuario).toHaveBeenCalledWith({
      nome: 'Ana',
      login: 'ana',
      senhaHash: 'hash(senha-forte-1)',
    });
    expect(res.body).not.toContain('hash');
  });

  it.each([
    [{ nome: 'Ana', login: 'ana', senha: 'curta' }, 'senha curta'],
    [{ nome: 'Ana', login: 'a', senha: 'senha-forte-1' }, 'login curto'],
    [{ nome: 'Ana', login: 'ana maria', senha: 'senha-forte-1' }, 'login com espaço'],
    [{ login: 'ana', senha: 'senha-forte-1' }, 'sem nome'],
  ])('400 na criação: %j (%s)', async (payload) => {
    const { app, cookies } = await sessao();
    const res = await app.inject({ method: 'POST', url: '/usuarios', cookies, payload });
    expect(res.statusCode).toBe(400);
    expect(criarUsuario).not.toHaveBeenCalled();
  });

  it('409 para login repetido', async () => {
    vi.mocked(buscarPorLogin).mockResolvedValue(usuario);
    const { app, cookies } = await sessao();
    const res = await app.inject({
      method: 'POST',
      url: '/usuarios',
      cookies,
      payload: { nome: 'Outro', login: 'admin', senha: 'senha-forte-1' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('edita nome, senha e ativo', async () => {
    const { app, cookies } = await sessao();
    const res = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${OUTRO_ID}`,
      cookies,
      payload: { senha: 'nova-senha-123', ativo: false },
    });
    expect(res.statusCode).toBe(200);
    expect(atualizarUsuario).toHaveBeenCalledWith(OUTRO_ID, {
      nome: undefined,
      senhaHash: 'hash(nova-senha-123)',
      ativo: false,
    });
  });

  it('não deixa desativar o próprio usuário', async () => {
    const { app, cookies } = await sessao();
    const res = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${usuario.id}`,
      cookies,
      payload: { ativo: false },
    });
    expect(res.statusCode).toBe(409);
    expect(atualizarUsuario).not.toHaveBeenCalled();
  });

  it('400 sem nenhum campo e 404 para usuário inexistente', async () => {
    const { app, cookies } = await sessao();
    const vazio = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${OUTRO_ID}`,
      cookies,
      payload: {},
    });
    expect(vazio.statusCode).toBe(400);

    vi.mocked(atualizarUsuario).mockResolvedValue(false);
    const inexistente = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${OUTRO_ID}`,
      cookies,
      payload: { nome: 'X' },
    });
    expect(inexistente.statusCode).toBe(404);
  });
});
