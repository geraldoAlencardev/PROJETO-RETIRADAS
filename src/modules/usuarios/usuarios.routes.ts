import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashSenha, SENHA_MAX_BYTES, SENHA_MIN } from './senha.js';
import {
  atualizarUsuario,
  buscarPorLogin,
  buscarUsuarioPublico,
  criarUsuario,
  listarUsuarios,
} from './usuarios.repository.js';

const idParams = z.object({ id: z.string().uuid() });

const senha = z
  .string()
  .min(SENHA_MIN, `A senha deve ter pelo menos ${SENHA_MIN} caracteres`)
  .refine((s) => Buffer.byteLength(s) <= SENHA_MAX_BYTES, {
    message: `A senha deve ter no máximo ${SENHA_MAX_BYTES} bytes`,
  });

const criacaoBody = z.object({
  nome: z.string().trim().min(1).max(150),
  login: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,100}$/, 'Use de 3 a 100 caracteres: letras, números, ponto, _ ou -'),
  senha,
});

const edicaoBody = z
  .object({
    nome: z.string().trim().min(1).max(150).optional(),
    senha: senha.optional(),
    ativo: z.boolean().optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Informe ao menos um campo');

// Perfil único: todo usuário pode gerenciar os demais (RN05).
export async function usuariosRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/usuarios', async () => ({ itens: await listarUsuarios() }));

  app.post('/usuarios', async (req, reply) => {
    const body = criacaoBody.safeParse(req.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ erro: 'Corpo inválido', detalhes: body.error.flatten().fieldErrors });
    }
    const { nome, login } = body.data;
    if (await buscarPorLogin(login)) {
      return reply.code(409).send({ erro: `Já existe um usuário com o login "${login}"` });
    }

    const { id } = await criarUsuario({
      nome,
      login,
      senhaHash: await hashSenha(body.data.senha),
    });
    return reply.code(201).send(await buscarUsuarioPublico(id));
  });

  // Editar nome, trocar senha ou ativar/desativar. Login não muda (é a identidade no histórico).
  app.patch('/usuarios/:id', async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ erro: 'Identificador inválido' });

    const body = edicaoBody.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ erro: 'Corpo inválido', detalhes: body.error.flatten() });
    }
    if (body.data.ativo === false && params.data.id === req.usuario!.id) {
      return reply.code(409).send({ erro: 'Você não pode desativar o próprio usuário' });
    }

    const existe = await atualizarUsuario(params.data.id, {
      nome: body.data.nome,
      senhaHash: body.data.senha ? await hashSenha(body.data.senha) : undefined,
      ativo: body.data.ativo,
    });
    if (!existe) return reply.code(404).send({ erro: 'Usuário não encontrado' });
    return buscarUsuarioPublico(params.data.id);
  });
}
