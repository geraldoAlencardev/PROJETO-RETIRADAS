import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buscarOsPorId } from '../os/os.repository.js';
import { OsNaoEncontradaError, TransicaoInvalidaError } from '../os/os.service.js';
import { CANAIS } from './canal.js';
import { listarTentativas } from './contato.repository.js';
import { registrarTentativa } from './contato.service.js';

const idParams = z.object({ id: z.string().uuid() });

// A tentativa é registrada depois de realizada. `sucesso` é obrigatório e precisa ser booleano
// de verdade (o front envia false com a caixa desmarcada); `observacao` é a caixa de texto.
const tentativaBody = z.object({
  canal: z.enum(CANAIS),
  sucesso: z.boolean(),
  observacao: z.string().trim().max(1000).optional(),
});

export async function contatoRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // Registrar tentativa de contato (RF10). O contador (RF11) é mantido pelo banco.
  app.post('/os/:id/tentativas', async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ erro: 'Identificador inválido' });

    const body = tentativaBody.safeParse(req.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ erro: 'Corpo inválido', detalhes: body.error.flatten().fieldErrors });
    }

    try {
      const { tentativa, transicao } = await registrarTentativa({
        osId: params.data.id,
        usuarioId: req.usuario!.id,
        canal: body.data.canal,
        sucesso: body.data.sucesso,
        observacao: body.data.observacao || undefined,
      });
      return reply
        .code(201)
        .send({ tentativa, transicao, os: await buscarOsPorId(params.data.id) });
    } catch (erro) {
      if (erro instanceof OsNaoEncontradaError) {
        return reply.code(404).send({ erro: 'OS não encontrada' });
      }
      if (erro instanceof TransicaoInvalidaError) {
        return reply.code(409).send({ erro: erro.message });
      }
      throw erro;
    }
  });

  // Detalhamento das tentativas de contato da OS (RF12).
  app.get('/os/:id/tentativas', async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ erro: 'Identificador inválido' });

    const os = await buscarOsPorId(params.data.id);
    if (!os) return reply.code(404).send({ erro: 'OS não encontrada' });

    return { itens: await listarTentativas(params.data.id) };
  });
}
