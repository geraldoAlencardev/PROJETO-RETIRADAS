// Sincronização sob demanda (botão "Sincronizar agora"): lê as OS do IXC página por página e
// importa cada uma. Só RECEBE dados do IXC; nada é enviado a ele.
//
// Proteções para não sobrecarregar o IXC:
//  - uma sincronização por vez (índice único no banco);
//  - intervalo mínimo entre sincronizações;
//  - uma página por vez, com pausa entre elas, e um teto de páginas por execução;
//  - qualquer falha da fonte encerra a execução (sem novas tentativas automáticas).
import { env } from '../../config/env.js';
import { prisma } from '../../shared/prisma.js';
import type { FonteOsIxc } from './fonte-ixc.js';
import {
  contabilizar,
  importarRegistro,
  resumoVazio,
  type ResumoImportacao,
} from './importacao.service.js';

export class SincronizacaoEmAndamentoError extends Error {
  constructor() {
    super('Já existe uma sincronização em andamento.');
    this.name = 'SincronizacaoEmAndamentoError';
  }
}

export class SincronizacaoRecenteError extends Error {
  constructor(public readonly liberadaEm: Date) {
    super('Uma sincronização foi feita há pouco tempo. Aguarde para sincronizar de novo.');
    this.name = 'SincronizacaoRecenteError';
  }
}

export type Situacao = 'EM_ANDAMENTO' | 'CONCLUIDA' | 'FALHOU';

export interface Sincronizacao {
  id: string;
  usuarioNome: string;
  iniciadaEm: Date;
  finalizadaEm: Date | null;
  situacao: Situacao;
  paginas: number;
  recebidos: number;
  criadas: number;
  atualizadas: number;
  finalizadas: number;
  ignoradas: number;
  comErro: number;
  erro: string | null;
}

export interface OpcoesSincronizacao {
  tamanhoPagina: number;
  /** Pausa entre uma página e a próxima, para aliviar o IXC. */
  pausaMs: number;
  /** Trava de segurança: nunca lê mais que isto numa execução. */
  maxPaginas: number;
}

export const OPCOES_PADRAO: OpcoesSincronizacao = {
  tamanhoPagina: 100,
  pausaMs: 300,
  maxPaginas: 500,
};

/** Execuções "em andamento" há mais que isto são consideradas interrompidas (ex.: queda da API). */
const ABANDONO_MINUTOS = 60;

const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Registra o início da sincronização, respeitando as travas. Retorna o id da execução.
 * Separado de `executarSincronizacao` para a rota responder logo (202) e o trabalho seguir
 * em segundo plano.
 */
