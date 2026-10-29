// Grava no banco as OS recebidas do IXC. Só RECEBE dados: nada é enviado ao IXC.
//
// Regras (RN08 e decisões da integração):
//  - OS nova e não finalizada no IXC → criada em Pendente;
//  - OS nova já finalizada no IXC (F) → ignorada (não entra no sistema);
//  - OS existente → atualiza só os campos de origem; status e contadores operacionais não mudam;
//  - OS existente que ficou F no IXC → vai para Retirada OK (T16) a partir de qualquer status
//    não final; se já estiver em status final, mantém o status local e registra no histórico.
// Cada OS é gravada na própria transação: um registro com problema não derruba os demais.
import { env } from '../../config/env.js';
import type { Executor } from '../../shared/db.js';
import { prisma } from '../../shared/prisma.js';
import { STATUS_FINAIS } from '../os/maquina-de-estados.js';
import { aplicarEvento } from '../os/os.service.js';
import type { StatusOs } from '../os/status.js';
import { converterRegistroIxc, STATUS_IXC_FINALIZADA, type OsOrigem } from './registro-ixc.js';

export type ResultadoImportacao =
  | { tipo: 'CRIADA'; osExternaId: string }
  | { tipo: 'ATUALIZADA'; osExternaId: string; camposAlterados: string[] }
  | { tipo: 'FINALIZADA'; osExternaId: string; statusAnterior: StatusOs }
  | { tipo: 'INALTERADA'; osExternaId: string }
  | { tipo: 'IGNORADA'; osExternaId: string; motivo: string }
  | { tipo: 'ERRO'; osExternaId: string | null; erro: string };

export interface ResumoImportacao {
  recebidos: number;
  criadas: number;
  atualizadas: number;
  finalizadas: number;
  ignoradas: number;
  comErro: number;
  /** Primeiros erros, para diagnóstico (o total está em `comErro`). */
  erros: { osExternaId: string | null; erro: string }[];
}

const MAX_ERROS_NO_RESUMO = 20;

/** Campos de origem comparados para o log de alteração: [coluna no log, campo da OsOrigem]. */
const CAMPOS_ORIGEM: [string, keyof OsOrigem][] = [
  ['cliente_externo_id', 'clienteExternoId'],
  ['contrato_id', 'contratoId'],
  ['protocolo_externo', 'protocoloExterno'],
  ['endereco', 'endereco'],
  ['bairro', 'bairro'],
  ['referencia', 'referencia'],
  ['data_abertura', 'dataAbertura'],
  ['status_externo', 'statusExterno'],
  ['ultima_atualizacao_externa', 'ultimaAtualizacaoExterna'],
];

type OrigemAtual = { id: string; status: StatusOs } & Omit<OsOrigem, 'osExternaId' | 'assuntoId'>;

