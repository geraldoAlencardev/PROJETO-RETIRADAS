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

/** Dados públicos do usuário (sem o hash da senha). */
export interface UsuarioPublico {
  id: string;
  nome: string;
  login: string;
  ativo: boolean;
  criadoEm: Date;
  atualizadoEm: Date;
}

export async function listarUsuarios(): Promise<UsuarioPublico[]> {
  return prisma.$queryRaw<UsuarioPublico[]>`
    SELECT id, nome, login, ativo, criado_em AS "criadoEm", atualizado_em AS "atualizadoEm"
      FROM usuario
     ORDER BY nome, login`;
}

export async function buscarUsuarioPublico(id: string): Promise<UsuarioPublico | null> {
  const rows = await prisma.$queryRaw<UsuarioPublico[]>`
    SELECT id, nome, login, ativo, criado_em AS "criadoEm", atualizado_em AS "atualizadoEm"
      FROM usuario
     WHERE id = ${id}::uuid`;
  return rows[0] ?? null;
}

/** Atualiza só os campos informados (undefined = não mexe). Retorna false se o usuário não existe. */
export async function atualizarUsuario(
  id: string,
  dados: { nome?: string; senhaHash?: string; ativo?: boolean },
): Promise<boolean> {
  const alteradas = await prisma.$executeRaw`
    UPDATE usuario
       SET nome          = COALESCE(${dados.nome ?? null}, nome),
           senha_hash    = COALESCE(${dados.senhaHash ?? null}, senha_hash),
           ativo         = COALESCE(${dados.ativo ?? null}::boolean, ativo),
           atualizado_em = now()
     WHERE id = ${id}::uuid`;
  return alteradas > 0;
}