export async function iniciarSincronizacao(usuarioId: string): Promise<string> {
  // Libera execuções que ficaram presas (processo encerrado no meio).
  await prisma.$executeRaw`
    UPDATE sincronizacao
       SET situacao = 'FALHOU', finalizada_em = now(), erro = 'Interrompida (sem conclusão)'
     WHERE situacao = 'EM_ANDAMENTO'
       AND iniciada_em < now() - make_interval(mins => ${ABANDONO_MINUTOS}::int)`;

  const ultimas = await prisma.$queryRaw<{ situacao: Situacao; liberadaEm: Date | null }[]>`
    SELECT situacao,
           finalizada_em + make_interval(mins => ${env.SINCRONIZACAO_INTERVALO_MIN_MINUTOS}::int)
             AS "liberadaEm"
      FROM sincronizacao
     ORDER BY iniciada_em DESC
     LIMIT 1`;
  const ultima = ultimas[0];
  if (ultima?.situacao === 'EM_ANDAMENTO') throw new SincronizacaoEmAndamentoError();
  if (ultima?.liberadaEm && ultima.liberadaEm > new Date()) {
    throw new SincronizacaoRecenteError(ultima.liberadaEm);
  }

  try {
    const criadas = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO sincronizacao (usuario_id) VALUES (${usuarioId}::uuid) RETURNING id`;
    return criadas[0]!.id;
  } catch (erro) {
    // Dois cliques ao mesmo tempo: o índice único deixa só um passar.
    if (String((erro as Error)?.message).includes('ux_sincronizacao_em_andamento')) {
      throw new SincronizacaoEmAndamentoError();
    }
    throw erro;
  }
}

async function gravarProgresso(
  id: string,
  paginas: number,
  resumo: ResumoImportacao,
  fim?: { situacao: Exclude<Situacao, 'EM_ANDAMENTO'>; erro: string | null },
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE sincronizacao
       SET paginas       = ${paginas}::int,
           recebidos     = ${resumo.recebidos}::int,
           criadas       = ${resumo.criadas}::int,
           atualizadas   = ${resumo.atualizadas}::int,
           finalizadas   = ${resumo.finalizadas}::int,
           ignoradas     = ${resumo.ignoradas}::int,
           com_erro      = ${resumo.comErro}::int,
           situacao      = COALESCE(${fim?.situacao ?? null}::text, situacao),
           finalizada_em = CASE WHEN ${fim ? true : false}::boolean THEN now() ELSE NULL END,
           erro          = ${fim?.erro ?? null}
     WHERE id = ${id}::uuid`;
}

/** Lê todas as páginas da fonte e importa os registros. Nunca lança: o resultado fica gravado. */
export async function executarSincronizacao(
  id: string,
  fonte: FonteOsIxc,
  opcoes: OpcoesSincronizacao = OPCOES_PADRAO,
): Promise<ResumoImportacao> {
  const resumo = resumoVazio();
  let paginas = 0;

  try {
    let totalPaginas = 1;
    for (let pagina = 1; pagina <= totalPaginas; pagina++) {
      if (pagina > opcoes.maxPaginas) {
        throw new Error(`Limite de ${opcoes.maxPaginas} páginas por sincronização atingido.`);
      }
      if (pagina > 1) await esperar(opcoes.pausaMs);

      const resposta = await fonte.buscarPagina(pagina, opcoes.tamanhoPagina);
      paginas++;
      const total = Number(resposta.total);
      if (!Number.isFinite(total) || total < 0) {
        throw new Error('Resposta do IXC sem "total" válido.');
      }
      totalPaginas = Math.ceil(total / opcoes.tamanhoPagina);

      const registros = resposta.registros ?? [];
      for (const registro of registros) contabilizar(resumo, await importarRegistro(registro));
      await gravarProgresso(id, paginas, resumo);

      // Página vazia antes do fim previsto: o total mudou durante a leitura; encerra.
      if (registros.length === 0) break;
    }

    await gravarProgresso(id, paginas, resumo, { situacao: 'CONCLUIDA', erro: null });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    await gravarProgresso(id, paginas, resumo, { situacao: 'FALHOU', erro: mensagem }).catch(
      () => undefined,
    );
  }
  return resumo;
}

// Atenção: a lista de colunas é idêntica nas duas consultas abaixo.

export async function buscarSincronizacao(id: string): Promise<Sincronizacao | null> {
  const linhas = await prisma.$queryRaw<Sincronizacao[]>`
    SELECT s.id, u.nome AS "usuarioNome", s.iniciada_em AS "iniciadaEm",
           s.finalizada_em AS "finalizadaEm", s.situacao, s.paginas, s.recebidos, s.criadas,
           s.atualizadas, s.finalizadas, s.ignoradas, s.com_erro AS "comErro", s.erro
      FROM sincronizacao s
      JOIN usuario u ON u.id = s.usuario_id
     WHERE s.id = ${id}::uuid`;
  return linhas[0] ?? null;
}

export async function buscarUltimaSincronizacao(): Promise<Sincronizacao | null> {
  const linhas = await prisma.$queryRaw<Sincronizacao[]>`
    SELECT s.id, u.nome AS "usuarioNome", s.iniciada_em AS "iniciadaEm",
           s.finalizada_em AS "finalizadaEm", s.situacao, s.paginas, s.recebidos, s.criadas,
           s.atualizadas, s.finalizadas, s.ignoradas, s.com_erro AS "comErro", s.erro
      FROM sincronizacao s
      JOIN usuario u ON u.id = s.usuario_id
     ORDER BY s.iniciada_em DESC
     LIMIT 1`;
  return linhas[0] ?? null;
}
