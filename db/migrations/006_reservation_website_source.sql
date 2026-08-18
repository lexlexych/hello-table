-- Публичная форма бронирования имеет отдельный источник website. Миграция не меняет данные.
-- Откат: удалить строки source='website', затем вернуть CHECK со значениями
-- ('phone','portal','test').

ALTER TABLE reservations DROP CONSTRAINT reservations_source_check;
ALTER TABLE reservations
  ADD CONSTRAINT reservations_source_check
  CHECK (source IN ('phone', 'portal', 'website', 'test'));
