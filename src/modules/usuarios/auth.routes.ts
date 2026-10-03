import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { COOKIE_NOME } from './auth.plugin.js';
import { conferirContraHashFalso, conferirSenha } from './senha.js';
import { buscarPorLogin } from './usuarios.repository.js';

const loginBody = z.object({
  login: z.string().trim().min(1).max(100),
  senha: z.string().min(1).max(200),
});

const CREDENCIAIS_INVALIDAS = { erro: 'Login ou senha inválidos' };

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = loginBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ erro: 'Informe login e senha' });
      }
      const { senha } = parsed.data;
      const login = parsed.data.login.toLowerCase();

      const usuario = await buscarPorLogin(login);
      if (!usuario || !usuario.ativo) {
        await conferirContraHashFalso(senha);
        return reply.code(401).send(CREDENCIAIS_INVALIDAS);
      }
      if (!(await conferirSenha(senha, usuario.senha_hash))) {
        return reply.code(401).send(CREDENCIAIS_INVALIDAS);
      }

      const token = await reply.jwtSign({ sub: usuario.id });
      reply.setCookie(COOKIE_NOME, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: env.COOKIE_SECURE,
        path: '/',
        maxAge: env.SESSAO_HORAS * 3600,
      });
      return { usuario: { id: usuario.id, nome: usuario.nome, login: usuario.login } };
    },
  );

  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE_NOME, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/auth/me', { preHandler: app.authenticate }, async (req) => ({
    usuario: req.usuario,
  }));
}
