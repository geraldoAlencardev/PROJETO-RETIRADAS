-- =====================================================================
-- 003 - Máquina de estados
--
-- 1) O status AGUARDANDO passa a se chamar AGENDADA (retirada agendada).
-- 2) A OS ganha dois contadores de tentativas sem sucesso:
--      qtd_tentativas_sem_sucesso -> total acumulado, nunca zera (relatórios)
--      qtd_falhas_ciclo           -> contador oculto; zera quando há uma tentativa
--                                    com sucesso e na volta da reativação. A 3ª falha
--                                    do ciclo leva a OS para Em extravio (RN02).
-- 3) Toda mudança de status atualiza data_entrada_status automaticamente.
-- =====================================================================

ALTER TYPE status_os RENAME VALUE 'AGUARDANDO' TO 'AGENDADA';

ALTER TABLE os ADD COLUMN qtd_tentativas_sem_sucesso integer NOT NULL DEFAULT 0;
ALTER TABLE os ADD COLUMN qtd_falhas_ciclo integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN os.qtd_tentativas_sem_sucesso IS 'Total acumulado de tentativas de contato sem sucesso. Nunca é zerado (relatórios).';
COMMENT ON COLUMN os.qtd_falhas_ciclo IS 'Contador oculto: falhas desde o último sucesso ou desde a volta da reativação. Ao chegar a 3, a OS vai para Em extravio (RN02).';

-- A cada tentativa registrada, atualiza os contadores e a data da última interação.
-- (Substitui a versão do 001, que só contava o total de tentativas.)
CREATE OR REPLACE FUNCTION fn_registrar_interacao()
RETURNS trigger AS $$
BEGIN
    UPDATE os
    SET qtd_tentativas_contato     = qtd_tentativas_contato + 1,
        data_ultima_interacao      = NEW.data_hora,
        qtd_tentativas_sem_sucesso = qtd_tentativas_sem_sucesso
                                     + CASE WHEN NEW.sucesso THEN 0 ELSE 1 END,
        qtd_falhas_ciclo           = CASE WHEN NEW.sucesso THEN 0 ELSE qtd_falhas_ciclo + 1 END
    WHERE id = NEW.os_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Sempre que o status muda, registra o momento da entrada no novo status
-- (base do timeout de 5 dias úteis da reativação, RN11).
CREATE OR REPLACE FUNCTION fn_status_alterado()
RETURNS trigger AS $$
BEGIN
    NEW.data_entrada_status := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_os_status_alterado
    BEFORE UPDATE OF status ON os
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION fn_status_alterado();