/**
 * Escapa os caracteres especiais do LIKE/ILIKE (\, % e _) para que o texto digitado
 * pelo usuário seja tratado como texto literal. O escape padrão do PostgreSQL é a barra invertida.
 */
export function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, '\\$&');
}
