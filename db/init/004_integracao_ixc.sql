-- =====================================================================
-- 004 - Integração com o IXC (origem das OS) e eventos automáticos
--
-- 1) A OS ganha os campos de origem que chegam do IXC (su_oss_chamado).
--    Continuam sendo campos de ORIGEM: a sincronização só mexe neles (RN08).
-- 2) O chamado do IXC não traz o nome do cliente, só o id; cliente_nome
--    passa a aceitar NULL até existir a consulta ao cadastro de clientes.
-- 3) log_alteracao.usuario_id passa a aceitar NULL, como historico_evento:
--    NULL = alteração automática do sistema (sincronização, prazos).
-- 4) Tabela sincronizacao: registro de cada execução e trava contra
--    duas sincronizações ao mesmo tempo.
-- =====================================================================

ALTER TABLE os ALTER COLUMN cliente_nome DROP NOT NULL;

ALTER TABLE os ADD COLUMN cliente_externo_id         varchar(50);
ALTER TABLE os ADD COLUMN protocolo_externo          varchar(50);
ALTER TABLE os ADD COLUMN referencia                 varchar(300);
ALTER TABLE os ADD COLUMN status_externo             varchar(5);
ALTER TABLE os ADD COLUMN ultima_atualizacao_externa timestamp;
ALTER TABLE os ADD COLUMN sincronizado_em            timestamp;

COMMENT ON COLUMN os.os_externa_id IS 'su_oss_chamado.id no IXC.';
COMMENT ON COLUMN os.cliente_externo_id IS 'su_oss_chamado.id_cliente no IXC.';
COMMENT ON COLUMN os.contrato_id IS 'su_oss_chamado.id_contrato_kit no IXC.';
COMMENT ON COLUMN os.protocolo_externo IS 'su_oss_chamado.protocolo no IXC (para localizar o chamado lá).';
COMMENT ON COLUMN os.status_externo IS 'Status do chamado no IXC (A, AN, EN, AS, AG, DS, EX, F, RAG). Só consulta; F leva a OS para Retirada OK.';
COMMENT ON COLUMN os.ultima_atualizacao_externa IS 'su_oss_chamado.ultima_atualizacao no IXC (horário local, como vem de lá).';
COMMENT ON COLUMN os.sincronizado_em IS 'Última vez que a sincronização gravou esta OS.';

CREATE INDEX ix_os_status_externo ON os (status_externo);

ALTER TABLE log_alteracao ALTER COLUMN usuario_id DROP NOT NULL;
COMMENT ON COLUMN log_alteracao.usuario_id IS 'NULL em alterações automáticas do sistema (sincronização com o IXC, prazos).';

-- ---------------------------------------------------------------------
-- Tabela: sincronizacao
-- ---------------------------------------------------------------------
CREATE TABLE sincronizacao (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id      uuid NOT NULL REFERENCES usuario(id),
    iniciada_em     timestamp NOT NULL DEFAULT now(),
    finalizada_em   timestamp,
    situacao        varchar(20) NOT NULL DEFAULT 'EM_ANDAMENTO'
                    CHECK (situacao IN ('EM_ANDAMENTO', 'CONCLUIDA', 'FALHOU')),
    paginas         integer NOT NULL DEFAULT 0,
    recebidos       integer NOT NULL DEFAULT 0,
    criadas         integer NOT NULL DEFAULT 0,
    atualizadas     integer NOT NULL DEFAULT 0,
    finalizadas     integer NOT NULL DEFAULT 0,
    ignoradas       integer NOT NULL DEFAULT 0,
    com_erro        integer NOT NULL DEFAULT 0,
    erro            text
);

COMMENT ON TABLE sincronizacao IS 'Uma linha por execução do botão "Sincronizar agora" (quem pediu, quando, contadores e erro).';

-- No máximo uma sincronização em andamento por vez (todas as linhas do índice parcial
-- têm o mesmo valor, então a segunda viola a unicidade).
CREATE UNIQUE INDEX ux_sincronizacao_em_andamento
    ON sincronizacao (situacao)
    WHERE situacao = 'EM_ANDAMENTO';

CREATE INDEX ix_sincronizacao_iniciada_em ON sincronizacao (iniciada_em);
