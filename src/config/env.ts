import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  TZ_NEGOCIO: z.string().default('America/Bahia'),

  // Autenticação (JWT em cookie httpOnly)
  JWT_SECRET: z.string().min(32, 'JWT_SECRET deve ter pelo menos 32 caracteres'),
  SESSAO_HORAS: z.coerce.number().int().positive().default(8),
  // Use "true" apenas se a aplicação for servida por HTTPS (cookie "Secure").
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Intervalo da rotina de prazos (Atrasada e timeout da reativação). 0 desliga a rotina.
  ROTINA_PRAZOS_MINUTOS: z.coerce.number().int().min(0).default(60),

  // Integração com o IXC: somente leitura. O IXC é apenas origem de dados; nada é enviado a ele.
  IXC_URL: z.string().url().optional(),
  IXC_TOKEN: z.string().min(1).optional(),
  /** su_oss_chamado.id_assunto das OS de retirada. */
  IXC_ID_ASSUNTO_RETIRADA: z.string().regex(/^\d+$/).default('9'),
  /** Intervalo mínimo entre duas sincronizações (botão "Sincronizar agora"). */
  SINCRONIZACAO_INTERVALO_MIN_MINUTOS: z.coerce.number().int().min(0).default(5),
});

export const env = schema.parse(process.env);
