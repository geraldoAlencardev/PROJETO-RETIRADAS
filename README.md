# OS Retirada API

Backend (Node + TypeScript + Fastify + Prisma + PostgreSQL) do Sistema de Gestão de OS de Retirada de Equipamentos.

**Ambiente de desenvolvimento:** Node roda direto na máquina; só o PostgreSQL roda no Docker.
Em produção, a API também será containerizada.

## Primeira execução

```bash
cp .env.example .env
npm install
npm run db:up        # sobe o PostgreSQL e aplica db/init/*.sql (DDL) na criação do volume
npm run db:pull      # introspecção: preenche prisma/schema.prisma e gera o client
npm run dev          # http://localhost:3000/health
```

## Fluxo do banco

O **DDL em `db/init/` é a fonte da verdade**. Não use `prisma migrate dev`.

- Alterou o DDL (novo `db/init/00X_*.sql` ou edição)? Em desenvolvimento:
  `npm run db:reset` (recria o banco do zero) e depois `npm run db:pull`.
- O `db pull` não representa o índice parcial `ux_agendamento_vigente_por_os`, nem triggers
  e funções — eles continuam existindo no banco, só não aparecem no `schema.prisma`.

## Scripts úteis

`npm test` · `npm run lint` · `npm run format` · `npm run typecheck`

## Estrutura

- `db/init/` — DDL (SQL) aplicado ao banco na criação
- `prisma/schema.prisma` — gerado por introspecção
- `src/config/` — variáveis de ambiente (validadas com zod)
- `src/shared/` — Prisma client e utilitários comuns
- `src/modules/` — `os`, `contato`, `agendamento`, `historico`, `usuarios`, `feriado`
  (hoje implementados: `feriado` — dias úteis, base de RN03/RN11 — e `health`)
