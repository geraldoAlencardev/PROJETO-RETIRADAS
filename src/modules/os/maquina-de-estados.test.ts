import { describe, expect, it } from 'vitest';
import {
  decidirTransicao,
  FALHAS_PARA_EXTRAVIO,
  STATUS_FINAIS,
  type EventoOs,
  type TipoEvento,
} from './maquina-de-estados.js';
import { STATUS_OS, type StatusOs } from './status.js';

const falha = (falhasCiclo: number): EventoOs => ({
  tipo: 'TENTATIVA_CONTATO',
  sucesso: false,
  falhasCiclo,
});
const sucesso: EventoOs = { tipo: 'TENTATIVA_CONTATO', sucesso: true, falhasCiclo: 0 };

describe('transições permitidas', () => {
  // [código, status de origem, evento, status de destino]
  const casos: [string, StatusOs, EventoOs, StatusOs][] = [
    ['T01', 'PENDENTE', falha(1), 'EM_CONTATO'],
    ['T01', 'PENDENTE', sucesso, 'EM_CONTATO'],
    ['T02', 'PENDENTE', { tipo: 'MARCAR_ATRASADA' }, 'ATRASADA'],
    ['T03', 'PENDENTE', { tipo: 'AGENDAR' }, 'AGENDADA'],
    ['T03', 'EM_CONTATO', { tipo: 'AGENDAR' }, 'AGENDADA'],
    ['T03', 'ATRASADA', { tipo: 'AGENDAR' }, 'AGENDADA'],
    ['T04', 'EM_CONTATO', falha(3), 'EM_EXTRAVIO'],
    ['T05', 'EM_CONTATO', { tipo: 'MARCAR_ATRASADA' }, 'ATRASADA'],
    ['T06', 'ATRASADA', falha(1), 'EM_CONTATO'],
    ['T06', 'ATRASADA', sucesso, 'EM_CONTATO'],
    ['T07', 'AGENDADA', { tipo: 'REVERTER_AGENDAMENTO' }, 'EM_CONTATO'],
    ['T08', 'AGENDADA', { tipo: 'REAGENDAR' }, 'AGENDADA'],
    ['T09', 'AGENDADA', { tipo: 'CONCLUIR_RETIRADA' }, 'RETIRADA_OK'],
    ['T10', 'EM_EXTRAVIO', { tipo: 'GERAR_MULTA' }, 'MULTA_GERADA'],
    ['T11', 'EM_EXTRAVIO', { tipo: 'INICIAR_REATIVACAO' }, 'EM_REATIVACAO'],
    ['T12', 'EM_REATIVACAO', { tipo: 'EXPIRAR_REATIVACAO' }, 'PENDENTE'],
    ['T13', 'EM_REATIVACAO', { tipo: 'CONCLUIR_REATIVACAO' }, 'REATIVACAO_CONCLUIDA'],
  ];

  it.each(casos)('%s: %s + %j → %s', (codigo, de, evento, para) => {
    expect(decidirTransicao(de, evento)).toMatchObject({ ok: true, de, para, codigo });
  });
});

describe('tentativas de contato', () => {
  it('uma falha em Em contato não muda o status', () => {
    expect(decidirTransicao('EM_CONTATO', falha(1))).toMatchObject({
      ok: true,
      para: 'EM_CONTATO',
      codigo: null,
    });
    expect(decidirTransicao('EM_CONTATO', falha(2))).toMatchObject({ para: 'EM_CONTATO' });
  });

  it(`a ${FALHAS_PARA_EXTRAVIO}ª falha do ciclo leva a Em extravio`, () => {
    expect(decidirTransicao('EM_CONTATO', falha(FALHAS_PARA_EXTRAVIO))).toMatchObject({
      para: 'EM_EXTRAVIO',
      codigo: 'T04',
    });
  });

  it('a 3ª falha também leva a Em extravio a partir de Atrasada', () => {
    expect(decidirTransicao('ATRASADA', falha(3))).toMatchObject({
      para: 'EM_EXTRAVIO',
      codigo: 'T04',
    });
  });

  it('uma tentativa com sucesso nunca leva a Em extravio', () => {
    const evento: EventoOs = { tipo: 'TENTATIVA_CONTATO', sucesso: true, falhasCiclo: 5 };
    expect(decidirTransicao('EM_CONTATO', evento)).toMatchObject({ para: 'EM_CONTATO' });
  });

  it.each(['AGENDADA', 'EM_EXTRAVIO', 'EM_REATIVACAO'] as StatusOs[])(
    'não aceita tentativa de contato com a OS em %s',
    (status) => {
      expect(decidirTransicao(status, falha(1))).toMatchObject({ ok: false });
    },
  );
});

