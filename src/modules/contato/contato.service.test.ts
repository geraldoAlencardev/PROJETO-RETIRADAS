import { beforeEach, describe, expect, it, vi } from 'vitest';

// `tx` simula a conexão da transação; `consultas` guarda o SQL na ordem em que foi executado.
const { tx, consultas } = vi.hoisted(() => ({
  tx: { $queryRaw: vi.fn(), $executeRaw: vi.fn() },
  consultas: [] as string[],
}));

vi.mock('../../shared/prisma.js', () => ({
  prisma: { $transaction: (fn: (t: unknown) => unknown) => fn(tx) },
}));
vi.mock('../os/os.service.js', async () => {
  // Mantém as classes de erro reais; só a máquina de estados/gravação é simulada.
  const real = await vi.importActual<typeof import('../os/os.service.js')>('../os/os.service.js');
  return { ...real, aplicarEvento: vi.fn() };
});

import { aplicarEvento, OsNaoEncontradaError, TransicaoInvalidaError } from '../os/os.service.js';
import { registrarTentativa } from './contato.service.js';

const OS_ID = '22222222-2222-2222-2222-222222222222';
const USUARIO_ID = '11111111-1111-1111-1111-111111111111';

const tentativaInserida = {
  id: '33333333-3333-3333-3333-333333333333',
  dataHora: new Date('2026-10-16T12:00:00Z'),
  canal: 'WHATSAPP',
  sucesso: false,
  observacao: 'Telefone desligado',
};

let osExiste: boolean;

beforeEach(() => {
  consultas.length = 0;
  osExiste = true;
  vi.mocked(aplicarEvento).mockReset();
  tx.$queryRaw.mockReset();
  tx.$executeRaw.mockReset();

  tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    consultas.push(sql);
    if (sql.includes('FOR UPDATE')) return osExiste ? [{ id: OS_ID }] : [];
    if (sql.includes('INSERT INTO tentativa_contato')) return [tentativaInserida];
    if (sql.includes('qtd_falhas_ciclo')) return [{ falhasCiclo: 2 }];
    return [];
  });
  tx.$executeRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    consultas.push(strings.join('?'));
    return 1;
  });
});

const pedido = {
  osId: OS_ID,
  usuarioId: USUARIO_ID,
  canal: 'WHATSAPP' as const,
  sucesso: false,
  observacao: 'Telefone desligado',
};

describe('registrarTentativa', () => {
  it('trava a OS, insere a tentativa, lê o contador oculto e consulta a máquina de estados', async () => {
    const transicao = { de: 'EM_CONTATO', para: 'EM_CONTATO', codigo: null } as const;
    vi.mocked(aplicarEvento).mockResolvedValue(transicao);

    const resultado = await registrarTentativa(pedido);

    expect(resultado).toEqual({ tentativa: tentativaInserida, transicao });
    expect(aplicarEvento).toHaveBeenCalledWith(tx, {
      osId: OS_ID,
      usuarioId: USUARIO_ID,
      evento: { tipo: 'TENTATIVA_CONTATO', sucesso: false, falhasCiclo: 2 },
    });

    // A ordem importa: travar antes de inserir, e ler o contador depois do trigger.
    const ordem = [
      'FOR UPDATE',
      'INSERT INTO tentativa_contato',
      'qtd_falhas_ciclo',
      'INSERT INTO historico_evento',
    ].map((trecho) => consultas.findIndex((sql) => sql.includes(trecho)));
    expect(ordem.every((i) => i >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
  });

  it('registra no histórico o canal, o resultado e a observação', async () => {
    vi.mocked(aplicarEvento).mockResolvedValue({
      de: 'EM_CONTATO',
      para: 'EM_CONTATO',
      codigo: null,
    });

    await registrarTentativa(pedido);

    const valores = tx.$executeRaw.mock.calls[0]!.slice(1);
    expect(valores).toContain(
      'Tentativa de contato por WHATSAPP: sem sucesso — Telefone desligado',
    );
  });

  it('descreve a tentativa com sucesso e sem observação', async () => {
    vi.mocked(aplicarEvento).mockResolvedValue({
      de: 'EM_CONTATO',
      para: 'EM_CONTATO',
      codigo: null,
    });

    await registrarTentativa({
      ...pedido,
      canal: 'TELEFONE',
      sucesso: true,
      observacao: undefined,
    });

    const valores = tx.$executeRaw.mock.calls[0]!.slice(1);
    expect(valores).toContain('Tentativa de contato por TELEFONE: com sucesso');
  });

  it('não insere nada quando a OS não existe', async () => {
    osExiste = false;

    await expect(registrarTentativa(pedido)).rejects.toBeInstanceOf(OsNaoEncontradaError);

    expect(consultas.some((sql) => sql.includes('INSERT'))).toBe(false);
    expect(aplicarEvento).not.toHaveBeenCalled();
  });

  it('propaga a recusa da máquina de estados (o que desfaz a transação inteira)', async () => {
    vi.mocked(aplicarEvento).mockRejectedValue(
      new TransicaoInvalidaError(
        'Não é possível registrar tentativa de contato com a OS em AGENDADA.',
      ),
    );

    await expect(registrarTentativa(pedido)).rejects.toBeInstanceOf(TransicaoInvalidaError);
  });
});
