-- Публичная форма бронирования имеет отдельный источник website. Миграция не меняет данные.
-- migrate:up
ALTER TABLE reservations DROP CONSTRAINT reservations_source_check;
ALTER TABLE reservations
  ADD CONSTRAINT reservations_source_check
  CHECK (source IN ('phone', 'portal', 'website', 'test'));
-- migrate:down
-- Перед откатом публичные брони сохраняются как portal: строки с PII не удаляются.
UPDATE reservations SET source = 'portal' WHERE source = 'website';
ALTER TABLE reservations DROP CONSTRAINT reservations_source_check;
ALTER TABLE reservations
  ADD CONSTRAINT reservations_source_check
  CHECK (source IN ('phone', 'portal', 'test'));
