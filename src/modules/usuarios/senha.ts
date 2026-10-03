import bcrypt from 'bcryptjs';

const CUSTO = 12;

export const SENHA_MIN = 8;
// bcrypt considera apenas os primeiros 72 bytes da senha.
export const SENHA_MAX_BYTES = 72;

export function hashSenha(senha: string): Promise<string> {
  return bcrypt.hash(senha, CUSTO);
}

export function conferirSenha(senha: string, hash: string): Promise<boolean> {
  return bcrypt.compare(senha, hash);
}

let hashFalso: Promise<string> | undefined;

/**
 * Gasta o mesmo tempo de uma conferência real quando o usuário não existe (ou está inativo),
 * para que o tempo de resposta não revele quais logins existem.
 */
export async function conferirContraHashFalso(senha: string): Promise<void> {
  hashFalso ??= hashSenha('hash-falso-para-igualar-tempo-de-resposta');
  await bcrypt.compare(senha, await hashFalso);
}
