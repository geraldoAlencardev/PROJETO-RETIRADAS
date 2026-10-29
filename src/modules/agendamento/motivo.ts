// Quem motivou o reagendamento. A ordem espelha o enum `tipo_motivo_reagendamento` do banco.
export const TIPOS_MOTIVO = ['CLIENTE', 'EMPRESA'] as const;

export type TipoMotivo = (typeof TIPOS_MOTIVO)[number];
