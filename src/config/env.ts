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
});

export const env = schema.parse(process.env);
