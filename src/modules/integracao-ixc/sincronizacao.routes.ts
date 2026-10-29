import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { FonteOsIxc } from './fonte-ixc.js';
import {
  buscarSincronizacao,
  buscarUltimaSincronizacao,
  executarSincronizacao,
  iniciarSincronizacao,
  SincronizacaoEmAndamentoError,
  SincronizacaoRecenteError,
} from './sincronizacao.service.js';

const idParams = z.object({ id: z.string().uuid() });

export interface OpcoesSincronizacaoRoutes {
  /** Fonte das OS do IXC. Sem ela, o botão responde que a integração não está configurada. */
  fonte?: FonteOsIxc;
}

export async function sincronizacaoRoutes(app: FastifyInstance, opcoes: OpcoesSincronizacaoRoutes) {
  app.addHook('preHandler', app.authenticate);

  // Botão "Sincronizar agora". Responde na hora (202) e a leitura do IXC segue em segundo plano;
  // o front acompanha por GET /sincronizacoes/:id.
  app.post('/sincronizacoes', async (req, reply) => {
    const fonte = opcoes.fonte;
    if (!fonte) {
      return reply.code(503).send({ erro: 'Integração com o IXC ainda não configurada' });
    }

    try {
      const id = await iniciarSincronizacao(req.usuario!.id);
      void executarSincronizacao(id, fonte).catch((erro: unknown) =>
        req.log.error({ err: erro, sincronizacao: id }, 'Falha na sincronização com o IXC'),
      );
      return reply.code(202).send({ id, situacao: 'EM_ANDAMENTO' });
    } catch (erro) {
      if (erro instanceof SincronizacaoEmAndamentoError) {
        return reply.code(409).send({ erro: erro.message });
      }
      if (erro instanceof SincronizacaoRecenteError) {
        return reply.code(429).send({ erro: erro.message, liberadaEm: erro.liberadaEm });
      }
      throw erro;
    }
  });

  // Situação da última sincronização (para o front mostrar "última sincronização em ...").
  app.get('/sincronizacoes/ultima', async (_req, reply) => {
    const ultima = await buscarUltimaSincronizacao();
    if (!ultima) return reply.code(404).send({ erro: 'Nenhuma sincronização realizada' });
    return ultima;
  });

  app.get('/sincronizacoes/:id', async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ erro: 'Identificador inválido' });

    const sincronizacao = await buscarSincronizacao(params.data.id);
    if (!sincronizacao) return reply.code(404).send({ erro: 'Sincronização não encontrada' });
    return sincronizacao;
  });
}
