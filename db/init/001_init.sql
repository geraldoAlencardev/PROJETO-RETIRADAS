-- =====================================================================
-- DDL - Sistema de Gestão de Ordens de Serviço (OS) de Retirada de Equipamentos
-- Dialeto: PostgreSQL (ajustar tipos/funções se outro SGBD for escolhido
-- na etapa de arquitetura técnica — ver "Próximos passos")
-- =====================================================================

-- Extensão para geração de UUID (gen_random_uuid)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------
-- Tipos enumerados
-- ---------------------------------------------------------------------

-- Status possíveis da OS (RN06)
CREATE TYPE status_os AS ENUM (
    'PENDENTE',
    'EM_CONTATO',
    'AGUARDANDO',
    'ATRASADA',
    'EM_EXTRAVIO',
    'MULTA_GERADA',
    'EM_REATIVACAO',
    'REATIVACAO_CONCLUIDA',
    'RETIRADA_OK'
);

-- Canal utilizado na tentativa de contato
CREATE TYPE canal_contato AS ENUM (
    'TELEFONE',
    'WHATSAPP',
    'EMAIL',
    'OUTRO'
);

-- Quem motivou o reagendamento (RN: cliente x empresa)
CREATE TYPE tipo_motivo_reagendamento AS ENUM (
    'CLIENTE',
    'EMPRESA'
);

-- Abrangência do feriado, conforme retornado pela FeriadosAPI
-- FACULTATIVO incluído porque pontos facultativos contam como dia não
-- útil no cálculo de Atrasada (RN03) e do timeout de Em reativação (RN11)
CREATE TYPE abrangencia_feriado AS ENUM (
    'NACIONAL',
    'ESTADUAL',
    'MUNICIPAL',
    'FACULTATIVO'
);

-- ---------------------------------------------------------------------
-- Tabela: usuario
-- ---------------------------------------------------------------------
CREATE TABLE usuario (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome            varchar(150) NOT NULL,
    login           varchar(100) NOT NULL UNIQUE,
    senha_hash      varchar(255) NOT NULL,
    ativo           boolean NOT NULL DEFAULT true,
    criado_em       timestamp NOT NULL DEFAULT now(),
    atualizado_em   timestamp NOT NULL DEFAULT now()
);

COMMENT ON TABLE usuario IS 'Usuários do sistema. Perfil único, com permissão para alterar qualquer informação (RN05).';

-- ---------------------------------------------------------------------
-- Tabela: os (núcleo do sistema)
-- ---------------------------------------------------------------------
CREATE TABLE os (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Dados de origem (API externa de OS) — RF04 / RN08
    os_externa_id           varchar(50) NOT NULL UNIQUE,
    cliente_nome            varchar(200) NOT NULL,
    contrato_id             varchar(50) NOT NULL,
    bairro                  varchar(100),
    endereco                varchar(300) NOT NULL,
    data_abertura           date NOT NULL,

    -- Dados operacionais — geridos pela aplicação
    status                  status_os NOT NULL DEFAULT 'PENDENTE',
    data_entrada_status     timestamp NOT NULL DEFAULT now(),
    data_ultima_interacao   timestamp,
    qtd_tentativas_contato  integer NOT NULL DEFAULT 0,

    criado_em               timestamp NOT NULL DEFAULT now(),
    atualizado_em           timestamp NOT NULL DEFAULT now()
);

COMMENT ON TABLE os IS 'Tabela central. Sincronização externa deve atualizar apenas os campos de origem, nunca os operacionais (RN08).';
COMMENT ON COLUMN os.data_entrada_status IS 'Usado no timeout de 5 dias úteis de Em reativação (RN11).';
COMMENT ON COLUMN os.data_ultima_interacao IS 'Usado no cálculo de Atrasada: 5 dias úteis sem interação (RN03).';

-- ---------------------------------------------------------------------
-- Tabela: tentativa_contato
-- ---------------------------------------------------------------------
CREATE TABLE tentativa_contato (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    os_id       uuid NOT NULL REFERENCES os(id),
    usuario_id  uuid NOT NULL REFERENCES usuario(id),
    data_hora   timestamp NOT NULL DEFAULT now(),
    canal       canal_contato NOT NULL,
    resultado   varchar(150) NOT NULL,
    observacao  text
);

COMMENT ON TABLE tentativa_contato IS 'Uma linha por tentativa de contato (RF10). Alimenta os.qtd_tentativas_contato e os.data_ultima_interacao via trigger.';

-- ---------------------------------------------------------------------
-- Tabela: agendamento (histórico completo de datas propostas — RN04)
-- ---------------------------------------------------------------------
CREATE TABLE agendamento (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    os_id               uuid NOT NULL REFERENCES os(id),
    usuario_id          uuid NOT NULL REFERENCES usuario(id),
    data_prevista       date NOT NULL,
    horario             time,
    data_hora_registro  timestamp NOT NULL DEFAULT now(),
    vigente             boolean NOT NULL DEFAULT true,
    tipo_motivo         tipo_motivo_reagendamento,   -- NULL no primeiro agendamento
    motivo_detalhe      varchar(300)
);

