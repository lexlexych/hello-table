-- Restaurant configuration, physical tables, and opening calendar.
-- migrate:up
CREATE TABLE restaurants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK (btrim(name) <> ''), slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
 timezone text NOT NULL DEFAULT 'Europe/Berlin' CHECK (btrim(timezone) <> ''), phone_e164 text CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'), address text,
 default_language char(2) NOT NULL DEFAULT 'de' CHECK (default_language IN ('de','ru','en')), enabled_languages char(2)[] NOT NULL DEFAULT '{de,ru,en}' CHECK (enabled_languages <@ ARRAY['de','ru','en']::char(2)[] AND array_length(enabled_languages,1)>=1),
 slot_minutes int NOT NULL DEFAULT 90 CHECK(slot_minutes BETWEEN 30 AND 300), buffer_minutes int NOT NULL DEFAULT 15 CHECK(buffer_minutes BETWEEN 0 AND 120), booking_step_minutes int NOT NULL DEFAULT 15 CHECK(booking_step_minutes IN(5,10,15,20,30,60)), max_party_size int NOT NULL DEFAULT 8 CHECK(max_party_size BETWEEN 1 AND 100),
 pickup_lead_minutes int NOT NULL DEFAULT 30 CHECK(pickup_lead_minutes BETWEEN 0 AND 480), pickup_slot_capacity int NOT NULL DEFAULT 4 CHECK(pickup_slot_capacity BETWEEN 1 AND 100), callback_within_minutes int NOT NULL DEFAULT 30 CHECK(callback_within_minutes BETWEEN 5 AND 1440), telegram_chat_id text,
 ai_disclosure_de text NOT NULL CHECK(btrim(ai_disclosure_de)<>''), ai_disclosure_ru text NOT NULL CHECK(btrim(ai_disclosure_ru)<>''), ai_disclosure_en text NOT NULL CHECK(btrim(ai_disclosure_en)<>''), greeting_de text, greeting_ru text, greeting_en text, is_active bool NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE restaurant_tables(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,label text NOT NULL CHECK(btrim(label)<>''),seats int NOT NULL CHECK(seats BETWEEN 1 AND 50),zone text,is_active bool NOT NULL DEFAULT true,combinable bool NOT NULL DEFAULT false,UNIQUE(restaurant_id,label));
CREATE INDEX restaurant_tables_active_idx ON restaurant_tables(restaurant_id) WHERE is_active;
CREATE TABLE opening_hours(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,weekday int NOT NULL CHECK(weekday BETWEEN 0 AND 6),opens time,closes time,is_closed bool NOT NULL DEFAULT false,CHECK((is_closed AND opens IS NULL AND closes IS NULL) OR (NOT is_closed AND opens IS NOT NULL AND closes IS NOT NULL AND closes<>opens)),UNIQUE NULLS NOT DISTINCT(restaurant_id,weekday,opens));
CREATE INDEX opening_hours_lookup_idx ON opening_hours(restaurant_id,weekday);
CREATE TABLE special_closures(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,date date NOT NULL,reason text,UNIQUE(restaurant_id,date));
-- migrate:down
DROP TABLE special_closures; DROP TABLE opening_hours; DROP TABLE restaurant_tables; DROP TABLE restaurants;
