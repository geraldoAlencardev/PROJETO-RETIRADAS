/**
 * O mínimo que o código de negócio precisa de uma conexão: rodar SQL.
 * Tanto o `prisma` quanto o `tx` de uma transação (`prisma.$transaction`) satisfazem esta interface,
 * então uma mesma função pode rodar dentro ou fora de uma transação.
 */
export interface Executor {
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}
