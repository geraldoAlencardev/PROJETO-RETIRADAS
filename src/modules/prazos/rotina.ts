import type { FastifyBaseLogger } from 'fastify';
import { processarPrazos } from './prazos.service.js';

/**
 * Roda `processarPrazos` ao iniciar e depois a cada `intervaloMinutos`.
 * Nunca roda duas vezes ao mesmo tempo no mesmo processo; se houver mais de uma instância da API,
 * a trava por OS do `processarPrazos` evita aplicar o mesmo evento duas vezes.
 * Retorna a função que para a rotina (usada no encerramento do servidor).
 */
export function iniciarRotinaPrazos(log: FastifyBaseLogger, intervaloMinutos: number): () => void {
  let rodando = false;

  const executar = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const resumo = await processarPrazos();
      log.info({ prazos: resumo }, 'Rotina de prazos executada');
    } catch (erro) {
      log.error({ err: erro }, 'Falha na rotina de prazos');
    } finally {
      rodando = false;
    }
  };

  void executar();
  const timer = setInterval(executar, intervaloMinutos * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
