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

- `npm run user:create -- --login admin --nome "Administrador"` — cria um usuário
- `npm run seed:os` — OS fictícias em todos os status (só desenvolvimento)
- `npm run ixc:importar -- arquivo.json` — importa OS de um JSON no formato do IXC, sem chamar o IXC
- `npm run prazos:processar` — roda uma vez a rotina de prazos

## Endpoints

Todos exigem sessão (cookie do `/auth/login`), exceto `/health` e `/auth/login`.

| Método e rota                                                                     | O que faz                                                                         |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `POST /auth/login` · `POST /auth/logout` · `GET /auth/me`                         | Sessão                                                                            |
| `GET /usuarios` · `POST /usuarios` · `PATCH /usuarios/:id`                        | Usuários (perfil único, RN05)                                                     |
| `GET /os` · `GET /os/resumo` · `GET /os/:id` · `GET /os/:id/historico`            | Fila, contagem por status, detalhe e linha do tempo                               |
| `POST /os/:id/acoes`                                                              | Concluir retirada (T09), gerar multa (T10), iniciar/concluir reativação (T11/T13) |
| `POST /os/:id/tentativas` · `GET /os/:id/tentativas`                              | Tentativas de contato (RF10–RF12)                                                 |
| `POST /os/:id/agendamentos` · `GET /os/:id/agendamentos`                          | Agendar (T03) / reagendar (T08) e histórico de datas (RN04)                       |
| `POST /os/:id/agendamentos/reverter`                                              | Reverter agendamento (T07)                                                        |
| `POST /sincronizacoes` · `GET /sincronizacoes/ultima` · `GET /sincronizacoes/:id` | Botão "Sincronizar agora" com o IXC                                               |

## Integração com o IXC

O IXC é **apenas origem de dados**: o sistema só lê (GET) e **nunca envia nada** ao IXC.

- As OS vêm de `su_oss_chamado` com `id_assunto = IXC_ID_ASSUNTO_RETIRADA` (9), incluindo as finalizadas.
- OS nova → entra em Pendente. OS nova já finalizada (`F`) → não entra.
- OS existente → só os campos de origem são atualizados (RN08); cada mudança vai para o `log_alteracao`.
- OS existente que ficou `F` no IXC → Retirada OK (T16) a partir de qualquer status não final.
- A sincronização roda só sob demanda, uma por vez, com intervalo mínimo
  (`SINCRONIZACAO_INTERVALO_MIN_MINUTOS`), páginas de 100 lidas uma de cada vez e parada no primeiro erro.
- **Pendente:** o cliente HTTP do IXC (a "fonte"). Até lá, `POST /sincronizacoes` responde 503.
  O chamado do IXC não traz o nome do cliente; `cliente_nome` fica vazio até existir essa consulta.

## Rotina de prazos

A cada `ROTINA_PRAZOS_MINUTOS` (padrão 60; 0 desliga) o servidor aplica os eventos automáticos:
Atrasada após 5 dias úteis sem interação (T02/T05, RN03) e fim da reativação após 5 dias úteis
(T12, RN11). Dias úteis excluem fins de semana e os feriados da tabela `feriado`.

## Estrutura

- `db/init/` — DDL (SQL) aplicado ao banco na criação
- `prisma/schema.prisma` — gerado por introspecção
- `src/config/` — variáveis de ambiente (validadas com zod)
- `src/shared/` — Prisma client e utilitários comuns
- `src/modules/` — `os` (fila, máquina de estados, ações), `contato`, `agendamento`, `prazos`,
  `integracao-ixc`, `usuarios` (autenticação e gestão), `feriado` (dias úteis) e `health`
- `src/scripts/` — scripts de linha de comando (usuário, seed, importação, prazos)
