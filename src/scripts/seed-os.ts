// Popula o banco com OS fictícias, em todos os status, para desenvolvimento.
// É idempotente: OS que já existem (pela chave os_externa_id) são ignoradas.
// Uso: npm run seed:os   (requer ao menos um usuário: npm run user:create)
import 'dotenv/config';
import type { StatusOs } from '../modules/os/status.js';
import { prisma } from '../shared/prisma.js';

type Canal = 'TELEFONE' | 'WHATSAPP' | 'EMAIL' | 'OUTRO';

interface TentativaSeed {
  diasAtras: number;
  canal: Canal;
  resultado: string;
}

interface OsSeed {
  externa: string;
  cliente: string;
  contrato: string;
  bairro: string;
  endereco: string;
  aberturaDiasAtras: number;
  status: StatusOs;
  entrouNoStatusDiasAtras: number;
  tentativas?: TentativaSeed[];
  agendamento?: { diasAFrente: number; horario?: string };
}

const SEM_RESPOSTA = 'Sem resposta';
const DESLIGADO = 'Telefone desligado';
const AGENDOU = 'Contato realizado: retirada agendada';

const OS_FICTICIAS: OsSeed[] = [
  {
    externa: 'OS-9001',
    cliente: 'Maria das Graças Souza',
    contrato: 'CT-10001',
    bairro: 'Centro',
    endereco: 'Rua das Palmeiras, 120',
    aberturaDiasAtras: 3,
    status: 'PENDENTE',
    entrouNoStatusDiasAtras: 3,
  },
  {
    externa: 'OS-9002',
    cliente: 'João Carlos Pereira',
    contrato: 'CT-10002',
    bairro: 'Gravatá',
    endereco: 'Av. Jorge Amado, 845',
    aberturaDiasAtras: 6,
    status: 'PENDENTE',
    entrouNoStatusDiasAtras: 6,
  },
  {
    externa: 'OS-9003',
    cliente: 'Ana Paula Ribeiro',
    contrato: 'CT-10003',
    bairro: 'Phoc',
    endereco: 'Rua B, 33, Phoc II',
    aberturaDiasAtras: 8,
    status: 'EM_CONTATO',
    entrouNoStatusDiasAtras: 2,
    tentativas: [{ diasAtras: 2, canal: 'WHATSAPP', resultado: SEM_RESPOSTA }],
  },
  {
    externa: 'OS-9004',
    cliente: 'Carlos Eduardo Lima',
    contrato: 'CT-10004',
    bairro: 'Nova Vitória',
    endereco: 'Travessa das Acácias, 7',
    aberturaDiasAtras: 9,
    status: 'EM_CONTATO',
    entrouNoStatusDiasAtras: 4,
    tentativas: [
      { diasAtras: 4, canal: 'TELEFONE', resultado: SEM_RESPOSTA },
      { diasAtras: 1, canal: 'WHATSAPP', resultado: SEM_RESPOSTA },
    ],
  },
  {
    externa: 'OS-9005',
    cliente: 'Fernanda Oliveira Santos',
    contrato: 'CT-10005',
    bairro: 'Parque Verde',
    endereco: 'Rua das Mangueiras, 410',
    aberturaDiasAtras: 7,
    status: 'AGUARDANDO',
    entrouNoStatusDiasAtras: 1,
    tentativas: [
      { diasAtras: 3, canal: 'TELEFONE', resultado: SEM_RESPOSTA },
      { diasAtras: 1, canal: 'TELEFONE', resultado: AGENDOU },
    ],
    agendamento: { diasAFrente: 3, horario: '14:00' },
  },
  {
    externa: 'OS-9006',
    cliente: 'Roberto Almeida Neto',
    contrato: 'CT-10006',
    bairro: 'Vila de Abrantes',
    endereco: 'Rua da Praia, 58',
    aberturaDiasAtras: 5,
    status: 'AGUARDANDO',
    entrouNoStatusDiasAtras: 2,
    tentativas: [{ diasAtras: 2, canal: 'WHATSAPP', resultado: AGENDOU }],
    agendamento: { diasAFrente: 1, horario: '09:30' },
  },
  {
    externa: 'OS-9007',
    cliente: 'Luciana Barbosa Costa',
    contrato: 'CT-10007',
    bairro: 'Jauá',
    endereco: 'Alameda dos Coqueiros, 15',
    aberturaDiasAtras: 22,
    status: 'ATRASADA',
    entrouNoStatusDiasAtras: 5,
    tentativas: [{ diasAtras: 14, canal: 'TELEFONE', resultado: SEM_RESPOSTA }],
  },
  {
    externa: 'OS-9008',
    cliente: 'Marcos Vinícius Teixeira',
    contrato: 'CT-10008',
    bairro: 'Arembepe',
    endereco: 'Rua do Farol, 201',
    aberturaDiasAtras: 16,
    status: 'ATRASADA',
    entrouNoStatusDiasAtras: 9,
  },
  {
    externa: 'OS-9009',
    cliente: 'Patrícia Gomes Martins',
    contrato: 'CT-10009',
    bairro: 'Monte Gordo',
    endereco: 'Rua Nova, 90, Monte Gordo',
    aberturaDiasAtras: 18,
    status: 'EM_EXTRAVIO',
    entrouNoStatusDiasAtras: 3,
    tentativas: [
      { diasAtras: 10, canal: 'TELEFONE', resultado: SEM_RESPOSTA },
      { diasAtras: 6, canal: 'WHATSAPP', resultado: DESLIGADO },
      { diasAtras: 3, canal: 'TELEFONE', resultado: SEM_RESPOSTA },
    ],
  },
  {
    externa: 'OS-9010',
    cliente: 'Antônio Ferreira Dias',
    contrato: 'CT-10010',
    bairro: 'Camaçari de Dentro',
    endereco: 'Estrada do Coco, km 3',
    aberturaDiasAtras: 40,
    status: 'MULTA_GERADA',
    entrouNoStatusDiasAtras: 12,
    tentativas: [
      { diasAtras: 30, canal: 'TELEFONE', resultado: SEM_RESPOSTA },
      { diasAtras: 26, canal: 'TELEFONE', resultado: DESLIGADO },
      { diasAtras: 20, canal: 'EMAIL', resultado: SEM_RESPOSTA },
    ],
  },
  {
    externa: 'OS-9011',
    cliente: 'Juliana Rocha Mendes',
    contrato: 'CT-10011',
    bairro: 'Centro',
    endereco: 'Praça da Matriz, 5, ap. 2',
    aberturaDiasAtras: 35,
    status: 'EM_REATIVACAO',
    entrouNoStatusDiasAtras: 2,
    tentativas: [
      { diasAtras: 25, canal: 'TELEFONE', resultado: SEM_RESPOSTA },
      { diasAtras: 21, canal: 'WHATSAPP', resultado: SEM_RESPOSTA },
      { diasAtras: 18, canal: 'TELEFONE', resultado: DESLIGADO },
    ],
  },
  {
    externa: 'OS-9012',
    cliente: 'Ricardo Nunes Araújo',
    contrato: 'CT-10012',
    bairro: 'Gravatá',
    endereco: 'Rua Itapuã, 77',
    aberturaDiasAtras: 45,
    status: 'REATIVACAO_CONCLUIDA',
    entrouNoStatusDiasAtras: 4,
    tentativas: [
      { diasAtras: 38, canal: 'TELEFONE', resultado: SEM_RESPOSTA },
      { diasAtras: 33, canal: 'TELEFONE', resultado: SEM_RESPOSTA },
      { diasAtras: 29, canal: 'WHATSAPP', resultado: DESLIGADO },
    ],
  },
  {
    externa: 'OS-9013',
    cliente: 'Sandra Regina Lopes',
    contrato: 'CT-10013',
    bairro: 'Phoc',
    endereco: 'Rua C, 12, Phoc III',
    aberturaDiasAtras: 30,
    status: 'RETIRADA_OK',
    entrouNoStatusDiasAtras: 6,
    tentativas: [
      { diasAtras: 20, canal: 'TELEFONE', resultado: SEM_RESPOSTA },
      { diasAtras: 15, canal: 'TELEFONE', resultado: AGENDOU },
    ],
    agendamento: { diasAFrente: -7, horario: '10:00' },
  },
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('O seed de OS fictícias não pode ser executado em produção.');
  }

  const usuarios = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM usuario WHERE ativo ORDER BY criado_em LIMIT 1`;
  const usuarioId = usuarios[0]?.id;
  if (!usuarioId) {
    throw new Error(
      'Nenhum usuário ativo encontrado. Crie um antes: npm run user:create -- --login admin --nome "Administrador"',
    );
  }

  let criadas = 0;
  let ignoradas = 0;

  for (const os of OS_FICTICIAS) {
    const existente = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM os WHERE os_externa_id = ${os.externa}`;
    if (existente.length > 0) {
      ignoradas++;
      continue;
    }

    // Em ordem cronológica: o trigger da tentativa atualiza a "última interação" com a última inserida.
    const tentativas = [...(os.tentativas ?? [])].sort((a, b) => b.diasAtras - a.diasAtras);

    // Tudo da OS entra junto, ou nada entra.
    await prisma.$transaction([
      prisma.$executeRaw`
        INSERT INTO os (os_externa_id, cliente_nome, contrato_id, bairro, endereco,
                        data_abertura, status, data_entrada_status)
        VALUES (${os.externa}, ${os.cliente}, ${os.contrato}, ${os.bairro}, ${os.endereco},
                current_date - ${os.aberturaDiasAtras}::int,
                ${os.status}::status_os,
                now() - (${os.entrouNoStatusDiasAtras}::int * interval '1 day'))`,
      prisma.$executeRaw`
        INSERT INTO historico_evento (os_id, usuario_id, data_hora, tipo_evento, descricao)
        VALUES ((SELECT id FROM os WHERE os_externa_id = ${os.externa}),
                NULL,
                now() - (${os.aberturaDiasAtras}::int * interval '1 day'),
                'RECEBIMENTO',
                'OS recebida do sistema externo')`,
      ...tentativas.map(
        (t) => prisma.$executeRaw`
          INSERT INTO tentativa_contato (os_id, usuario_id, data_hora, canal, resultado)
          VALUES ((SELECT id FROM os WHERE os_externa_id = ${os.externa}),
                  ${usuarioId}::uuid,
                  now() - (${t.diasAtras}::int * interval '1 day'),
                  ${t.canal}::canal_contato,
                  ${t.resultado})`,
      ),
      ...(os.agendamento
        ? [
            prisma.$executeRaw`
              INSERT INTO agendamento (os_id, usuario_id, data_prevista, horario, vigente)
              VALUES ((SELECT id FROM os WHERE os_externa_id = ${os.externa}),
                      ${usuarioId}::uuid,
                      current_date + ${os.agendamento.diasAFrente}::int,
                      ${os.agendamento.horario ?? null}::time,
                      true)`,
          ]
        : []),
    ]);
    criadas++;
  }

  console.log(`✔ Seed concluído: ${criadas} OS criadas, ${ignoradas} já existiam.`);
}

main()
  .catch((err: unknown) => {
    console.error(`✖ ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
