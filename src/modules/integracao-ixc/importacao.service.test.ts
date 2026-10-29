import { beforeEach, describe, expect, it, vi } from 'vitest';

// `tx` simula a conexão da transação; `comandos` guarda o SQL e os valores, na ordem.
const { tx, comandos, estado } = vi.hoisted(() => ({
  tx: { $queryRaw: vi.fn(), $executeRaw: vi.fn() },
  comandos: [] as { sql: string; valores: unknown[] }[],
  estado: { existente: null as Record<string, unknown> | null },
}));

vi.mock('../../shared/prisma.js', () => ({
  prisma: { $transaction: (fn: (t: unknown) => unknown) => fn(tx) },
}));
vi.mock('../os/os.service.js', async () => {
  const real = await vi.importActual<typeof import('../os/os.service.js')>('../os/os.service.js');
  return { ...real, aplicarEvento: vi.fn() };
});

import { aplicarEvento } from '../os/os.service.js';
import { importarRegistro, importarRegistros } from './importacao.service.js';
import { registroIxc } from './registro-ixc.fixture.js';

const OS_ID = '22222222-2222-2222-2222-222222222222';

/** Como a OS já gravada volta do SELECT (mesmos dados do registro da fixture). */
function osGravada(sobrescrever: Record<string, unknown> = {}) {
  return {
    id: OS_ID,
    status: 'EM_CONTATO',
    clienteExternoId: '7890',
    contratoId: '4321',
    protocoloExterno: '202610280001',
    endereco: 'Rua das Palmeiras, 120 - Casa 2',
    bairro: 'Centro',
    referencia: 'Próximo à praça',
    dataAbertura: '2026-10-27',
    statusExterno: 'A',
    ultimaAtualizacaoExterna: '2026-10-27 10:00:00',
    ...sobrescrever,
  };
}

const sqls = () => comandos.map((c) => c.sql);
const logs = () => comandos.filter((c) => c.sql.includes('INSERT INTO log_alteracao'));

beforeEach(() => {
  comandos.length = 0;
  estado.existente = null;
  vi.mocked(aplicarEvento).mockReset();
  tx.$queryRaw.mockReset();
  tx.$executeRaw.mockReset();

  tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...valores: unknown[]) => {
    const sql = strings.join('?');
    comandos.push({ sql, valores });
    if (sql.includes('FOR UPDATE')) return estado.existente ? [estado.existente] : [];
    if (sql.includes('INSERT INTO os')) return [{ id: OS_ID }];
    return [];
  });
  tx.$executeRaw.mockImplementation(
    async (strings: TemplateStringsArray, ...valores: unknown[]) => {
      comandos.push({ sql: strings.join('?'), valores });
      return 1;
    },
  );
});

describe('OS nova', () => {
  it('cria em Pendente (status padrão) com os campos de origem e registra o recebimento', async () => {
    const r = await importarRegistro(registroIxc());

    expect(r).toEqual({ tipo: 'CRIADA', osExternaId: '123456' });
    const insert = comandos.find((c) => c.sql.includes('INSERT INTO os'))!;
    expect(insert.sql).not.toContain('status,'); // status operacional fica no padrão (PENDENTE)
    expect(insert.valores).toEqual(
      expect.arrayContaining(['123456', '7890', '4321', 'Rua das Palmeiras, 120 - Casa 2', 'A']),
    );
    const historico = comandos.find((c) => c.sql.includes('INSERT INTO historico_evento'))!;
    expect(historico.sql).toContain("'RECEBIMENTO'");
    expect(historico.valores).toContain('OS recebida do IXC (protocolo 202610280001)');
    expect(aplicarEvento).not.toHaveBeenCalled();
  });

  it('ignora OS que já chega finalizada no IXC, sem gravar nada', async () => {
    const r = await importarRegistro(registroIxc({ status: 'F' }));

    expect(r).toEqual({ tipo: 'IGNORADA', osExternaId: '123456', motivo: 'já finalizada no IXC' });
    expect(sqls().some((s) => s.includes('INSERT'))).toBe(false);
  });

  it('ignora chamados de outro assunto, sem consultar o banco', async () => {
    const r = await importarRegistro(registroIxc({ id_assunto: '3' }));

    expect(r).toMatchObject({ tipo: 'IGNORADA', motivo: 'assunto 3 não é retirada' });
    expect(comandos).toHaveLength(0);
  });
});

