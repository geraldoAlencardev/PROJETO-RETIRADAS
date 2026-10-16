-- =====================================================================
-- 002 - Tentativa de contato: registro de sucesso/falha
--
-- A tentativa é registrada depois de realizada. No front, uma caixa de
-- seleção indica se houve sucesso (desmarcada = sem sucesso) e uma caixa de
-- texto guarda a mensagem (coluna "observacao", que já existia).
-- A coluna textual "resultado" deixa de fazer sentido e é removida.
-- =====================================================================

-- Linhas já existentes (apenas dados de desenvolvimento) ficam como "sem sucesso".
ALTER TABLE tentativa_contato ADD COLUMN sucesso boolean NOT NULL DEFAULT false;
-- A partir daqui, quem registra a tentativa precisa informar o valor explicitamente.
ALTER TABLE tentativa_contato ALTER COLUMN sucesso DROP DEFAULT;

ALTER TABLE tentativa_contato DROP COLUMN resultado;

COMMENT ON COLUMN tentativa_contato.sucesso IS 'true = contato bem-sucedido; false = tentativa sem sucesso (base da regra das 3 tentativas, RN02).';
COMMENT ON COLUMN tentativa_contato.observacao IS 'Mensagem/anotação livre sobre a tentativa (caixa de texto do front).';