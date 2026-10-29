import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/prisma.js', () => ({ prisma: {} }));
vi.mock('../usuarios/usuarios.repository.js', () => ({
  buscarPorLogin: vi.fn(),
  buscarPorId: vi.fn(),
  criarUsuario: vi.fn(),
}));
vi.mock('../os/os.repository.js', () => ({ buscarOsPorId: vi.fn() }));
vi.mock('./agendamento.repository.js', () => ({ listarAgendamentos: vi.fn() }));
vi.mock('./agendamento.service.js', async () => {
  const real = await vi.importActual<typeof import('./agendamento.service.js')>(
    './agendamento.service.js',
  );
  return { ...real, agendar: vi.fn(), reverterAgendamento: vi.fn() };
});

import { buildApp } from '../../app.js';
import { buscarOsPorId, type OsDetalhe } from '../os/os.repository.js';
import { OsNaoEncontradaError, TransicaoInvalidaError } from '../os/os.service.js';
import { COOKIE_NOME } from '../usuarios/auth.plugin.js';
import { buscarPorId, type Usuario } from '../usuarios/usuarios.repository.js';
import { listarAgendamentos } from './agendamento.repository.js';
import {
  agendar,
  AgendamentoInvalidoError,
  reverterAgendamento,
  SemAgendamentoVigenteError,
} from './agendamento.service.js';

const usuario: Usuario = {
  id: '11111111-1111-1111-1111-111111111111',
  nome: 'Administrador',
  login: 'admin',
  senha_hash: 'não-usado',
  ativo: true,
};
const OS_ID = '22222222-2222-2222-2222-222222222222';
const osExemplo = { id: OS_ID, status: 'AGENDADA' } as OsDetalhe;
const transicao = { de: 'EM_CONTATO', para: 'AGENDADA', codigo: 'T03' } as const;

beforeEach(() => {
  vi.mocked(buscarPorId).mockReset().mockResolvedValue(usuario);
  vi.mocked(buscarOsPorId).mockReset().mockResolvedValue(osExemplo);
  vi.mocked(listarAgendamentos).mockReset().mockResolvedValue([]);
  vi.mocked(agendar)
    .mockReset()
    .mockResolvedValue({
      agendamento: {
        id: '44444444-4444-4444-4444-444444444444',
        dataPrevista: '2099-01-10',
        horario: null,
        dataHoraRegistro: new Date(),
        tipoMotivo: null,
        motivoDetalhe: null,
      },
      transicao,
    });
  vi.mocked(reverterAgendamento).mockReset();
});

async function sessao() {
  const app = buildApp();
  await app.ready();
  return { app, cookies: { [COOKIE_NOME]: app.jwt.sign({ sub: usuario.id }) } };
}

const url = `/os/${OS_ID}/agendamentos`;

describe('POST /os/:id/agendamentos', () => {
  it('exige sessão', async () => {
    const res = await buildApp().inject({
      method: 'POST',
      url,
      payload: { dataPrevista: '2099-01-10' },
    });
    expect(res.statusCode).toBe(401);
    expect(agendar).not.toHaveBeenCalled();
  });

  it('agenda e devolve o agendamento, a transição e a OS atualizada', async () => {
    const { app, cookies } = await sessao();
    const res = await app.inject({
      method: 'POST',
      url,
      cookies,
      payload: { dataPrevista: '2099-01-10', horario: '08:00', motivoDetalhe: '  ' },
    });

    expect(res.statusCode).toBe(201);
    expect(agendar).toHaveBeenCalledWith({
      osId: OS_ID,
      usuarioId: usuario.id,
      dataPrevista: '2099-01-10',
      horario: '08:00',
      tipoMotivo: undefined,
      motivoDetalhe: undefined,
    });
    expect(res.json()).toMatchObject({ transicao, os: { id: OS_ID } });
  });

  it.each([
    [{}, 'sem data'],
    [{ dataPrevista: '10/01/2099' }, 'formato errado'],
    [{ dataPrevista: '2099-02-30' }, 'data inexistente'],
    [{ dataPrevista: '2099-13-45' }, 'mês inválido'],
    [{ dataPrevista: '2099-01-10', horario: '25:00' }, 'horário inválido'],
    [{ dataPrevista: '2099-01-10', tipoMotivo: 'OUTRO' }, 'motivo desconhecido'],
  ])('400 para corpo inválido: %j (%s)', async (payload) => {
    const { app, cookies } = await sessao();
    const res = await app.inject({ method: 'POST', url, cookies, payload });
    expect(res.statusCode).toBe(400);
    expect(agendar).not.toHaveBeenCalled();
  });

  it('400 para data no passado', async () => {
    const { app, cookies } = await sessao();
    const res = await app.inject({
      method: 'POST',
      url,
      cookies,
      payload: { dataPrevista: '2020-01-01' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().erro).toContain('passado');
  });

  it.each([
    [new OsNaoEncontradaError(), 404],
    [new AgendamentoInvalidoError('Informe quem motivou'), 400],
    [new TransicaoInvalidaError('não permitido'), 409],
  ])('traduz %s para %i', async (erro, codigo) => {
    vi.mocked(agendar).mockRejectedValue(erro);
    const { app, cookies } = await sessao();
    const res = await app.inject({
      method: 'POST',
      url,
      cookies,
      payload: { dataPrevista: '2099-01-10' },
    });
    expect(res.statusCode).toBe(codigo);
  });
});

describe('POST /os/:id/agendamentos/reverter', () => {
  it('exige motivo', async () => {
    const { app, cookies } = await sessao();
    const res = await app.inject({
      method: 'POST',
      url: `${url}/reverter`,
      cookies,
      payload: { motivo: ' ' },
    });
    expect(res.statusCode).toBe(400);
    expect(reverterAgendamento).not.toHaveBeenCalled();
  });

  it('reverte e devolve a transição', async () => {
    vi.mocked(reverterAgendamento).mockResolvedValue({
      de: 'AGENDADA',
      para: 'EM_CONTATO',
      codigo: 'T07',
    });
    const { app, cookies } = await sessao();
    const res = await app.inject({
      method: 'POST',
      url: `${url}/reverter`,
      cookies,
      payload: { motivo: 'Cliente desistiu' },
    });
    expect(res.statusCode).toBe(200);
    expect(reverterAgendamento).toHaveBeenCalledWith({
      osId: OS_ID,
      usuarioId: usuario.id,
      motivo: 'Cliente desistiu',
    });
  });

  it.each([
    [new TransicaoInvalidaError('não está agendada'), 409],
    [new SemAgendamentoVigenteError(), 409],
    [new OsNaoEncontradaError(), 404],
  ])('traduz %s para %i', async (erro, codigo) => {
    vi.mocked(reverterAgendamento).mockRejectedValue(erro);
    const { app, cookies } = await sessao();
    const res = await app.inject({
      method: 'POST',
      url: `${url}/reverter`,
      cookies,
      payload: { motivo: 'x' },
    });
    expect(res.statusCode).toBe(codigo);
  });
});

describe('GET /os/:id/agendamentos', () => {
  it('lista o histórico de datas', async () => {
    const { app, cookies } = await sessao();
    const res = await app.inject({ method: 'GET', url, cookies });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ itens: [] });
    expect(listarAgendamentos).toHaveBeenCalledWith(OS_ID);
  });

  it('404 para OS inexistente', async () => {
    vi.mocked(buscarOsPorId).mockResolvedValue(null);
    const { app, cookies } = await sessao();
    const res = await app.inject({ method: 'GET', url, cookies });
    expect(res.statusCode).toBe(404);
  });
});
