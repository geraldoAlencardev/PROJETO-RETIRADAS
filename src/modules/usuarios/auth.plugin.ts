import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../../config/env.js';
import { buscarPorId } from './usuarios.repository.js';

export const COOKIE_NOME = 'os_token';

export interface UsuarioSessao {
  id: string;
  nome: string;
  login: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** preHandler: exige sessão válida e popula `request.usuario`. */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    usuario: UsuarioSessao | null;
  }
}

export const authPlugin = fp(
  async (app) => {
    await app.register(cookie);
    await app.register(jwt, {
      secret: env.JWT_SECRET,
      cookie: { cookieName: COOKIE_NOME, signed: false },
      sign: { expiresIn: `${env.SESSAO_HORAS}h` },
    });
    await app.register(rateLimit, { global: false });

    app.decorateRequest('usuario', null);

    app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        await req.jwtVerify();
        // Confere no banco para que um usuário desativado perca o acesso imediatamente.
        const usuario = await buscarPorId(req.user.sub);
        if (!usuario || !usuario.ativo) throw new Error('usuário inexistente ou inativo');
        req.usuario = { id: usuario.id, nome: usuario.nome, login: usuario.login };
      } catch {
        return reply.code(401).send({ erro: 'Não autenticado' });
      }
    });
  },
  { name: 'auth' },
);
