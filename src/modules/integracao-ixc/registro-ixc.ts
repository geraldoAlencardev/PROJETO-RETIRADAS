// Formato em que as OS chegam do IXC (su_oss_chamado) e conversão para os campos de origem
// da nossa tabela `os`. O IXC é apenas ORIGEM de dados: nada daqui é enviado de volta a ele.
//
// Observações sobre o formato do IXC:
// - todos os valores vêm como texto, inclusive números e datas;
// - datas vêm como 'YYYY-MM-DD HH:MM:SS' (horário local) e "vazias" como '0000-00-00 00:00:00';
// - o chamado não traz o nome do cliente, só `id_cliente`.
import { z } from 'zod';

/** Status do chamado no IXC. */
export const STATUS_IXC = {
  A: 'Aberta',
  AN: 'Análise',
  EN: 'Encaminhada',
  AS: 'Assumida',
  AG: 'Agendada',
  DS: 'Deslocamento',
  EX: 'Execução',
  F: 'Finalizada',
  RAG: 'Aguardando agendamento',
} as const;

export const STATUS_IXC_FINALIZADA = 'F';

const texto = z.string().trim();
const textoOpcional = z
  .string()
  .nullish()
  .transform((v) => v?.trim() || null);
const idNumerico = z
  .string()
  .trim()
  .regex(/^\d{1,50}$/, 'deve ser um número');
const dataHoraIxc = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/, 'formato de data inválido');

/** Só os campos que usamos; os demais campos do IXC são ignorados. */
export const registroOsIxcSchema = z.object({
  id: idNumerico,
  id_assunto: idNumerico,
  id_cliente: idNumerico,
  id_contrato_kit: idNumerico,
  status: texto.pipe(z.string().min(1).max(5)),
  protocolo: textoOpcional,
  endereco: texto,
  complemento: textoOpcional,
  bairro: textoOpcional,
  referencia: textoOpcional,
  data_abertura: dataHoraIxc,
  ultima_atualizacao: dataHoraIxc.nullish(),
});

export type RegistroOsIxc = z.input<typeof registroOsIxcSchema>;

/** Campos de ORIGEM da OS (RN08). A sincronização só grava estes campos. */
export interface OsOrigem {
  osExternaId: string;
  assuntoId: string;
  clienteExternoId: string;
  contratoId: string;
  protocoloExterno: string | null;
  endereco: string;
  bairro: string | null;
  referencia: string | null;
  /** 'YYYY-MM-DD' */
  dataAbertura: string;
  statusExterno: string;
  /** 'YYYY-MM-DD HH:MM:SS' no horário local do IXC, ou nulo. */
  ultimaAtualizacaoExterna: string | null;
}

/** Corta o texto no tamanho da coluna do banco (o IXC não tem os mesmos limites). */
function limitar<T extends string | null>(valor: T, tamanho: number): T {
  return (valor === null ? null : valor.slice(0, tamanho)) as T;
}

/** '0000-00-00...' é como o IXC representa "sem data". */
function dataValida(valor: string | null | undefined): string | null {
  if (!valor || valor.startsWith('0000-00-00')) return null;
  return valor;
}

export type ResultadoConversao =
  { ok: true; os: OsOrigem } | { ok: false; osExternaId: string | null; erro: string };

/** Valida um registro cru do IXC e o converte. Nunca lança: registros ruins voltam como erro. */
export function converterRegistroIxc(registro: unknown): ResultadoConversao {
  const parsed = registroOsIxcSchema.safeParse(registro);
  if (!parsed.success) {
    const id = (registro as { id?: unknown } | null)?.id;
    const erro = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'registro'}: ${i.message}`)
      .join('; ');
    return { ok: false, osExternaId: typeof id === 'string' ? id : null, erro };
  }
  const r = parsed.data;

  const dataAbertura = dataValida(r.data_abertura)?.slice(0, 10) ?? null;
  if (!dataAbertura) {
    return { ok: false, osExternaId: r.id, erro: 'data_abertura: vazia no IXC' };
  }

  // O complemento entra junto com o endereço (ex.: "Rua A, 10 - Casa 2").
  const endereco = [r.endereco, r.complemento].filter(Boolean).join(' - ');

  return {
    ok: true,
    os: {
      osExternaId: r.id,
      assuntoId: r.id_assunto,
      clienteExternoId: r.id_cliente,
      contratoId: r.id_contrato_kit,
      protocoloExterno: limitar(r.protocolo, 50),
      endereco: limitar(endereco, 300),
      bairro: limitar(r.bairro, 100),
      referencia: limitar(r.referencia, 300),
      dataAbertura,
      statusExterno: r.status.toUpperCase(),
      ultimaAtualizacaoExterna: dataValida(r.ultima_atualizacao),
    },
  };
}
