// Status possíveis da OS (RN06). A ordem espelha o enum `status_os` do banco.
export const STATUS_OS = [
  'PENDENTE',
  'EM_CONTATO',
  'AGENDADA',
  'ATRASADA',
  'EM_EXTRAVIO',
  'MULTA_GERADA',
  'EM_REATIVACAO',
  'REATIVACAO_CONCLUIDA',
  'RETIRADA_OK',
] as const;

export type StatusOs = (typeof STATUS_OS)[number];
