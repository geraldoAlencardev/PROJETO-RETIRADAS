/**
 * De onde a sincronização LÊ as OS do IXC, uma página por vez.
 * O IXC é apenas origem de dados: a fonte só busca (GET), nunca envia nada ao IXC.
 *
 * A implementação real (cliente HTTP do IXC) ainda não existe; enquanto isso a sincronização
 * responde "não configurada". Os testes usam uma fonte simulada.
 */
export interface FonteOsIxc {
  /** `pagina` começa em 1. Retorna o total de registros da consulta e os registros da página. */
  buscarPagina(pagina: number, tamanho: number): Promise<PaginaIxc>;
}

/** Formato da resposta do IXC: { page, total, registros }. `total` vem como texto. */
export interface PaginaIxc {
  total: number | string;
  registros?: unknown[];
}
