import { prisma } from '../../shared/prisma.js';
import type { DataISO } from './dias-uteis.js';

/**
 * Carrega os feriados do intervalo (inclusive) como Set de 'YYYY-MM-DD'.
 * Usa SQL direto para não depender de como o `db pull` nomeia o model.
 */
export async function carregarFeriados(de: DataISO, ate: DataISO): Promise<Set<DataISO>> {
  const rows = await prisma.$queryRaw<{ data: string }[]>`
    SELECT to_char(data, 'YYYY-MM-DD') AS data
      FROM feriado
     WHERE data BETWEEN ${de}::date AND ${ate}::date`;
  return new Set(rows.map((r: { data: string }) => r.data));
}
