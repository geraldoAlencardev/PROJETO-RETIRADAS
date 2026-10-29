import { describe, expect, it } from 'vitest';
import { registroIxc } from './registro-ixc.fixture.js';
import { converterRegistroIxc } from './registro-ixc.js';

describe('converterRegistroIxc', () => {
  it('converte o registro do IXC nos campos de origem da OS', () => {
    expect(converterRegistroIxc(registroIxc())).toEqual({
      ok: true,
      os: {
        osExternaId: '123456',
        assuntoId: '9',
        clienteExternoId: '7890',
        contratoId: '4321',
        protocoloExterno: '202610280001',
        endereco: 'Rua das Palmeiras, 120 - Casa 2',
        bairro: 'Centro',
        referencia: 'Próximo à praça',
        dataAbertura: '2026-10-27',
        statusExterno: 'A',
        ultimaAtualizacaoExterna: '2026-10-27 10:00:00',
      },
    });
  });

  it('trata vazios do IXC como nulos e não junta complemento vazio', () => {
    const r = converterRegistroIxc(
      registroIxc({
        complemento: '',
        bairro: '  ',
        referencia: '',
        protocolo: '',
        ultima_atualizacao: '0000-00-00 00:00:00',
      }),
    );
    expect(r).toMatchObject({
      ok: true,
      os: {
        endereco: 'Rua das Palmeiras, 120',
        bairro: null,
        referencia: null,
        protocoloExterno: null,
        ultimaAtualizacaoExterna: null,
      },
    });
  });

  it('aceita campos opcionais ausentes', () => {
    const minimo = registroIxc();
    for (const campo of ['complemento', 'referencia', 'protocolo', 'ultima_atualizacao']) {
      delete minimo[campo];
    }
    expect(converterRegistroIxc(minimo)).toMatchObject({ ok: true });
  });

  it('normaliza o status para maiúsculas', () => {
    expect(converterRegistroIxc(registroIxc({ status: 'rag' }))).toMatchObject({
      ok: true,
      os: { statusExterno: 'RAG' },
    });
  });

  it('corta textos no tamanho das colunas do banco', () => {
    const r = converterRegistroIxc(
      registroIxc({ endereco: 'x'.repeat(400), bairro: 'b'.repeat(150) }),
    );
    expect(r.ok && r.os.endereco.length).toBe(300);
    expect(r.ok && r.os.bairro?.length).toBe(100);
  });

  it('recusa data de abertura zerada', () => {
    expect(converterRegistroIxc(registroIxc({ data_abertura: '0000-00-00 00:00:00' }))).toEqual({
      ok: false,
      osExternaId: '123456',
      erro: 'data_abertura: vazia no IXC',
    });
  });

  it('recusa registro sem campo obrigatório, informando o campo e o id', () => {
    const semContrato = registroIxc();
    delete semContrato.id_contrato_kit;
    const r = converterRegistroIxc(semContrato);
    expect(r).toMatchObject({ ok: false, osExternaId: '123456' });
    expect(!r.ok && r.erro).toContain('id_contrato_kit');
  });

  it('recusa ids não numéricos e valores que não são texto', () => {
    expect(converterRegistroIxc(registroIxc({ id: 'abc' }))).toMatchObject({ ok: false });
    expect(converterRegistroIxc(registroIxc({ id_cliente: 7890 }))).toMatchObject({ ok: false });
  });

  it('não lança com entradas que não são objeto', () => {
    expect(converterRegistroIxc(null)).toMatchObject({ ok: false, osExternaId: null });
    expect(converterRegistroIxc('texto')).toMatchObject({ ok: false, osExternaId: null });
  });
});
