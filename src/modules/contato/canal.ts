// Canais de contato aceitos. A ordem espelha o enum `canal_contato` do banco.
export const CANAIS = ['TELEFONE', 'WHATSAPP', 'EMAIL', 'OUTRO'] as const;

export type Canal = (typeof CANAIS)[number];
