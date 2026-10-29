import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/prisma.js', () => ({ prisma: {} }));
vi.mock('../usuarios/usuarios.repository.js', () => ({
  buscarPorLogin: vi.fn(),
  buscarPorId: vi.fn(),
  criarUsuario: vi.fn(),
}));
vi.mock('./sincronizacao.service.js', async () => {
  const real = await vi.importActual<typeof import('./sincronizacao.service.js')>(
    './sincronizacao.service.js',
  );
  return {
    ...real,
    iniciarSincronizacao: vi.fn(),
    executarSincronizacao: vi.fn(),
    buscarSincronizacao: vi.fn(),
    buscarUltimaSincronizacao: vi.fn(),
  };
});

import { buildApp } from '../../app.js';
import { COOKIE_NOME } from '../usuarios/auth.plugin.js';
import { buscarPorId, type Usuario } from '../usuarios/usuarios.repository.js';
import type { FonteOsIxc } from './fonte-ixc.js';
import {
  buscarSincronizacao,
  buscarUltimaSincronizacao,
  executarSincronizacao,
  iniciarSincronizacao,
  SincronizacaoEmAndamentoError,
  SincronizacaoRecenteError,
} from './sincronizacao.service.js';

const usuario: Usuario = {
  id: '11111111-1111-1111-1111-111111111111',
  nome: 'Administrador',
  login: 'admin',
  senha_hash: 'não-usado',
  ativo: true,
};
const SINC_ID = '55555555-5555-5555-5555-555555555555';
const fonte: FonteOsIxc = { buscarPagina: vi.fn() };

beforeEach(() => {
  vi.mocked(buscarPorId).mockReset().mockResolvedValue(usuario);
  vi.mocked(iniciarSincronizacao).mockReset().mockResolvedValue(SINC_ID);
  vi.mocked(executarSincronizacao)
    .mockReset()
    .mockResolvedValue({} as never);
  vi.mocked(buscarSincronizacao).mockReset();
  vi.mocked(buscarUltimaSincronizacao).mockReset();
});

async function sessao(comFonte = true) {
  const app = buildApp(comFonte ? { fonteOsIxc: fonte } : {});
  await app.ready();
  return { app, cookies: { [COOKIE_NOME]: app.jwt.sign({ sub: usuario.id }) } };
}

describe('POST /sincronizacoes', () => {
  it('exige sessão', async () => {
    const res = await buildApp({ fonteOsIxc: fonte }).inject({
      method: 'POST',
      url: '/sincronizacoes',
    });
    expect(res.statusCode).toBe(401);
  });

  it('503 enquanto a fonte do IXC não estiver configurada', async () => {
    const { app, cookies } = await sessao(false);
    const res = await app.inject({ method: 'POST', url: '/sincronizacoes', cookies });
    expect(res.statusCode).toBe(503);
    expect(iniciarSincronizacao).not.toHaveBeenCalled();
  });

  it('inicia em segundo plano e responde 202 com o id', async () => {
    const { app, cookies } = await sessao();
    const res = await app.inject({ method: 'POST', url: '/sincronizacoes', cookies });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ id: SINC_ID, situacao: 'EM_ANDAMENTO' });
    expect(iniciarSincronizacao).toHaveBeenCalledWith(usuario.id);
    expect(executarSincronizacao).toHaveBeenCalledWith(SINC_ID, fonte);
  });

  it('409 se já houver uma em andamento', async () => {
    vi.mocked(iniciarSincronizacao).mockRejectedValue(new SincronizacaoEmAndamentoError());
    const { app, cookies } = await sessao();
    const res = await app.inject({ method: 'POST', url: '/sincronizacoes', cookies });
    expect(res.statusCode).toBe(409);
    expect(executarSincronizacao).not.toHaveBeenCalled();
  });

  it('429 antes do intervalo mínimo, com o horário de liberação', async () => {
    const liberadaEm = new Date('2026-10-29T15:05:00Z');
    vi.mocked(iniciarSincronizacao).mockRejectedValue(new SincronizacaoRecenteError(liberadaEm));
    const { app, cookies } = await sessao();
    const res = await app.inject({ method: 'POST', url: '/sincronizacoes', cookies });
    expect(res.statusCode).toBe(429);
    expect(res.json().liberadaEm).toBe(liberadaEm.toISOString());
  });
});

describe('GET /sincronizacoes', () => {
  it('última: 404 quando nunca houve sincronização', async () => {
    vi.mocked(buscarUltimaSincronizacao).mockResolvedValue(null);
    const { app, cookies } = await sessao();
    const res = await app.inject({ method: 'GET', url: '/sincronizacoes/ultima', cookies });
    expect(res.statusCode).toBe(404);
  });

  it('por id: devolve a execução', async () => {
    vi.mocked(buscarSincronizacao).mockResolvedValue({
      id: SINC_ID,
      situacao: 'CONCLUIDA',
    } as never);
    const { app, cookies } = await sessao();
    const res = await app.inject({ method: 'GET', url: `/sincronizacoes/${SINC_ID}`, cookies });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: SINC_ID, situacao: 'CONCLUIDA' });
  });

  it('por id: 400 para id inválido', async () => {
    const { app, cookies } = await sessao();
    const res = await app.inject({ method: 'GET', url: '/sincronizacoes/abc', cookies });
    expect(res.statusCode).toBe(400);
  });
});
