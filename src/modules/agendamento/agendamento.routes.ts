import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { dataLocal } from '../feriado/dias-uteis.js';
import { buscarOsPorId } from '../os/os.repository.js';
import { OsNaoEncontradaError, TransicaoInvalidaError } from '../os/os.service.js';
import { listarAgendamentos } from './agendamento.repository.js';
import {
  agendar,
  AgendamentoInvalidoError,
  reverterAgendamento,
  SemAgendamentoVigenteError,
} from './agendamento.service.js';
import { TIPOS_MOTIVO } from './motivo.js';

const idParams = z.object({ id: z.string().uuid() });

/** 'YYYY-MM-DD' que existe no calendário (rejeita 2026-02-30). */
const dataIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD')
  .refine((s) => {
    const data = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(data.getTime()) && data.toISOString().startsWith(s);
  }, 'Data inexistente');

const agendamentoBody = z.object({
  dataPrevista: dataIso,
  horario: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:MM')
    .optional(),
  // Obrigatório no reagendamento (OS já AGENDADA); não se aplica ao primeiro agendamento.
  tipoMotivo: z.enum(TIPOS_MOTIVO).optional(),
  motivoDetalhe: z.string().trim().max(300).optional(),
});

const reversaoBody = z.object({
  motivo: z.string().trim().min(1, 'Informe o motivo da reversão').max(500),
});

export async function agendamentoRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // Agendar (T03) ou reagendar (T08) a retirada.
  app.post('/os/:id/agendamentos', async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ erro: 'Identificador inválido' });

    const body = agendamentoBody.safeParse(req.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ erro: 'Corpo inválido', detalhes: body.error.flatten().fieldErrors });
    }
    // Comparação de strings 'YYYY-MM-DD' equivale à comparação de datas.
    if (body.data.dataPrevista < dataLocal(new Date(), env.TZ_NEGOCIO)) {
      return reply.code(400).send({ erro: 'A data prevista não pode estar no passado' });
    }

    try {
      const { agendamento, transicao } = await agendar({
        osId: params.data.id,
        usuarioId: req.usuario!.id,
        dataPrevista: body.data.dataPrevista,
        horario: body.data.horario,
        tipoMotivo: body.data.tipoMotivo,
        motivoDetalhe: body.data.motivoDetalhe || undefined,
      });
      return reply
        .code(201)
        .send({ agendamento, transicao, os: await buscarOsPorId(params.data.id) });
    } catch (erro) {
      if (erro instanceof OsNaoEncontradaError) {
        return reply.code(404).send({ erro: 'OS não encontrada' });
      }
      if (erro instanceof AgendamentoInvalidoError) {
        return reply.code(400).send({ erro: erro.message });
      }
      if (erro instanceof TransicaoInvalidaError) {
        return reply.code(409).send({ erro: erro.message });
      }
      throw erro;
    }
  });

  // Reverter o agendamento vigente (T07): a OS volta para Em contato.
  app.post('/os/:id/agendamentos/reverter', async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ erro: 'Identificador inválido' });

    const body = reversaoBody.safeParse(req.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ erro: 'Corpo inválido', detalhes: body.error.flatten().fieldErrors });
    }

    try {
      const transicao = await reverterAgendamento({
        osId: params.data.id,
        usuarioId: req.usuario!.id,
        motivo: body.data.motivo,
      });
      return { transicao, os: await buscarOsPorId(params.data.id) };
    } catch (erro) {
      if (erro instanceof OsNaoEncontradaError) {
        return reply.code(404).send({ erro: 'OS não encontrada' });
      }
      if (erro instanceof TransicaoInvalidaError || erro instanceof SemAgendamentoVigenteError) {
        return reply.code(409).send({ erro: erro.message });
      }
      throw erro;
    }
  });

  // Histórico de datas propostas (RN04).
  app.get('/os/:id/agendamentos', async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ erro: 'Identificador inválido' });

    const os = await buscarOsPorId(params.data.id);
    if (!os) return reply.code(404).send({ erro: 'OS não encontrada' });

    return { itens: await listarAgendamentos(params.data.id) };
  });
}
