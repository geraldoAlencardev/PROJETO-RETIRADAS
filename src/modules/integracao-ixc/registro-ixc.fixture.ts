// Registro fictício no formato de su_oss_chamado (todos os valores como texto, como o IXC envia).
// Contém só uma parte dos ~60 campos reais; os demais são ignorados pela importação.
export function registroIxc(sobrescrever: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '123456',
    id_assunto: '9',
    id_cliente: '7890',
    id_contrato_kit: '4321',
    id_cidade: '1',
    status: 'A',
    protocolo: '202610280001',
    endereco: 'Rua das Palmeiras, 120',
    complemento: 'Casa 2',
    bairro: 'Centro',
    referencia: 'Próximo à praça',
    data_abertura: '2026-10-27 09:15:00',
    data_fechamento: '0000-00-00 00:00:00',
    data_agenda: '0000-00-00 00:00:00',
    ultima_atualizacao: '2026-10-27 10:00:00',
    mensagem: 'Retirada de equipamento',
    latitude: '-12.6975',
    longitude: '-38.3242',
    valor_total: '0.00',
    ...sobrescrever,
  };
}
