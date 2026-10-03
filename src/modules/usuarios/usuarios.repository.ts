import { prisma } from '../../shared/prisma.js';

export interface Usuario {
  id: string;
  nome: string;
  login: string;
  senha_hash: string;
  ativo: boolean;
}

// SQL direto (mesma abordagem do módulo feriado): independe de como o `db pull` nomeia os models.

export async function buscarPorLogin(login: string): Promise<Usuario | null> {
  const rows = await prisma.$queryRaw<Usuario[]>`
    SELECT id, nome, login, senha_hash, ativo
      FROM usuario
     WHERE login = ${login}`;
  return rows[0] ?? null;
}

export async function buscarPorId(id: string): Promise<Usuario | null> {
  const rows = await prisma.$queryRaw<Usuario[]>`
    SELECT id, nome, login, senha_hash, ativo
      FROM usuario
     WHERE id = ${id}::uuid`;
  return rows[0] ?? null;
}

export async function criarUsuario(dados: {
  nome: string;
  login: string;
  senhaHash: string;
}): Promise<{ id: string }> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO usuario (nome, login, senha_hash)
    VALUES (${dados.nome}, ${dados.login}, ${dados.senhaHash})
    RETURNING id`;
  return rows[0]!;
}