async function inserirNova(tx: Executor, os: OsOrigem): Promise<void> {
  const inseridas = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO os (os_externa_id, cliente_externo_id, contrato_id, protocolo_externo,
                    endereco, bairro, referencia, data_abertura,
                    status_externo, ultima_atualizacao_externa, sincronizado_em)
    VALUES (${os.osExternaId}, ${os.clienteExternoId}, ${os.contratoId}, ${os.protocoloExterno},
            ${os.endereco}, ${os.bairro}, ${os.referencia}, ${os.dataAbertura}::date,
            ${os.statusExterno}, ${os.ultimaAtualizacaoExterna}::timestamp, now())
    RETURNING id`;
  const descricao = `OS recebida do IXC${os.protocoloExterno ? ` (protocolo ${os.protocoloExterno})` : ''}`;
  await tx.$executeRaw`
    INSERT INTO historico_evento (os_id, usuario_id, data_hora, tipo_evento, descricao)
    VALUES (${inseridas[0]!.id}::uuid, NULL, clock_timestamp(), 'RECEBIMENTO', ${descricao})`;
}

async function atualizarExistente(
  tx: Executor,
  atual: OrigemAtual,
  os: OsOrigem,
): Promise<ResultadoImportacao> {
  const alterados = CAMPOS_ORIGEM.filter(
    ([, campo]) => (atual[campo as keyof OrigemAtual] ?? null) !== (os[campo] ?? null),
  );

  if (alterados.length > 0) {
    await tx.$executeRaw`
      UPDATE os
         SET cliente_externo_id         = ${os.clienteExternoId},
             contrato_id                = ${os.contratoId},
             protocolo_externo          = ${os.protocoloExterno},
             endereco                   = ${os.endereco},
             bairro                     = ${os.bairro},
             referencia                 = ${os.referencia},
             data_abertura              = ${os.dataAbertura}::date,
             status_externo             = ${os.statusExterno},
             ultima_atualizacao_externa = ${os.ultimaAtualizacaoExterna}::timestamp,
             sincronizado_em            = now()
       WHERE id = ${atual.id}::uuid`;
    for (const [coluna, campo] of alterados) {
      await tx.$executeRaw`
        INSERT INTO log_alteracao (os_id, usuario_id, campo_alterado, valor_anterior, valor_novo)
        VALUES (${atual.id}::uuid, NULL, ${coluna},
                ${atual[campo as keyof OrigemAtual] ?? null}, ${os[campo] ?? null})`;
    }
  } else {
    await tx.$executeRaw`UPDATE os SET sincronizado_em = now() WHERE id = ${atual.id}::uuid`;
  }

  const finalizadaNoIxc = os.statusExterno === STATUS_IXC_FINALIZADA;
  const statusExternoMudou = atual.statusExterno !== os.statusExterno;

  if (finalizadaNoIxc && !STATUS_FINAIS.includes(atual.status)) {
    await aplicarEvento(tx, {
      osId: atual.id,
      usuarioId: null,
      evento: { tipo: 'FINALIZAR_NO_IXC' },
      motivo: 'Chamado finalizado no IXC',
    });
    return { tipo: 'FINALIZADA', osExternaId: os.osExternaId, statusAnterior: atual.status };
  }
  if (finalizadaNoIxc && statusExternoMudou) {
    await tx.$executeRaw`
      INSERT INTO historico_evento (os_id, usuario_id, data_hora, tipo_evento, descricao)
      VALUES (${atual.id}::uuid, NULL, clock_timestamp(), 'SINCRONIZACAO',
              ${`Chamado finalizado no IXC; status local ${atual.status} mantido (status final)`})`;
  }

  return alterados.length > 0
    ? {
        tipo: 'ATUALIZADA',
        osExternaId: os.osExternaId,
        camposAlterados: alterados.map(([coluna]) => coluna),
      }
    : { tipo: 'INALTERADA', osExternaId: os.osExternaId };
}

/** Importa um registro cru do IXC (no formato de `su_oss_chamado`). Nunca lança. */
export async function importarRegistro(registro: unknown): Promise<ResultadoImportacao> {
  const conversao = converterRegistroIxc(registro);
  if (!conversao.ok) {
    return { tipo: 'ERRO', osExternaId: conversao.osExternaId, erro: conversao.erro };
  }
  const os = conversao.os;

  if (os.assuntoId !== env.IXC_ID_ASSUNTO_RETIRADA) {
    return {
      tipo: 'IGNORADA',
      osExternaId: os.osExternaId,
      motivo: `assunto ${os.assuntoId} não é retirada`,
    };
  }

  try {
    return await prisma.$transaction(async (tx: Executor) => {
      const linhas = await tx.$queryRaw<OrigemAtual[]>`
        SELECT id,
               status::text                                           AS status,
               cliente_externo_id                                     AS "clienteExternoId",
               contrato_id                                            AS "contratoId",
               protocolo_externo                                      AS "protocoloExterno",
               endereco,
               bairro,
               referencia,
               to_char(data_abertura, 'YYYY-MM-DD')                   AS "dataAbertura",
               status_externo                                         AS "statusExterno",
               to_char(ultima_atualizacao_externa, 'YYYY-MM-DD HH24:MI:SS')
                                                                      AS "ultimaAtualizacaoExterna"
          FROM os
         WHERE os_externa_id = ${os.osExternaId}
           FOR UPDATE`;
      const atual = linhas[0];

      if (atual) return atualizarExistente(tx, atual, os);

      if (os.statusExterno === STATUS_IXC_FINALIZADA) {
        return {
          tipo: 'IGNORADA',
          osExternaId: os.osExternaId,
          motivo: 'já finalizada no IXC',
        } as const;
      }
      await inserirNova(tx, os);
      return { tipo: 'CRIADA', osExternaId: os.osExternaId } as const;
    });
  } catch (erro) {
    return {
      tipo: 'ERRO',
      osExternaId: os.osExternaId,
      erro: erro instanceof Error ? erro.message : String(erro),
    };
  }
}

export function resumoVazio(): ResumoImportacao {
  return {
    recebidos: 0,
    criadas: 0,
    atualizadas: 0,
    finalizadas: 0,
    ignoradas: 0,
    comErro: 0,
    erros: [],
  };
}

/** Soma um resultado ao resumo (alterando-o). */
export function contabilizar(resumo: ResumoImportacao, resultado: ResultadoImportacao): void {
  resumo.recebidos++;
  switch (resultado.tipo) {
    case 'CRIADA':
      resumo.criadas++;
      break;
    case 'ATUALIZADA':
      resumo.atualizadas++;
      break;
    case 'FINALIZADA':
      resumo.finalizadas++;
      break;
    case 'IGNORADA':
      resumo.ignoradas++;
      break;
    case 'ERRO':
      resumo.comErro++;
      if (resumo.erros.length < MAX_ERROS_NO_RESUMO) {
        resumo.erros.push({ osExternaId: resultado.osExternaId, erro: resultado.erro });
      }
      break;
    case 'INALTERADA':
      break;
  }
}

/** Importa uma lista de registros, um por vez, e devolve o resumo. */
export async function importarRegistros(registros: unknown[]): Promise<ResumoImportacao> {
  const resumo = resumoVazio();
  for (const registro of registros) contabilizar(resumo, await importarRegistro(registro));
  return resumo;
}
