import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buscarOsPorId, contarPorStatus, listarOs } from './os.repository.js';
import { STATUS_OS } from './status.js';

// Aceita ?status=PENDENTE,ATRASADA e também ?status=PENDENTE&status=ATRASADA
// (maiúsculas ou minúsculas). Sem o parâmetro, não filtra por status.
const statusParam = z.preprocess(
  (valor) => {
    if (valor === undefined) return undefined;
    const lista = (Array.isArray(valor) ? valor : [valor]).flatMap((v) => String(v).split(','));
    const limpa = lista.map((s) => s.trim().toUpperCase()).filter(Boolean);
    return limpa.length > 0 ? limpa : undefined;
  },
  z.array(z.enum(STATUS_OS)).optional(),
);

const listaQuery = z.object({
  status: statusParam,
  busca: z.string().trim().max(100).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  tamanho: z.coerce.number().int().min(1).max(100).default(20),
});

const idParams = z.object({ id: z.string().uuid() });

export async function osRoutes(app: FastifyInstance) {
  // Todas as rotas deste módulo exigem sessão.
  app.addHook('preHandler', app.authenticate);

  // Fila de acompanhamento (RF07) com filtro por status (RF08), busca e paginação.
  app.get('/os', async (req, reply) => {
    const parsed = listaQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ erro: 'Parâmetros inválidos', detalhes: parsed.error.flatten().fieldErrors });
    }
    const { status, busca, pagina, tamanho } = parsed.data;

    const { itens, total } = await listarOs({
      status,
      busca: busca || undefined,
      limite: tamanho,
      deslocamento: (pagina - 1) * tamanho,
    });

    return { itens, total, pagina, tamanho, totalPaginas: Math.ceil(total / tamanho) };
  });

  // Quantidade de OS por status (útil para as abas/filtros da fila).
  app.get('/os/resumo', async () => contarPorStatus());

  app.get('/os/:id', async (req, reply) => {
    const parsed = idParams.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ erro: 'Identificador inválido' });

    const os = await buscarOsPorId(parsed.data.id);
    if (!os) return reply.code(404).send({ erro: 'OS não encontrada' });
    return os;
  });
}
