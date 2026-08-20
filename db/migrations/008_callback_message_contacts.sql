-- Add the future Telegram source without moving or duplicating existing phone data.
-- migrate:up
ALTER TABLE callback_requests
  ADD COLUMN source text NOT NULL DEFAULT 'voice'
    CHECK (source IN ('voice', 'telegram')),
  ADD COLUMN telegram_user_id text;

ALTER TABLE callback_requests
  ADD CONSTRAINT callback_requests_contact_exclusive_ck CHECK (
    num_nonnulls(caller_phone, telegram_user_id) <= 1
  ),
  ADD CONSTRAINT callback_requests_source_contact_ck CHECK (
    (source = 'voice' AND telegram_user_id IS NULL)
    OR (
      source = 'telegram'
      AND caller_phone IS NULL
      AND telegram_user_id IS NOT NULL
      AND btrim(telegram_user_id) <> ''
    )
  );

-- migrate:down
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM callback_requests
    WHERE source <> 'voice'
       OR telegram_user_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'cannot roll back callback contacts while non-voice contacts exist';
  END IF;
END $$;

ALTER TABLE callback_requests
  DROP CONSTRAINT callback_requests_source_contact_ck,
  DROP CONSTRAINT callback_requests_contact_exclusive_ck,
  DROP COLUMN telegram_user_id,
  DROP COLUMN source;