describe('transições recusadas', () => {
  it('não permite agendar uma OS já agendada (o certo é reagendar)', () => {
    expect(decidirTransicao('AGENDADA', { tipo: 'AGENDAR' })).toMatchObject({ ok: false });
  });

  it('só conclui a retirada a partir de AGENDADA', () => {
    for (const status of STATUS_OS.filter((s) => s !== 'AGENDADA')) {
      expect(decidirTransicao(status, { tipo: 'CONCLUIR_RETIRADA' })).toMatchObject({ ok: false });
    }
  });

  it('só gera multa e inicia reativação a partir de Em extravio', () => {
    for (const status of STATUS_OS.filter((s) => s !== 'EM_EXTRAVIO')) {
      expect(decidirTransicao(status, { tipo: 'GERAR_MULTA' })).toMatchObject({ ok: false });
      expect(decidirTransicao(status, { tipo: 'INICIAR_REATIVACAO' })).toMatchObject({ ok: false });
    }
  });

  it('só marca como atrasada a partir de Pendente ou Em contato', () => {
    for (const status of STATUS_OS.filter((s) => s !== 'PENDENTE' && s !== 'EM_CONTATO')) {
      expect(decidirTransicao(status, { tipo: 'MARCAR_ATRASADA' })).toMatchObject({ ok: false });
    }
  });

  it('inclui o motivo na recusa', () => {
    const resultado = decidirTransicao('PENDENTE', { tipo: 'CONCLUIR_RETIRADA' });
    expect(resultado).toMatchObject({ ok: false });
    if (!resultado.ok) expect(resultado.motivo).toContain('PENDENTE');
  });
});

describe('status finais (T14)', () => {
  const eventos: EventoOs[] = [
    falha(1),
    sucesso,
    { tipo: 'AGENDAR' },
    { tipo: 'REAGENDAR' },
    { tipo: 'REVERTER_AGENDAMENTO' },
    { tipo: 'CONCLUIR_RETIRADA' },
    { tipo: 'MARCAR_ATRASADA' },
    { tipo: 'GERAR_MULTA' },
    { tipo: 'INICIAR_REATIVACAO' },
    { tipo: 'CONCLUIR_REATIVACAO' },
    { tipo: 'EXPIRAR_REATIVACAO' },
    { tipo: 'FINALIZAR_NO_IXC' },
  ];

  it('são exatamente Retirada OK, Reativação concluída e Multa gerada', () => {
    expect([...STATUS_FINAIS].sort()).toEqual(
      ['MULTA_GERADA', 'REATIVACAO_CONCLUIDA', 'RETIRADA_OK'].sort(),
    );
  });

  it.each(STATUS_FINAIS.map((s) => [s]))('%s não aceita nenhum evento', (status) => {
    for (const evento of eventos) {
      expect(decidirTransicao(status, evento)).toMatchObject({ ok: false });
    }
  });
});

describe('finalização no IXC (T16)', () => {
  it.each(STATUS_OS.filter((s) => !STATUS_FINAIS.includes(s)).map((s) => [s]))(
    'leva %s para Retirada OK',
    (status) => {
      expect(decidirTransicao(status, { tipo: 'FINALIZAR_NO_IXC' })).toEqual({
        ok: true,
        de: status,
        para: 'RETIRADA_OK',
        codigo: 'T16',
        reiniciaCicloFalhas: false,
      });
    },
  );
});

describe('reinício do contador oculto de falhas', () => {
  it('só o timeout da reativação (T12) pede o reinício', () => {
    const tipos: TipoEvento[] = [
      'AGENDAR',
      'REVERTER_AGENDAMENTO',
      'CONCLUIR_RETIRADA',
      'GERAR_MULTA',
      'INICIAR_REATIVACAO',
      'CONCLUIR_REATIVACAO',
    ];
    const origens: Record<string, StatusOs> = {
      AGENDAR: 'PENDENTE',
      REVERTER_AGENDAMENTO: 'AGENDADA',
      CONCLUIR_RETIRADA: 'AGENDADA',
      GERAR_MULTA: 'EM_EXTRAVIO',
      INICIAR_REATIVACAO: 'EM_EXTRAVIO',
      CONCLUIR_REATIVACAO: 'EM_REATIVACAO',
    };
    for (const tipo of tipos) {
      expect(decidirTransicao(origens[tipo]!, { tipo } as EventoOs)).toMatchObject({
        ok: true,
        reiniciaCicloFalhas: false,
      });
    }
    expect(decidirTransicao('EM_REATIVACAO', { tipo: 'EXPIRAR_REATIVACAO' })).toMatchObject({
      ok: true,
      reiniciaCicloFalhas: true,
    });
  });
});