describe('OS existente', () => {
  it('sem mudanças: só marca a data da sincronização', async () => {
    estado.existente = osGravada();

    const r = await importarRegistro(registroIxc());

    expect(r).toEqual({ tipo: 'INALTERADA', osExternaId: '123456' });
    expect(sqls().filter((s) => s.startsWith('UPDATE os'))).toEqual([
      'UPDATE os SET sincronizado_em = now() WHERE id = ?::uuid',
    ]);
    expect(logs()).toHaveLength(0);
  });

  it('atualiza só campos de origem e registra cada alteração no log, sem usuário', async () => {
    estado.existente = osGravada();

    const r = await importarRegistro(registroIxc({ bairro: 'Gravatá', status: 'AG' }));

    expect(r).toEqual({
      tipo: 'ATUALIZADA',
      osExternaId: '123456',
      camposAlterados: ['bairro', 'status_externo'],
    });
    const update = comandos.find((c) => c.sql.includes('UPDATE os') && c.sql.includes('SET'))!;
    // RN08: nada de status, contadores ou datas operacionais.
    for (const operacional of [
      'status =',
      'status::',
      'qtd_',
      'data_entrada_status',
      'data_ultima_interacao',
    ]) {
      expect(update.sql).not.toContain(operacional);
    }
    expect(logs().map((l) => l.valores)).toEqual([
      [OS_ID, 'bairro', 'Centro', 'Gravatá'],
      [OS_ID, 'status_externo', 'A', 'AG'],
    ]);
    expect(logs()[0]!.sql).toContain('NULL'); // usuário nulo: alteração automática
    expect(aplicarEvento).not.toHaveBeenCalled();
  });

  it.each(['PENDENTE', 'EM_CONTATO', 'AGENDADA', 'ATRASADA', 'EM_EXTRAVIO', 'EM_REATIVACAO'])(
    'finalizada no IXC: leva %s para Retirada OK (T16), sem usuário',
    async (status) => {
      estado.existente = osGravada({ status });
      vi.mocked(aplicarEvento).mockResolvedValue({
        de: status as never,
        para: 'RETIRADA_OK',
        codigo: 'T16',
      });

      const r = await importarRegistro(registroIxc({ status: 'F' }));

      expect(r).toEqual({ tipo: 'FINALIZADA', osExternaId: '123456', statusAnterior: status });
      expect(aplicarEvento).toHaveBeenCalledWith(tx, {
        osId: OS_ID,
        usuarioId: null,
        evento: { tipo: 'FINALIZAR_NO_IXC' },
        motivo: 'Chamado finalizado no IXC',
      });
    },
  );

  it('finalizada no IXC com OS em status final: mantém o status e registra no histórico', async () => {
    estado.existente = osGravada({ status: 'MULTA_GERADA' });

    const r = await importarRegistro(registroIxc({ status: 'F' }));

    expect(r).toMatchObject({ tipo: 'ATUALIZADA', camposAlterados: ['status_externo'] });
    expect(aplicarEvento).not.toHaveBeenCalled();
    const historico = comandos.find((c) => c.sql.includes('INSERT INTO historico_evento'))!;
    expect(historico.valores).toContain(
      'Chamado finalizado no IXC; status local MULTA_GERADA mantido (status final)',
    );
  });

  it('não repete o registro no histórico se já estava F na sincronização anterior', async () => {
    estado.existente = osGravada({ status: 'RETIRADA_OK', statusExterno: 'F' });

    const r = await importarRegistro(registroIxc({ status: 'F' }));

    expect(r).toMatchObject({ tipo: 'INALTERADA' });
    expect(sqls().some((s) => s.includes('historico_evento'))).toBe(false);
  });
});

describe('erros', () => {
  it('registro inválido vira ERRO sem tocar no banco', async () => {
    const r = await importarRegistro(registroIxc({ data_abertura: 'ontem' }));
    expect(r).toMatchObject({ tipo: 'ERRO', osExternaId: '123456' });
    expect(comandos).toHaveLength(0);
  });

  it('falha do banco vira ERRO em vez de lançar', async () => {
    tx.$queryRaw.mockRejectedValue(new Error('conexão perdida'));
    const r = await importarRegistro(registroIxc());
    expect(r).toEqual({ tipo: 'ERRO', osExternaId: '123456', erro: 'conexão perdida' });
  });
});

describe('importarRegistros', () => {
  it('importa um por vez e resume, sem parar no primeiro erro', async () => {
    const resumo = await importarRegistros([
      registroIxc({ id: '1' }),
      registroIxc({ id: '2', status: 'F' }),
      { id: '3' },
      registroIxc({ id: '4', id_assunto: '1' }),
    ]);

    expect(resumo).toMatchObject({
      recebidos: 4,
      criadas: 1,
      atualizadas: 0,
      finalizadas: 0,
      ignoradas: 2,
      comErro: 1,
    });
    expect(resumo.erros).toHaveLength(1);
    expect(resumo.erros[0]!.osExternaId).toBe('3');
  });
});