COMMENT ON TABLE agendamento IS 'Cada (re)agendamento gera uma nova linha; nada é sobrescrito (RN04).';

-- Garante no máximo um agendamento vigente por OS
CREATE UNIQUE INDEX ux_agendamento_vigente_por_os
    ON agendamento (os_id)
    WHERE vigente;

-- ---------------------------------------------------------------------
-- Tabela: historico_evento (linha do tempo de negócio — RF24/RF25)
-- ---------------------------------------------------------------------
CREATE TABLE historico_evento (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    os_id       uuid NOT NULL REFERENCES os(id),
    usuario_id  uuid REFERENCES usuario(id),   -- NULL em eventos automáticos do sistema
    data_hora   timestamp NOT NULL DEFAULT now(),
    tipo_evento varchar(50) NOT NULL,
    descricao   text NOT NULL,
    motivo      text
);

COMMENT ON TABLE historico_evento IS 'Narrativa de negócio da OS: recebimento, contato, agendamento, mudança de status, conclusão etc.';

-- ---------------------------------------------------------------------
-- Tabela: log_alteracao (auditoria técnica campo a campo — RNF02)
-- ---------------------------------------------------------------------
CREATE TABLE log_alteracao (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    os_id           uuid NOT NULL REFERENCES os(id),
    usuario_id      uuid NOT NULL REFERENCES usuario(id),
    data_hora       timestamp NOT NULL DEFAULT now(),
    campo_alterado  varchar(100) NOT NULL,
    valor_anterior  text,
    valor_novo      text
);

COMMENT ON TABLE log_alteracao IS 'Quem alterou o quê, quando (RNF02). Propósito distinto de historico_evento (auditoria técnica x narrativa de negócio).';

-- ---------------------------------------------------------------------
-- Tabela: feriado (cache local sincronizado a partir da FeriadosAPI)
-- ---------------------------------------------------------------------
CREATE TABLE feriado (
    id                serial PRIMARY KEY,
    feriadosapi_id    uuid UNIQUE,
    data              date NOT NULL,
    descricao         varchar(150) NOT NULL,
    abrangencia       abrangencia_feriado NOT NULL,
    sincronizado_em   timestamp NOT NULL DEFAULT now()
);

COMMENT ON TABLE feriado IS 'Feriados nacionais/estaduais/municipais/facultativos (Camaçari/BA, IBGE 2905701), sincronizados periodicamente via FeriadosAPI. Usado no cálculo de dias úteis (RN03/RN11).';
COMMENT ON COLUMN feriado.feriadosapi_id IS 'UUID retornado pela FeriadosAPI (campo "id"). Usado para upsert na sincronização, evitando duplicar linhas.';

CREATE INDEX ix_feriado_data ON feriado (data);

-- ---------------------------------------------------------------------
-- Índices recomendados
-- ---------------------------------------------------------------------
CREATE INDEX ix_os_status                  ON os (status);
CREATE INDEX ix_os_data_entrada_status     ON os (data_entrada_status);
CREATE INDEX ix_os_data_ultima_interacao   ON os (data_ultima_interacao);

CREATE INDEX ix_tentativa_contato_os_id    ON tentativa_contato (os_id);
CREATE INDEX ix_agendamento_os_id          ON agendamento (os_id);
CREATE INDEX ix_historico_evento_os_id     ON historico_evento (os_id);
CREATE INDEX ix_log_alteracao_os_id        ON log_alteracao (os_id);

-- ---------------------------------------------------------------------
-- Triggers de apoio
-- ---------------------------------------------------------------------

-- Atualiza automaticamente os.atualizado_em a cada UPDATE
CREATE OR REPLACE FUNCTION fn_atualizar_timestamp()
RETURNS trigger AS $$
BEGIN
    NEW.atualizado_em := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_os_atualizado_em
    BEFORE UPDATE ON os
    FOR EACH ROW
    EXECUTE FUNCTION fn_atualizar_timestamp();

-- A cada nova tentativa de contato, incrementa o contador (RF11) e
-- atualiza a data da última interação (usada em RN03)
CREATE OR REPLACE FUNCTION fn_registrar_interacao()
RETURNS trigger AS $$
BEGIN
    UPDATE os
    SET qtd_tentativas_contato = qtd_tentativas_contato + 1,
        data_ultima_interacao = NEW.data_hora
    WHERE id = NEW.os_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tentativa_contato_registrar_interacao
    AFTER INSERT ON tentativa_contato
    FOR EACH ROW
    EXECUTE FUNCTION fn_registrar_interacao();

-- Ao registrar um novo agendamento vigente, desmarca o anterior
-- (mantém histórico completo — RN04)
CREATE OR REPLACE FUNCTION fn_desmarcar_agendamento_anterior()
RETURNS trigger AS $$
BEGIN
    IF NEW.vigente THEN
        UPDATE agendamento
        SET vigente = false
        WHERE os_id = NEW.os_id
          AND id <> NEW.id
          AND vigente;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_agendamento_desmarcar_anterior
    BEFORE INSERT ON agendamento
    FOR EACH ROW
    EXECUTE FUNCTION fn_desmarcar_agendamento_anterior();
