import { describe, expect, it } from 'vitest';
import { escaparLike } from './like.js';

describe('escaparLike', () => {
  it('mantém texto comum intacto', () => {
    expect(escaparLike('Maria Silva')).toBe('Maria Silva');
  });

  it('escapa %, _ e a própria barra invertida', () => {
    expect(escaparLike('100%')).toBe('100\\%');
    expect(escaparLike('a_b')).toBe('a\\_b');
    expect(escaparLike('a\\b')).toBe('a\\\\b');
  });
});
