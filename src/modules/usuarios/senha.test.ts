import { describe, expect, it } from 'vitest';
import { conferirSenha, hashSenha } from './senha.js';

describe('senha', () => {
  it('gera hash diferente da senha e confere corretamente', async () => {
    const hash = await hashSenha('SenhaForte123');
    expect(hash).not.toContain('SenhaForte123');
    expect(await conferirSenha('SenhaForte123', hash)).toBe(true);
    expect(await conferirSenha('outra-senha', hash)).toBe(false);
  });

  it('gera hashes distintos para a mesma senha (salt)', async () => {
    expect(await hashSenha('SenhaForte123')).not.toBe(await hashSenha('SenhaForte123'));
  });
});
