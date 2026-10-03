import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Variáveis mínimas para os testes não dependerem de um .env local.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/teste',
      JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!',
      SESSAO_HORAS: '8',
      COOKIE_SECURE: 'false',
    },
  },
});
