-- Голосовой движок выбирается отдельно для каждого ресторана.
-- migrate:up
ALTER TABLE restaurants
  ADD COLUMN voice_mode text NOT NULL DEFAULT 'pipeline',
  ADD CONSTRAINT restaurants_voice_mode_check
    CHECK (voice_mode IN ('pipeline', 'realtime'));

-- migrate:down
ALTER TABLE restaurants
  DROP CONSTRAINT restaurants_voice_mode_check,
  DROP COLUMN voice_mode;
