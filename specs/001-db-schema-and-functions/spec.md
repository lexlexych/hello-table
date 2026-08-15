---
spec: 001
title: База данных — схема, функции, роли, seed, тесты на гонку
iteration: 2
status: implemented
author: claude-code
date: 2026-08-15
---

# Спецификация 001 — База данных: схема, функции, роли, seed, тесты на гонку

## 1. Цель и контекст

Итерация 2 из docs/PROJECT.md §12: **«База: миграции, функции, роли, seed, тесты на гонку»**.

Это первая итерация с кодом. Она создаёт фундамент, от которого зависят все следующие:
n8n вызывает только эти функции (§3.4, §3.5), портал читает эти таблицы (§7), агент к базе
не ходит вообще. Бизнес-логика бронирования и заказов живёт **только** в Postgres-функциях —
это ключевое архитектурное правило проекта (§3.4): два одновременных звонка не должны
забронировать один столик, и гарантировать это может только транзакция с блокировкой.

Разделы PROJECT.md, которые описывают эту итерацию:

- **§5** — модель данных: таблицы (§5.1), функции (§5.2), роли (§5.3);
- **§3.4** — что живёт в Postgres, а что в n8n;
- **§3.5** — `n8n_app` имеет `EXECUTE` только на функции и **никаких прав на таблицы**;
- **§6.1** — правила самовывоза: сопоставление позиций, расчёт времени готовности базой,
  4-значный номер заказа, генерируемый базой;
- **§6.2** — обратный звонок: резюме максимум 400 символов, срок перезвона из настроек;
- **§11** — правовой контур: `delete_after` и автоудаление, `CHECK` на объявление об ИИ,
  отсутствие аудио и транскриптов;
- **§13** — приёмочные проверки, четыре из которых закрываются этой итерацией.

Обязательный чек-лист: `.claude/skills/db-migrations/SKILL.md`. Его требования вшиты
в разделы 3–6 этой спеки (нумерация миграций, обратимость, функции отдельно от таблиц,
тест на гонку, `delete_after`, роли, отсутствие ORM).

## 2. Объём

**Входит:**

1. Инфраструктура миграций: нумерованные SQL-файлы + собственный раннер на TypeScript
   (`pnpm db:migrate`, `db:rollback`, `db:seed`, `db:reset`).
2. Полная схема из PROJECT.md §5.1: 11 таблиц, ограничения, индексы, триггеры `delete_after`.
3. Все 8 функций из §5.2 плюс 5 внутренних вспомогательных функций.
4. Роли и права из §5.3 (`app_owner`, `n8n_app`, `portal_app`).
5. `db/seed.sql` — один демо-ресторан с меню на трёх языках, столиками и часами работы.
6. Автотесты vitest против локального Postgres в Docker, включая **два теста на гонку**
   (двойное бронирование и перепродажа слота самовывоза).
7. Первая фиксация версий зависимостей: `package.json`, lock-файл, `biome.json`,
   таблица версий в `docs/architecture.md` (требование PROJECT.md §2.1).
8. Заполнение сервиса `postgres` в `deploy/docker-compose.dev.yml` и точная версия
   образа в `deploy/docker-compose.yml`.

**Не входит (явно):**

- zod-схемы в `packages/contracts` — они описывают контракты вебхуков, а не строки БД
  (итерации 5–8);
- workflow n8n и HTTP-обвязка (итерация 5);
- код агента и портала (итерации 3+ и 9+);
- ночной cron, вызывающий `purge_expired_personal_data()` — сама функция создаётся здесь,
  расписание настраивается в итерации 15; `deploy/backup.sh` — итерация 12;
- права субъекта данных (экспорт и удаление по номеру телефона, §11.5) — итерация 14;
- объединение столиков под большую компанию (`combinable`) — в версии 1 не реализуется,
  см. правку PROJECT.md §5.1;
- любые обращения к внешним API. В этой итерации их нет вообще — вся работа локальна.

## 3. Техническое решение

### 3.1 Дерево изменений

```
СОЗДАЁТСЯ
├── biome.json                                  линт и формат, первая настройка
├── vitest.config.ts                            конфиг тестов
├── tsconfig.json                               корневой, для scripts/ и db/tests/
├── db/
│   ├── README.md                               как устроен db/, таблица кодов ошибок
│   ├── migrations/
│   │   ├── 001_extensions.sql
│   │   ├── 002_restaurants_and_tables.sql
│   │   ├── 003_menu.sql
│   │   └── 004_operations.sql
│   ├── functions/
│   │   ├── 000_helpers.sql                     app_normalize_text, app_normalize_phone
│   │   ├── 010_delete_after_triggers.sql        3 триггерные функции + CREATE TRIGGER
│   │   ├── 050_opening_windows.sql             окна работы на дату
│   │   ├── 060_is_open_between.sql             попадает ли интервал в окно
│   │   ├── 070_pickup_slot_is_free.sql         свободен ли слот самовывоза
│   │   ├── 075_pickup_items_expand.sql         разбор jsonb-корзины
│   │   ├── 100_find_available_slots.sql        §5.2
│   │   ├── 110_create_reservation_atomic.sql   §5.2 — гонка
│   │   ├── 120_cancel_reservation_by_phone.sql §5.2
│   │   ├── 200_find_menu_items.sql             §5.2
│   │   ├── 300_find_pickup_slots.sql           §5.2
│   │   ├── 310_create_pickup_order_atomic.sql  §5.2 — гонка
│   │   ├── 400_create_callback_request.sql     §5.2
│   │   └── 900_purge_expired_personal_data.sql §5.2
│   ├── roles.sql                               §5.3
│   ├── seed.sql                                демо-ресторан
│   └── tests/
│       ├── global-setup.ts
│       ├── helpers/db.ts
│       ├── helpers/fixtures.ts
│       ├── migrate.test.ts
│       ├── schema.test.ts
│       ├── permissions.test.ts
│       ├── find-available-slots.test.ts
│       ├── create-reservation.test.ts          + гонка
│       ├── cancel-reservation.test.ts
│       ├── find-menu-items.test.ts
│       ├── pickup.test.ts                      + гонка
│       ├── callback-and-purge.test.ts
│       └── seed.test.ts
└── scripts/db/
    ├── lib/config.ts                           разбор URL, защитные проверки
    ├── lib/apply.ts                            применение миграций, функций, ролей
    ├── migrate.ts
    ├── rollback.ts
    ├── seed.ts
    └── reset.ts

ИЗМЕНЯЕТСЯ
├── package.json                                devDependencies + scripts
├── pnpm-lock.yaml                              появляется впервые
├── .env.example                                пароли ролей, TEST_DATABASE_URL
├── README.md                                   раздел «Локальная разработка»
├── deploy/docker-compose.dev.yml               наполняется сервис postgres
├── deploy/docker-compose.yml                   точная минорная версия образа postgres
└── docs/architecture.md                        таблица версий + журнал решений

УДАЛЯЕТСЯ
├── db/migrations/.gitkeep
├── db/functions/.gitkeep
└── scripts/.gitkeep
```

### 3.2 Принятые решения и отвергнутые альтернативы

| Решение | Альтернатива | Почему так |
|---|---|---|
| Свой раннер миграций на TypeScript (~150 строк) | `dbmate` | dbmate — Go-бинарник; ставить его рядом с TS-монорепо значит завести вторую тулчейн-зависимость и усложнить CI и Docker-образ. Функции всё равно применяются отдельным шагом, которого у dbmate нет. **Формат файлов при этом взят dbmate-совместимый** (`-- migrate:up` / `-- migrate:down`), так что переход на dbmate остаётся однострочным решением |
| Статусы как `text` + `CHECK` | `CREATE TYPE ... AS ENUM` | enum расширяется только через `ALTER TYPE`, значения не удаляются, а миграция «добавить статус» становится нетривиальной. `text + CHECK` меняется обычной миграцией и одинаково читается в psql, портале и n8n |
| `EXCLUDE USING gist` на `reservations` **в дополнение** к `SELECT ... FOR UPDATE` | только `FOR UPDATE` | PROJECT.md §3.4 требует блокировку в функции — она и делает основную работу и даёт внятную ошибку `no_table_available`. Ограничение-исключение ловит любой путь мимо функции (ручной INSERT из портала, ошибка в будущей функции). Стоит одну строку, защищает главный инвариант проекта навсегда |
| Расчёт суммы и времени готовности — в SQL | в n8n / в агенте | PROJECT.md §3.4 и §6.1 прямо это требуют |
| Никаких trigram-индексов на меню | GIN-индекс по нормализованному тексту | меню — десятки строк на ресторан; seq scan занимает микросекунды, а индекс по выражению привязывает функцию нормализации к индексу и усложняет её изменение. Пересмотреть, если у ресторана окажется > 2000 позиций |
| `pg_trgm` + `unaccent` для нечёткого поиска блюд | точное сравнение | из речи приходит «маргарита», «пицца маргарита», «Margherita» — точное сравнение здесь бесполезно (PROJECT.md §6.1: если совпадений несколько, агент переспрашивает, а не угадывает — значит функция обязана находить несколько кандидатов) |
| Номер заказа уникален среди **активных** заказов ресторана | глобально уникален / уникален за день | номер диктуется голосом и живёт до выдачи; после `picked_up` его можно переиспользовать. Частичный уникальный индекс — самая простая гарантия того, что два клиента одновременно не получат одинаковый номер |
| `roles.sql` применяется **после** функций и на каждом прогоне | один раз при инициализации | Postgres по умолчанию выдаёт `EXECUTE` на новую функцию роли `PUBLIC`. Если не отзывать это явно после каждого добавления функции, `n8n_app` получит доступ ко всему, что появится позже, — прямое нарушение §3.5 |

### 3.3 Миграции

Формат каждого файла — dbmate-совместимый:

```sql
-- Комментарий-шапка: что делает миграция и что произойдёт при откате.
-- migrate:up
<SQL>
-- migrate:down
<SQL отката>
```

Правила (навык `db-migrations`): применённая миграция не редактируется — раннер хранит
sha256 каждого файла и падает при расхождении; изменение схемы — только новым файлом.
Во время разработки самой итерации 2 файлы, разумеется, правятся — для этого есть
`pnpm db:reset`, который пересоздаёт локальную базу с нуля.

#### `001_extensions.sql`

```sql
-- migrate:up
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- нечёткий поиск блюд по речи
CREATE EXTENSION IF NOT EXISTS unaccent;    -- ä/ö/ü/ё при сопоставлении названий
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- EXCLUDE-ограничение по (table_id, интервал)

-- migrate:down
DROP EXTENSION IF EXISTS btree_gist;
DROP EXTENSION IF EXISTS unaccent;
DROP EXTENSION IF EXISTS pg_trgm;
```

Все три расширения помечены `trusted` начиная с Postgres 13, а `app_owner` — владелец базы
(его создаёт официальный образ по `POSTGRES_USER`), поэтому `CREATE EXTENSION` проходит
без суперпользовательских прав. Если в целевой среде это окажется не так — Codex фиксирует
факт в `docs/architecture.md` и в `manual-tests.md` как шаг «выполнить от суперпользователя».

#### `002_restaurants_and_tables.sql`

```sql
-- migrate:up
CREATE TABLE restaurants (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL CHECK (btrim(name) <> ''),
  slug                    text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
  timezone                text NOT NULL DEFAULT 'Europe/Berlin' CHECK (btrim(timezone) <> ''),
  phone_e164              text CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  address                 text,
  default_language        char(2) NOT NULL DEFAULT 'de' CHECK (default_language IN ('de','ru','en')),
  enabled_languages       char(2)[] NOT NULL DEFAULT '{de,ru,en}'
                            CHECK (enabled_languages <@ ARRAY['de','ru','en']::char(2)[]
                                   AND array_length(enabled_languages, 1) >= 1),
  slot_minutes            int NOT NULL DEFAULT 90  CHECK (slot_minutes BETWEEN 30 AND 300),
  buffer_minutes          int NOT NULL DEFAULT 15  CHECK (buffer_minutes BETWEEN 0 AND 120),
  booking_step_minutes    int NOT NULL DEFAULT 15  CHECK (booking_step_minutes IN (5,10,15,20,30,60)),
  max_party_size          int NOT NULL DEFAULT 8   CHECK (max_party_size BETWEEN 1 AND 100),
  pickup_lead_minutes     int NOT NULL DEFAULT 30  CHECK (pickup_lead_minutes BETWEEN 0 AND 480),
  pickup_slot_capacity    int NOT NULL DEFAULT 4   CHECK (pickup_slot_capacity BETWEEN 1 AND 100),
  callback_within_minutes int NOT NULL DEFAULT 30  CHECK (callback_within_minutes BETWEEN 5 AND 1440),
  telegram_chat_id        text,
  -- §11.1: объявление об ИИ обязательно и не может быть пустым — санкции до 15 млн €
  ai_disclosure_de        text NOT NULL CHECK (btrim(ai_disclosure_de) <> ''),
  ai_disclosure_ru        text NOT NULL CHECK (btrim(ai_disclosure_ru) <> ''),
  ai_disclosure_en        text NOT NULL CHECK (btrim(ai_disclosure_en) <> ''),
  -- §4.2: NULL означает «взять фразу из i18n-yaml агента»
  greeting_de             text,
  greeting_ru             text,
  greeting_en             text,
  is_active               bool NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE restaurant_tables (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  label         text NOT NULL CHECK (btrim(label) <> ''),
  seats         int  NOT NULL CHECK (seats BETWEEN 1 AND 50),
  zone          text,
  is_active     bool NOT NULL DEFAULT true,
  combinable    bool NOT NULL DEFAULT false,   -- в v1 не используется, см. §5.1
  UNIQUE (restaurant_id, label)
);
CREATE INDEX restaurant_tables_active_idx ON restaurant_tables (restaurant_id) WHERE is_active;

-- weekday: 0 = понедельник (PROJECT.md §5.1).
-- closes <= opens означает окно через полночь: 18:00–01:00.
-- Несколько строк на один weekday допустимы: обед + ужин.
CREATE TABLE opening_hours (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  weekday       int  NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens         time,
  closes        time,
  is_closed     bool NOT NULL DEFAULT false,
  CHECK ((is_closed AND opens IS NULL AND closes IS NULL)
      OR (NOT is_closed AND opens IS NOT NULL AND closes IS NOT NULL AND closes <> opens)),
  UNIQUE NULLS NOT DISTINCT (restaurant_id, weekday, opens)
);
CREATE INDEX opening_hours_lookup_idx ON opening_hours (restaurant_id, weekday);

CREATE TABLE special_closures (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  date          date NOT NULL,
  reason        text,
  UNIQUE (restaurant_id, date)
);

-- migrate:down
DROP TABLE special_closures;
DROP TABLE opening_hours;
DROP TABLE restaurant_tables;
DROP TABLE restaurants;
```

Валидность строки `timezone` (существование зоны в `pg_timezone_names`) в `CHECK` не
проверить — подзапросы там запрещены. Проверка остаётся на портале (итерация 10, zod).

#### `003_menu.sql`

```sql
-- migrate:up
CREATE TABLE menu_categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name_de       text NOT NULL CHECK (btrim(name_de) <> ''),
  name_ru       text NOT NULL CHECK (btrim(name_ru) <> ''),
  name_en       text NOT NULL CHECK (btrim(name_en) <> ''),
  sort_order    int  NOT NULL DEFAULT 0,
  UNIQUE (restaurant_id, name_de)
);

CREATE TABLE menu_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id    uuid NOT NULL REFERENCES menu_categories(id) ON DELETE RESTRICT,
  name_de        text NOT NULL CHECK (btrim(name_de) <> ''),
  name_ru        text NOT NULL CHECK (btrim(name_ru) <> ''),
  name_en        text NOT NULL CHECK (btrim(name_en) <> ''),
  description_de text,
  description_ru text,
  description_en text,
  price_cents    int  NOT NULL CHECK (price_cents >= 0),
  -- 14 аллергенов из приложения II регламента ЕС 1169/2011; список закрытый,
  -- опечатка здесь означает, что поиск «без орехов» пропустит блюдо с орехами
  allergens      text[] NOT NULL DEFAULT '{}'
                   CHECK (allergens <@ ARRAY['gluten','crustaceans','eggs','fish','peanuts',
                                             'soybeans','milk','nuts','celery','mustard',
                                             'sesame','sulphites','lupin','molluscs']::text[]),
  is_vegetarian  bool NOT NULL DEFAULT false,
  is_vegan       bool NOT NULL DEFAULT false,
  is_available   bool NOT NULL DEFAULT true,
  aliases        text[] NOT NULL DEFAULT '{}',   -- варианты произношения для речи
  prep_minutes   int  NOT NULL DEFAULT 15 CHECK (prep_minutes BETWEEN 0 AND 240),
  CHECK (NOT is_vegan OR is_vegetarian)          -- веганское всегда вегетарианское
);
CREATE INDEX menu_items_category_idx ON menu_items (category_id);
CREATE INDEX menu_items_available_idx ON menu_items (category_id) WHERE is_available;

-- migrate:down
DROP TABLE menu_items;
DROP TABLE menu_categories;
```

#### `004_operations.sql`

```sql
-- migrate:up
CREATE TABLE reservations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_id      uuid NOT NULL REFERENCES restaurant_tables(id) ON DELETE RESTRICT,
  guest_name    text NOT NULL CHECK (btrim(guest_name) <> ''),
  guest_phone   text,
  party_size    int  NOT NULL CHECK (party_size BETWEEN 1 AND 100),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'confirmed'
                  CHECK (status IN ('confirmed','cancelled','no_show','seated')),
  source        text NOT NULL CHECK (source IN ('phone','portal','test')),
  language      char(2) NOT NULL CHECK (language IN ('de','ru','en')),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  delete_after  date,
  CHECK (ends_at > starts_at),
  -- Страховка на случай пути мимо create_reservation_atomic: один столик не может
  -- быть занят двумя активными бронями с пересекающимися интервалами.
  -- Буфер между бронями здесь не учитывается — он применяется в функции.
  CONSTRAINT reservations_no_overlap EXCLUDE USING gist (
    table_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status IN ('confirmed','seated'))
);
CREATE INDEX reservations_by_date_idx  ON reservations (restaurant_id, starts_at);
CREATE INDEX reservations_by_phone_idx ON reservations (restaurant_id, guest_phone);
CREATE INDEX reservations_purge_idx    ON reservations (delete_after) WHERE delete_after IS NOT NULL;

CREATE TABLE pickup_orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  order_number  text NOT NULL CHECK (order_number ~ '^[0-9]{4}$'),
  guest_name    text NOT NULL CHECK (btrim(guest_name) <> ''),
  guest_phone   text,
  ready_at      timestamptz NOT NULL,
  total_cents   int  NOT NULL CHECK (total_cents >= 0),
  status        text NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new','confirmed','preparing','ready','picked_up','cancelled')),
  source        text NOT NULL CHECK (source IN ('phone','portal','test')),
  language      char(2) NOT NULL CHECK (language IN ('de','ru','en')),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  delete_after  date
);
-- Номер диктуется голосом и должен быть уникален среди заказов, которые ещё не выданы
CREATE UNIQUE INDEX pickup_orders_active_number_uk ON pickup_orders (restaurant_id, order_number)
  WHERE status IN ('new','confirmed','preparing','ready');
CREATE INDEX pickup_orders_by_ready_idx ON pickup_orders (restaurant_id, ready_at);
CREATE INDEX pickup_orders_purge_idx    ON pickup_orders (delete_after) WHERE delete_after IS NOT NULL;

CREATE TABLE pickup_order_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES pickup_orders(id) ON DELETE CASCADE,
  menu_item_id     uuid NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT,
  quantity         int  NOT NULL CHECK (quantity BETWEEN 1 AND 50),
  unit_price_cents int  NOT NULL CHECK (unit_price_cents >= 0),  -- цена на момент заказа
  note             text
);
CREATE INDEX pickup_order_items_order_idx ON pickup_order_items (order_id);

CREATE TABLE callback_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  caller_phone  text,
  language      char(2) NOT NULL CHECK (language IN ('de','ru','en')),
  -- §6.2: резюме максимум 400 символов. Полный транскрипт не сохраняется
  summary       text NOT NULL CHECK (btrim(summary) <> '' AND length(summary) <= 400),
  category      text NOT NULL CHECK (category IN ('banquet','complaint','special','other')),
  status        text NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','done')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  handled_by    text,
  handled_at    timestamptz,
  delete_after  date
);
CREATE INDEX callback_requests_queue_idx ON callback_requests (restaurant_id, status, created_at DESC);
CREATE INDEX callback_requests_purge_idx ON callback_requests (delete_after) WHERE delete_after IS NOT NULL;

-- §5.1: в call_logs нет ни аудио, ни транскрипта, ни персональных данных.
-- Поэтому здесь нет delete_after: удалять по DSGVO нечего.
CREATE TABLE call_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  room_name      text NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  ended_at       timestamptz,
  language       char(2) CHECK (language IS NULL OR language IN ('de','ru','en')),
  outcome        text CHECK (outcome IS NULL OR outcome IN ('reservation','pickup','info','callback','failed')),
  turn_count     int  NOT NULL DEFAULT 0 CHECK (turn_count >= 0),
  is_test        bool NOT NULL DEFAULT false,
  reservation_id uuid REFERENCES reservations(id)      ON DELETE SET NULL,
  order_id       uuid REFERENCES pickup_orders(id)     ON DELETE SET NULL,
  callback_id    uuid REFERENCES callback_requests(id) ON DELETE SET NULL
);
CREATE INDEX call_logs_by_date_idx ON call_logs (restaurant_id, started_at DESC);

-- migrate:down
DROP TABLE call_logs;
DROP TABLE callback_requests;
DROP TABLE pickup_order_items;
DROP TABLE pickup_orders;
DROP TABLE reservations;
```

`ON DELETE SET NULL` в `call_logs` обязателен: автоудаление персональных данных
(§11.4) удаляет брони и заказы, а статистика звонков должна это переживать.

### 3.4 Функции

Общие правила для всех файлов в `db/functions/`:

- `CREATE OR REPLACE`, файл применяется целиком на каждом прогоне `db:migrate`;
- язык `plpgsql` (единственное исключение — чистые хелперы в `000_helpers.sql` на `sql`).
  Причина: тело `plpgsql` не резолвит имена таблиц при создании, поэтому порядок применения
  файлов и наличие таблиц не создают хрупкости;
- `SECURITY DEFINER` + обязательный `SET search_path = public, pg_temp` — без этого
  `SECURITY DEFINER` небезопасен;
- функции только читающие помечаются `STABLE`;
- **имена выходных полей не совпадают с именами колонок таблиц, к которым обращается
  функция** — иначе plpgsql не различает переменную и колонку (ошибка 42702);
- ошибки поднимаются как `RAISE EXCEPTION '<машинный код>' USING ERRCODE = '<45xxx>'`.

Таблица кодов ошибок (переносится Codex в `db/README.md`):

| SQLSTATE | MESSAGE | Где |
|---|---|---|
| 45000 | `restaurant_not_found` | все функции |
| 45001 | `no_table_available` | `create_reservation_atomic` |
| 45002 | `slot_full` | `create_pickup_order_atomic` |
| 45003 | `item_unavailable` | `create_pickup_order_atomic` |
| 45004 | `closed_at_requested_time` | `create_reservation_atomic` |
| 45005 | `party_too_large` | `create_reservation_atomic` |
| 45006 | `slot_in_past` | `create_reservation_atomic` |
| 45007 | `empty_order` | `create_pickup_order_atomic` |
| 45008 | `invalid_quantity` | `create_pickup_order_atomic` |
| 45009 | `no_pickup_slot` | `create_pickup_order_atomic` |
| 45010 | `pickup_too_early` | `create_pickup_order_atomic` |
| 45011 | `order_number_exhausted` | `create_pickup_order_atomic` |
| 45012 | `phone_required` | `cancel_reservation_by_phone` |
| 45013 | `invalid_category` | `create_callback_request` |
| 45014 | `summary_too_long` | `create_callback_request` |

#### `000_helpers.sql`

```sql
-- Нормализация текста для сопоставления названий блюд с распознанной речью.
-- unaccent(regdictionary, text) — IMMUTABLE, в отличие от unaccent(text).
CREATE OR REPLACE FUNCTION app_normalize_text(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT lower(unaccent('unaccent'::regdictionary, p_text));
$$;

-- Приведение телефона к цифрам без ведущего плюса или 00:
-- '+49 30 123456' и '0049 30 123456' дают одинаковый результат.
-- Национальный формат ('030 123456') нормализовать невозможно без кода страны —
-- агент всегда получает E.164 из SIP-метаданных.
CREATE OR REPLACE FUNCTION app_normalize_phone(p_phone text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN p_phone IS NULL THEN NULL
    WHEN regexp_replace(p_phone, '\D', '', 'g') = '' THEN NULL
    WHEN left(regexp_replace(p_phone, '\D', '', 'g'), 2) = '00'
      THEN substr(regexp_replace(p_phone, '\D', '', 'g'), 3)
    ELSE regexp_replace(p_phone, '\D', '', 'g')
  END;
$$;
```

#### `010_delete_after_triggers.sql`

Три триггерные функции и три триггера в одном файле. `CREATE TRIGGER` не идемпотентен,
поэтому каждому предшествует `DROP TRIGGER IF EXISTS`; файл применяется после миграций,
таблицы к этому моменту существуют.

```sql
CREATE OR REPLACE FUNCTION set_reservation_delete_after() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_tz text;
BEGIN
  SELECT r.timezone INTO v_tz FROM restaurants r WHERE r.id = NEW.restaurant_id;
  NEW.delete_after := ((NEW.starts_at AT TIME ZONE coalesce(v_tz, 'Europe/Berlin'))::date + 30);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_reservations_delete_after ON reservations;
CREATE TRIGGER trg_reservations_delete_after
  BEFORE INSERT OR UPDATE OF starts_at, restaurant_id ON reservations
  FOR EACH ROW EXECUTE FUNCTION set_reservation_delete_after();
```

Аналогично: `set_pickup_order_delete_after()` — `ready_at::date + 30`, триггер на
`INSERT OR UPDATE OF ready_at, restaurant_id`; `set_callback_delete_after()` —
`coalesce(handled_at, created_at)::date + 14`, триггер на
`INSERT OR UPDATE OF handled_at, created_at, restaurant_id`.

#### `050_opening_windows.sql`

```sql
-- Окна работы, НАЧИНАЮЩИЕСЯ в указанную локальную дату (окно может уходить за полночь).
-- Особые закрытия применяются к дате начала окна.
CREATE OR REPLACE FUNCTION opening_windows(p_restaurant uuid, p_date date)
RETURNS TABLE (win tstzrange)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tz text;
BEGIN
  SELECT r.timezone INTO v_tz FROM restaurants r WHERE r.id = p_restaurant;
  IF v_tz IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM special_closures sc
              WHERE sc.restaurant_id = p_restaurant AND sc.date = p_date) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT tstzrange(
           (p_date + oh.opens) AT TIME ZONE v_tz,
           (p_date + oh.closes
              + CASE WHEN oh.closes <= oh.opens THEN interval '1 day' ELSE interval '0 day' END)
             AT TIME ZONE v_tz)
  FROM opening_hours oh
  WHERE oh.restaurant_id = p_restaurant
    AND NOT oh.is_closed
    AND oh.weekday = EXTRACT(ISODOW FROM p_date)::int - 1;   -- ISODOW 1..7 → 0..6, 0 = Пн
END $$;
```

`(дата + время) AT TIME ZONE 'Europe/Berlin'` — правильный способ превратить локальное
настенное время в `timestamptz`: летнее время учитывается автоматически.

#### `060_is_open_between.sql`

```sql
-- Полностью ли интервал [p_from, p_to) лежит внутри одного окна работы.
-- Проверяются окна, начинающиеся вчера и сегодня: 00:30 принадлежит вчерашнему окну 18:00–02:00.
CREATE OR REPLACE FUNCTION is_open_between(p_restaurant uuid, p_from timestamptz, p_to timestamptz)
RETURNS bool LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tz text; v_day date;
BEGIN
  SELECT r.timezone INTO v_tz FROM restaurants r WHERE r.id = p_restaurant;
  IF v_tz IS NULL THEN RETURN false; END IF;
  v_day := (p_from AT TIME ZONE v_tz)::date;
  RETURN EXISTS (
    SELECT 1
    FROM (SELECT w.win FROM opening_windows(p_restaurant, v_day - 1) w
          UNION ALL
          SELECT w.win FROM opening_windows(p_restaurant, v_day) w) AS windows
    WHERE windows.win @> tstzrange(p_from, p_to)
  );
END $$;
```

#### `070_pickup_slot_is_free.sql`

```sql
-- Слот самовывоза пригоден, если он выровнен по 15-минутной сетке,
-- целиком внутри окна работы и в нём осталась вместимость.
CREATE OR REPLACE FUNCTION pickup_slot_is_free(p_restaurant uuid, p_slot timestamptz)
RETURNS bool LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_capacity int; v_used int;
BEGIN
  IF p_slot IS NULL OR (extract(epoch FROM p_slot)::bigint % 900) <> 0 THEN RETURN false; END IF;
  SELECT r.pickup_slot_capacity INTO v_capacity FROM restaurants r
   WHERE r.id = p_restaurant AND r.is_active;
  IF v_capacity IS NULL THEN RETURN false; END IF;
  IF NOT is_open_between(p_restaurant, p_slot, p_slot + interval '15 minutes') THEN RETURN false; END IF;
  SELECT count(*) INTO v_used FROM pickup_orders po
   WHERE po.restaurant_id = p_restaurant
     AND po.status IN ('new','confirmed','preparing','ready')
     AND po.ready_at >= p_slot AND po.ready_at < p_slot + interval '15 minutes';
  RETURN v_used < v_capacity;
END $$;
```

#### `075_pickup_items_expand.sql`

```sql
-- Разбор корзины из jsonb: [{"menu_item_id":"…","quantity":2,"note":"ohne Zwiebeln"}]
CREATE OR REPLACE FUNCTION pickup_items_expand(p_items jsonb)
RETURNS TABLE (line_menu_item_id uuid, line_quantity int, line_note text)
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT (elem->>'menu_item_id')::uuid,
         coalesce((elem->>'quantity')::int, 1),
         nullif(btrim(coalesce(elem->>'note', '')), '')
  FROM jsonb_array_elements(p_items) AS elem;
$$;
```

#### `100_find_available_slots.sql`

```sql
CREATE OR REPLACE FUNCTION find_available_slots(
  p_restaurant     uuid,
  p_date           date,
  p_party_size     int,
  p_preferred_time time DEFAULT NULL,
  p_limit          int  DEFAULT 10
) RETURNS TABLE (slot_time timestamptz, slot_table_id uuid, slot_table_label text, slot_seats int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r restaurants%ROWTYPE;
BEGIN
  SELECT * INTO r FROM restaurants WHERE id = p_restaurant AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'restaurant_not_found' USING ERRCODE = '45000'; END IF;
  -- слишком большая компания — не ошибка поиска, просто нет слотов
  IF p_party_size < 1 OR p_party_size > r.max_party_size THEN RETURN; END IF;

  RETURN QUERY
  WITH raw_slots AS (
    SELECT DISTINCT gs AS s_time
    FROM opening_windows(p_restaurant, p_date) w,
         LATERAL generate_series(lower(w.win),
                                 upper(w.win) - make_interval(mins => r.slot_minutes),
                                 make_interval(mins => r.booking_step_minutes)) AS gs
  ),
  candidates AS (
    SELECT rs.s_time, t.id AS t_id, t.label AS t_label, t.seats AS t_seats,
           row_number() OVER (PARTITION BY rs.s_time ORDER BY t.seats, t.label) AS rn
    FROM raw_slots rs
    JOIN restaurant_tables t
      ON t.restaurant_id = p_restaurant AND t.is_active AND t.seats >= p_party_size
    WHERE rs.s_time > now()
      AND NOT EXISTS (
        SELECT 1 FROM reservations res
        WHERE res.table_id = t.id
          AND res.status IN ('confirmed','seated')
          AND tstzrange(res.starts_at - make_interval(mins => r.buffer_minutes),
                        res.ends_at   + make_interval(mins => r.buffer_minutes))
              && tstzrange(rs.s_time, rs.s_time + make_interval(mins => r.slot_minutes))
      )
  )
  SELECT c.s_time, c.t_id, c.t_label, c.t_seats
  FROM candidates c
  WHERE c.rn = 1                       -- на каждое время — самый маленький подходящий столик
  ORDER BY CASE WHEN p_preferred_time IS NULL THEN 0
                ELSE abs(extract(epoch FROM
                     (c.s_time - ((p_date + p_preferred_time) AT TIME ZONE r.timezone))))
           END,
           c.s_time
  LIMIT greatest(coalesce(p_limit, 10), 1);
END $$;
```

Порядок «сначала ближайшее к желаемому времени» — это ровно сценарий B из §1.2:
агент берёт первые три строки как альтернативы.

#### `110_create_reservation_atomic.sql` — центральная функция итерации

```sql
CREATE OR REPLACE FUNCTION create_reservation_atomic(
  p_restaurant  uuid,
  p_starts_at   timestamptz,
  p_party_size  int,
  p_guest_name  text,
  p_guest_phone text,
  p_language    char(2),
  p_source      text DEFAULT 'phone'
) RETURNS TABLE (reservation_id uuid, assigned_table_id uuid, assigned_table_label text,
                 confirmed_starts_at timestamptz, confirmed_ends_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r      restaurants%ROWTYPE;
  v_ends timestamptz;
  cand   record;
  v_id   uuid;
BEGIN
  SELECT * INTO r FROM restaurants WHERE id = p_restaurant AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'restaurant_not_found' USING ERRCODE = '45000'; END IF;
  IF p_party_size < 1 OR p_party_size > r.max_party_size THEN
    RAISE EXCEPTION 'party_too_large' USING ERRCODE = '45005';
  END IF;
  IF p_starts_at <= now() THEN
    RAISE EXCEPTION 'slot_in_past' USING ERRCODE = '45006';
  END IF;

  v_ends := p_starts_at + make_interval(mins => r.slot_minutes);

  IF NOT is_open_between(p_restaurant, p_starts_at, v_ends) THEN
    RAISE EXCEPTION 'closed_at_requested_time' USING ERRCODE = '45004';
  END IF;

  -- Столики перебираются в одном и том же порядке во всех транзакциях: сначала
  -- самый маленький подходящий. Благодаря этому конкуренты сходятся на одной строке
  -- и выстраиваются в очередь на FOR UPDATE, а не расходятся по разным кандидатам.
  FOR cand IN
    SELECT t.id, t.label, t.seats
    FROM restaurant_tables t
    WHERE t.restaurant_id = p_restaurant AND t.is_active AND t.seats >= p_party_size
    ORDER BY t.seats, t.label
  LOOP
    -- Блокировка строки столика. Вторая транзакция ждёт здесь до COMMIT первой,
    -- после чего следующий SELECT увидит уже вставленную бронь (READ COMMITTED).
    PERFORM 1 FROM restaurant_tables WHERE id = cand.id FOR UPDATE;

    IF NOT EXISTS (
      SELECT 1 FROM reservations res
      WHERE res.table_id = cand.id
        AND res.status IN ('confirmed','seated')
        AND tstzrange(res.starts_at - make_interval(mins => r.buffer_minutes),
                      res.ends_at   + make_interval(mins => r.buffer_minutes))
            && tstzrange(p_starts_at, v_ends)
    ) THEN
      INSERT INTO reservations (restaurant_id, table_id, guest_name, guest_phone, party_size,
                                starts_at, ends_at, status, source, language)
      VALUES (p_restaurant, cand.id, p_guest_name, p_guest_phone, p_party_size,
              p_starts_at, v_ends, 'confirmed', p_source, p_language)
      RETURNING id INTO v_id;

      reservation_id       := v_id;
      assigned_table_id    := cand.id;
      assigned_table_label := cand.label;
      confirmed_starts_at  := p_starts_at;
      confirmed_ends_at    := v_ends;
      RETURN NEXT;
      RETURN;
    END IF;
  END LOOP;

  RAISE EXCEPTION 'no_table_available' USING ERRCODE = '45001';
END $$;
```

**Почему это корректно.** Функции работают на уровне изоляции по умолчанию —
`READ COMMITTED`. В нём каждый оператор берёт свежий снимок, поэтому транзакция,
дождавшаяся `FOR UPDATE`, в следующем же `SELECT` видит бронь, вставленную конкурентом,
и переходит к следующему столику. Требование «не полагаться на `SERIALIZABLE`» существенно:
n8n и портал ходят обычными соединениями без настройки изоляции.

#### `120_cancel_reservation_by_phone.sql`

```sql
CREATE OR REPLACE FUNCTION cancel_reservation_by_phone(
  p_restaurant uuid, p_phone text, p_date date
) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tz text; v_count int;
BEGIN
  SELECT r.timezone INTO v_tz FROM restaurants r WHERE r.id = p_restaurant AND r.is_active;
  IF v_tz IS NULL THEN RAISE EXCEPTION 'restaurant_not_found' USING ERRCODE = '45000'; END IF;
  IF app_normalize_phone(p_phone) IS NULL THEN
    RAISE EXCEPTION 'phone_required' USING ERRCODE = '45012';
  END IF;

  UPDATE reservations res
     SET status = 'cancelled'
   WHERE res.restaurant_id = p_restaurant
     AND res.status = 'confirmed'
     AND app_normalize_phone(res.guest_phone) = app_normalize_phone(p_phone)
     AND (res.starts_at AT TIME ZONE v_tz)::date = p_date;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
```

#### `200_find_menu_items.sql`

```sql
CREATE OR REPLACE FUNCTION find_menu_items(
  p_restaurant        uuid,
  p_query             text    DEFAULT NULL,
  p_lang              char(2) DEFAULT 'de',
  p_vegan_only        bool    DEFAULT false,
  p_vegetarian_only   bool    DEFAULT false,
  p_exclude_allergens text[]  DEFAULT NULL,
  p_limit             int     DEFAULT 10
) RETURNS TABLE (item_id uuid, item_name text, item_description text, item_price_cents int,
                 item_allergens text[], item_is_vegetarian bool, item_is_vegan bool,
                 item_prep_minutes int, category_name text, match_score real)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_q text := app_normalize_text(nullif(btrim(coalesce(p_query, '')), ''));
BEGIN
  RETURN QUERY
  SELECT mi.id,
         CASE p_lang WHEN 'ru' THEN mi.name_ru WHEN 'en' THEN mi.name_en ELSE mi.name_de END,
         CASE p_lang WHEN 'ru' THEN mi.description_ru WHEN 'en' THEN mi.description_en
                     ELSE mi.description_de END,
         mi.price_cents, mi.allergens, mi.is_vegetarian, mi.is_vegan, mi.prep_minutes,
         CASE p_lang WHEN 'ru' THEN mc.name_ru WHEN 'en' THEN mc.name_en ELSE mc.name_de END,
         coalesce(m.score, 1.0::real)
  FROM menu_items mi
  JOIN menu_categories mc ON mc.id = mi.category_id
  LEFT JOIN LATERAL (
    -- лучшее совпадение среди трёх названий и всех алиасов:
    -- подстрока даёт 1.0, иначе триграммная близость
    SELECT max(GREATEST(
             CASE WHEN app_normalize_text(cand) LIKE '%' || v_q || '%' THEN 1.0 ELSE 0.0 END,
             similarity(app_normalize_text(cand), v_q)))::real AS score
    FROM unnest(ARRAY[mi.name_de, mi.name_ru, mi.name_en] || mi.aliases) AS cand
  ) m ON v_q IS NOT NULL
  WHERE mc.restaurant_id = p_restaurant
    AND mi.is_available                                    -- §13: агент не выдумывает блюда
    AND (NOT p_vegan_only      OR mi.is_vegan)
    AND (NOT p_vegetarian_only OR mi.is_vegetarian)
    AND (p_exclude_allergens IS NULL OR NOT (mi.allergens && p_exclude_allergens))
    AND (v_q IS NULL OR m.score >= 0.3)
  ORDER BY coalesce(m.score, 0) DESC, mc.sort_order,
           CASE p_lang WHEN 'ru' THEN mi.name_ru WHEN 'en' THEN mi.name_en ELSE mi.name_de END
  LIMIT greatest(coalesce(p_limit, 10), 1);
END $$;
```

Пустой `p_query` — легальный вызов «что у вас есть?»: фильтры продолжают работать,
сортировка идёт по категориям.

#### `300_find_pickup_slots.sql`

```sql
CREATE OR REPLACE FUNCTION find_pickup_slots(
  p_restaurant   uuid,
  p_earliest     timestamptz DEFAULT NULL,
  p_prep_minutes int         DEFAULT 0,
  p_limit        int         DEFAULT 6
) RETURNS TABLE (slot_time timestamptz, free_capacity int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r restaurants%ROWTYPE; v_from timestamptz; v_day date;
BEGIN
  SELECT * INTO r FROM restaurants WHERE id = p_restaurant AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'restaurant_not_found' USING ERRCODE = '45000'; END IF;

  -- §6.1: время готовности считает база — из pickup_lead_minutes ресторана
  -- и максимального prep_minutes в заказе
  v_from := GREATEST(coalesce(p_earliest, now()), now())
            + make_interval(mins => GREATEST(r.pickup_lead_minutes, coalesce(p_prep_minutes, 0)));
  v_from := to_timestamp(ceil(extract(epoch FROM v_from) / 900.0) * 900);  -- вверх до 15 минут
  v_day  := (v_from AT TIME ZONE r.timezone)::date;

  RETURN QUERY
  WITH wins AS (
    SELECT w.win
    FROM generate_series(v_day - 1, v_day + 2, interval '1 day') AS d(day)
    CROSS JOIN LATERAL opening_windows(p_restaurant, d.day::date) w
  ),
  grid AS (
    SELECT DISTINCT gs AS g_time
    FROM wins,
         LATERAL generate_series(
           to_timestamp(ceil(extract(epoch FROM GREATEST(lower(wins.win), v_from)) / 900.0) * 900),
           upper(wins.win) - interval '15 minutes',
           interval '15 minutes') AS gs
  )
  SELECT g.g_time,
         (r.pickup_slot_capacity - count(po.id))::int
  FROM grid g
  LEFT JOIN pickup_orders po
    ON po.restaurant_id = p_restaurant
   AND po.status IN ('new','confirmed','preparing','ready')
   AND po.ready_at >= g.g_time
   AND po.ready_at <  g.g_time + interval '15 minutes'
  WHERE g.g_time >= v_from
  GROUP BY g.g_time
  HAVING count(po.id) < r.pickup_slot_capacity
  ORDER BY g.g_time
  LIMIT greatest(coalesce(p_limit, 6), 1);
END $$;
```

#### `310_create_pickup_order_atomic.sql`

```sql
CREATE OR REPLACE FUNCTION create_pickup_order_atomic(
  p_restaurant  uuid,
  p_items       jsonb,
  p_ready_at    timestamptz,
  p_guest_name  text,
  p_guest_phone text,
  p_language    char(2),
  p_source      text DEFAULT 'phone'
) RETURNS TABLE (pickup_order_id uuid, assigned_order_number text,
                 order_total_cents int, confirmed_ready_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r         restaurants%ROWTYPE;
  v_missing int;
  v_bad_qty int;
  v_prep    int;
  v_total   int;
  v_ready   timestamptz;
  v_num     text;
  v_id      uuid;
  v_attempt int := 0;
BEGIN
  -- Сериализация по ресторану: слот самовывоза не имеет собственной строки, которую
  -- можно заблокировать, поэтому очередь выстраивается на строке ресторана.
  -- При ожидаемом объёме (единицы заказов в минуту) конкуренция незаметна.
  SELECT * INTO r FROM restaurants WHERE id = p_restaurant AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'restaurant_not_found' USING ERRCODE = '45000'; END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'empty_order' USING ERRCODE = '45007';
  END IF;

  SELECT count(*) FILTER (WHERE i.line_quantity IS NULL
                             OR i.line_quantity < 1 OR i.line_quantity > 50)
    INTO v_bad_qty
  FROM pickup_items_expand(p_items) i;
  IF v_bad_qty > 0 THEN RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = '45008'; END IF;

  -- Позиции обязаны существовать, быть доступными и принадлежать этому ресторану
  SELECT count(*) FILTER (WHERE mi.id IS NULL),
         max(mi.prep_minutes),
         sum(mi.price_cents * i.line_quantity)::int
    INTO v_missing, v_prep, v_total
  FROM pickup_items_expand(p_items) i
  LEFT JOIN menu_items mi
    ON mi.id = i.line_menu_item_id
   AND mi.is_available
   AND mi.category_id IN (SELECT mc.id FROM menu_categories mc WHERE mc.restaurant_id = p_restaurant);
  IF v_missing > 0 THEN RAISE EXCEPTION 'item_unavailable' USING ERRCODE = '45003'; END IF;

  IF p_ready_at IS NULL THEN
    SELECT s.slot_time INTO v_ready
    FROM find_pickup_slots(p_restaurant, NULL, coalesce(v_prep, 0), 1) s;
    IF v_ready IS NULL THEN RAISE EXCEPTION 'no_pickup_slot' USING ERRCODE = '45009'; END IF;
  ELSE
    v_ready := p_ready_at;
    IF v_ready < now() + make_interval(mins => GREATEST(r.pickup_lead_minutes, coalesce(v_prep, 0))) THEN
      RAISE EXCEPTION 'pickup_too_early' USING ERRCODE = '45010';
    END IF;
    IF NOT pickup_slot_is_free(p_restaurant, v_ready) THEN
      RAISE EXCEPTION 'slot_full' USING ERRCODE = '45002';
    END IF;
  END IF;

  -- §6.1: короткий номер, который агент диктует голосом. Уникален среди активных заказов.
  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > 50 THEN RAISE EXCEPTION 'order_number_exhausted' USING ERRCODE = '45011'; END IF;
    v_num := lpad((1000 + floor(random() * 9000))::int::text, 4, '0');
    BEGIN
      INSERT INTO pickup_orders (restaurant_id, order_number, guest_name, guest_phone,
                                 ready_at, total_cents, status, source, language)
      VALUES (p_restaurant, v_num, p_guest_name, p_guest_phone,
              v_ready, v_total, 'new', p_source, p_language)
      RETURNING id INTO v_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      NULL;  -- номер занят активным заказом, пробуем следующий
    END;
  END LOOP;

  INSERT INTO pickup_order_items (order_id, menu_item_id, quantity, unit_price_cents, note)
  SELECT v_id, i.line_menu_item_id, i.line_quantity, mi.price_cents, i.line_note
  FROM pickup_items_expand(p_items) i
  JOIN menu_items mi ON mi.id = i.line_menu_item_id;

  pickup_order_id       := v_id;
  assigned_order_number := v_num;
  order_total_cents     := v_total;
  confirmed_ready_at    := v_ready;
  RETURN NEXT;
END $$;
```

#### `400_create_callback_request.sql`

```sql
CREATE OR REPLACE FUNCTION create_callback_request(
  p_restaurant uuid, p_phone text, p_language char(2), p_summary text, p_category text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM restaurants WHERE id = p_restaurant AND is_active) THEN
    RAISE EXCEPTION 'restaurant_not_found' USING ERRCODE = '45000';
  END IF;
  IF p_category IS NULL OR p_category NOT IN ('banquet','complaint','special','other') THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE = '45013';
  END IF;
  IF length(coalesce(p_summary, '')) > 400 THEN            -- §6.2
    RAISE EXCEPTION 'summary_too_long' USING ERRCODE = '45014';
  END IF;

  INSERT INTO callback_requests (restaurant_id, caller_phone, language, summary, category)
  VALUES (p_restaurant, p_phone, p_language, btrim(p_summary), p_category)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
```

#### `900_purge_expired_personal_data.sql`

```sql
-- §11.4. Вызывается ночным заданием (расписание — итерация 15).
-- pickup_order_items уходят каскадом, call_logs переживают удаление (ON DELETE SET NULL).
CREATE OR REPLACE FUNCTION purge_expired_personal_data()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_total int := 0; v_n int;
BEGIN
  DELETE FROM reservations      WHERE delete_after IS NOT NULL AND delete_after < current_date;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
  DELETE FROM pickup_orders     WHERE delete_after IS NOT NULL AND delete_after < current_date;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
  DELETE FROM callback_requests WHERE delete_after IS NOT NULL AND delete_after < current_date;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
  RETURN v_total;
END $$;
```

### 3.5 Роли и права (`db/roles.sql`)

Файл идемпотентен и применяется **после** функций на каждом прогоне `db:migrate`.
Пароли ролей здесь не задаются — их выставляет раннер отдельным `ALTER ROLE`
из переменных окружения (см. 3.6).

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'n8n_app')    THEN CREATE ROLE n8n_app    LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN CREATE ROLE portal_app LOGIN; END IF;
END $$;

DO $$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO n8n_app, portal_app', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO n8n_app, portal_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- §3.5: у агента через n8n нет и не может быть доступа к таблицам
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM n8n_app;

-- §5.3: портал редактирует справочники и операционные сущности, но не удаляет строки —
-- удаление персональных данных идёт только через purge_expired_personal_data()
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO portal_app;
REVOKE ALL ON TABLE schema_migrations FROM portal_app;

-- Новые таблицы и функции получают те же правила автоматически
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO portal_app;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Postgres по умолчанию выдаёт EXECUTE новой функции роли PUBLIC — снимаем поимённо
REVOKE ALL ON FUNCTION app_normalize_text(text)                          FROM PUBLIC;
REVOKE ALL ON FUNCTION app_normalize_phone(text)                         FROM PUBLIC;
REVOKE ALL ON FUNCTION opening_windows(uuid, date)                       FROM PUBLIC;
REVOKE ALL ON FUNCTION is_open_between(uuid, timestamptz, timestamptz)   FROM PUBLIC;
REVOKE ALL ON FUNCTION pickup_slot_is_free(uuid, timestamptz)            FROM PUBLIC;
REVOKE ALL ON FUNCTION pickup_items_expand(jsonb)                        FROM PUBLIC;
REVOKE ALL ON FUNCTION purge_expired_personal_data()                     FROM PUBLIC;
-- … и для восьми функций §5.2 (полные сигнатуры), после чего:

GRANT EXECUTE ON FUNCTION find_available_slots(uuid, date, int, time, int)                TO n8n_app, portal_app;
GRANT EXECUTE ON FUNCTION create_reservation_atomic(uuid, timestamptz, int, text, text, char, text) TO n8n_app, portal_app;
GRANT EXECUTE ON FUNCTION cancel_reservation_by_phone(uuid, text, date)                   TO n8n_app, portal_app;
GRANT EXECUTE ON FUNCTION find_menu_items(uuid, text, char, bool, bool, text[], int)      TO n8n_app, portal_app;
GRANT EXECUTE ON FUNCTION find_pickup_slots(uuid, timestamptz, int, int)                  TO n8n_app, portal_app;
GRANT EXECUTE ON FUNCTION create_pickup_order_atomic(uuid, jsonb, timestamptz, text, text, char, text) TO n8n_app, portal_app;
GRANT EXECUTE ON FUNCTION create_callback_request(uuid, text, char, text, text)           TO n8n_app;
```

`purge_expired_personal_data()` не выдаётся никому: её вызывает ночное задание
под `app_owner`. Вспомогательные функции тоже никому не выдаются — они вызываются
изнутри `SECURITY DEFINER`-функций, то есть от имени владельца.

**Правило, которое нужно помнить:** добавил функцию в `db/functions/` — добавь строки
`REVOKE`/`GRANT` в `roles.sql`. Codex записывает это правило в `db/README.md`.

### 3.6 Раннер миграций (`scripts/db/`)

`lib/config.ts`

```ts
export type DbTarget = { url: string; database: string };

/** Читает URL из аргумента --url, иначе из DATABASE_URL. Без загрузки .env. */
export function resolveTarget(argv: string[]): DbTarget;

/** Бросает, если хост не localhost/127.0.0.1/::1. Используется reset и тестами. */
export function assertLocalDatabase(url: string): void;

/** Пароли ролей из окружения; undefined — шаг ALTER ROLE пропускается с предупреждением. */
export function rolePasswords(): { n8nApp?: string; portalApp?: string };
```

`lib/apply.ts`

```ts
export async function ensureMigrationsTable(sql: Sql): Promise<void>;
export async function appliedVersions(sql: Sql): Promise<Map<string, string>>;   // version → checksum
export async function applyMigrations(sql: Sql, dir: string, opts?: { dryRun?: boolean }): Promise<string[]>;
export async function rollbackLast(sql: Sql, dir: string): Promise<string | null>;
export async function applyFunctions(sql: Sql, dir: string): Promise<number>;
export async function applyRoles(sql: Sql, file: string): Promise<void>;
export async function setRolePasswords(sql: Sql, pw: { n8nApp?: string; portalApp?: string }): Promise<void>;
export function splitMigration(text: string): { up: string; down: string };
```

Служебная таблица создаётся самим раннером (миграцией она быть не может — это
её собственный реестр):

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    text PRIMARY KEY,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
```

Порядок работы `pnpm db:migrate`:

1. `SELECT pg_advisory_lock(4711001)` — два одновременных раннера невозможны.
2. `ensureMigrationsTable`.
3. Для каждой применённой миграции сверить sha256 файла с сохранённым. Расхождение —
   ошибка с текстом: «миграция NNN изменена после применения; создай новую миграцию
   или пересоздай локальную базу через `pnpm db:reset`».
4. Применить недостающие миграции в порядке номеров, каждую — в своей транзакции,
   вместе с записью в `schema_migrations`.
5. Применить все `db/functions/*.sql` в лексикографическом порядке, **одной транзакцией**.
6. Применить `db/roles.sql`, затем `ALTER ROLE … PASSWORD`, если пароли заданы.
7. `pg_advisory_unlock`, вывести список применённого.

Технические детали, чтобы не гадать:

- многооператорные файлы выполняются через `sql.unsafe(text).simple()` — расширенный
  протокол postgres.js не допускает несколько операторов в одном запросе; разбивать
  файл по `;` нельзя, это ломает тела функций в `$$`;
- если связка `sql.begin()` + `.simple()` в установленной версии postgres.js не работает,
  допустимая замена — включить `BEGIN;` и `COMMIT;` в саму строку простого запроса,
  а запись в `schema_migrations` выполнить внутри той же строки; отклонение фиксируется
  в `report.md`;
- `ALTER ROLE … PASSWORD` не принимает параметры. Пароль берётся из окружения и
  **валидируется регуляркой `^[A-Za-z0-9_-]{16,128}$`** перед подстановкой; всё, что
  не подходит, отвергается с ошибкой. Это исключает инъекцию и одновременно требует
  нормальных паролей.

`rollback.ts` откатывает **одну** последнюю миграцию (`-- migrate:down`) и удаляет
её строку из реестра, после чего заново применяет функции и роли.

`reset.ts` — только для локальной разработки: `assertLocalDatabase`, затем
`DROP DATABASE … WITH (FORCE)` / `CREATE DATABASE` через подключение к БД `postgres`,
затем полный `migrate`. Без флага `--yes` печатает, что именно снесёт, и требует
подтверждения переменной окружения `DB_RESET_CONFIRM=1`.

### 3.7 Seed (`db/seed.sql`)

Идемпотентен: фиксированные UUID + `ON CONFLICT (id) DO UPDATE`. Фиксированные
идентификаторы нужны, чтобы ручные проверки и портал (итерация 9) всегда попадали
в один и тот же демо-ресторан.

Содержимое:

- ресторан `slug = 'demo'`, «Trattoria Sole», `Europe/Berlin`, тексты объявления об ИИ
  на трёх языках (DE/RU/EN), приветствия заполнены, `telegram_chat_id` пуст;
- часы работы: понедельник закрыт; вторник–пятница два окна 11:30–14:30 и 17:30–23:00;
  суббота и воскресенье одно окно 12:00–23:30; одно особое закрытие (24.12);
- столики: `T1`,`T2` по 2 места; `T3`,`T4`,`T5` по 4; `T6` на 6; `T7` на 8 (зоны
  `Hauptraum` / `Terrasse`);
- меню: три категории (Vorspeisen / Pizza / Getränke) по 3–5 позиций с названиями и
  описаниями на трёх языках, алиасами («маргарита», «margarita», «margarita pizza»),
  аллергенами из закрытого списка, ценами, `prep_minutes`; минимум одна веганская,
  одна вегетарианская и одна позиция с `is_available = false` — она нужна тестам и
  ручной проверке того, что агент её не предлагает;
- операционных данных (броней, заказов, звонков) в seed **нет** — их создают тесты
  и ручные проверки.

### 3.8 Инфраструктура и версии

`deploy/docker-compose.dev.yml` — наполняется сервис `postgres`:

```yaml
services:
  postgres:
    image: postgres:18.6            # точную минорную версию Codex сверяет на дату работы
    environment:
      POSTGRES_DB: restaurant
      POSTGRES_USER: app_owner
      POSTGRES_PASSWORD: app_owner  # локальная разработка, не секрет
      TZ: Europe/Berlin
    ports:
      - "5432:5432"
    volumes:
      - pgdata-dev:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app_owner -d restaurant"]
      interval: 5s
      timeout: 3s
      retries: 20
volumes:
  pgdata-dev:
```

`deploy/docker-compose.yml` — у сервиса `postgres` проставляется та же точная версия
образа; остальное не трогается (лимиты памяти §8.2.1 уже прописаны).

Зависимости корня (`pnpm add -D -w -E`), версии **проверяются Codex на дату работы**
и фиксируются точно, без диапазонов:

| Пакет | Зачем |
|---|---|
| `vitest` | тестраннер (PROJECT.md §0.4) |
| `postgres` | postgres.js — раннер и тесты; ORM не используется (§5) |
| `typescript`, `@types/node` | типы и `pnpm typecheck` |
| `@biomejs/biome` | линт и формат (§0.4) |

Скрипты — `db:up`, `db:down`, `db:migrate`, `db:rollback`, `db:seed`, `db:reset`,
`test`, `test:watch`, `typecheck`, `lint`, `format`.

TypeScript-файлы запускаются напрямую Node 24 (встроенное срезание типов):
`node scripts/db/migrate.ts`. Корневой `tsconfig.json` наследует `tsconfig.base.json`
и добавляет `"noEmit": true`, `"declaration": false`, `"allowImportingTsExtensions": true`,
`include` — `scripts/**/*.ts`, `db/tests/**/*.ts`, `vitest.config.ts`.
**Если в среде владельца прямой запуск `.ts` не заработает**, допустимо добавить `tsx`
как devDependency и переключить скрипты на него — с записью причины в
`docs/architecture.md` и в `report.md`.

`.env.example` дополняется:

```
POSTGRES_PASSWORD=app_owner             # локальная разработка; на сервере — длинный секрет
DATABASE_URL=postgres://app_owner:app_owner@localhost:5432/restaurant
N8N_APP_PASSWORD=                       # пароль роли n8n_app, [A-Za-z0-9_-]{16,}
PORTAL_APP_PASSWORD=                    # пароль роли portal_app, тот же формат
TEST_DATABASE_URL=postgres://app_owner:app_owner@127.0.0.1:5432/postgres
```

`docs/architecture.md`: Codex заполняет таблицу версий (пакет, версия, дата проверки)
и добавляет в журнал решений строки по таблице из 3.2.

## 4. Пошаговый план реализации

1. Прочитать `AGENTS.md`, эту спеку целиком и `.claude/skills/db-migrations/SKILL.md`.
2. Поднять Postgres: наполнить `deploy/docker-compose.dev.yml`, проверить
   `docker compose … up -d postgres` и `SELECT version()`; зафиксировать точную
   минорную версию образа здесь и в боевом compose.
3. Завести зависимости корня (`pnpm add -D -w -E …`), `biome.json`, `tsconfig.json`,
   `vitest.config.ts`, скрипты в `package.json`; закоммитить `pnpm-lock.yaml`.
4. Написать раннер (`scripts/db/lib/*`, `migrate.ts`) и убедиться, что на пустой базе
   он отрабатывает вхолостую.
5. Миграции 001–004; проверить `db:migrate`, затем `db:rollback` до конца и обратно.
6. Функции: хелперы → триггеры → окна работы → брони → меню → самовывоз → коллбэк →
   purge. После каждой — соответствующий тестовый файл.
7. `db/roles.sql` + `setRolePasswords`; тест прав (`permissions.test.ts`) должен
   пройти сразу — он проверяет главный инвариант §3.5.
8. `db/seed.sql` + тест идемпотентности.
9. Тесты на гонку (брони и самовывоз) — детерминированные и стрессовые варианты.
10. `db/README.md`, `README.md`, `docs/architecture.md`.
11. Прогнать `pnpm lint`, `pnpm typecheck`, `pnpm test`; написать
    `specs/001-db-schema-and-functions/manual-tests.md` и `report.md`.

## 5. Тестирование

### 5.1 Автотесты (vitest, только локальное окружение)

Внешних API в этой итерации нет вообще, поэтому и мокать нечего: тесты работают
против настоящего Postgres в локальном Docker — это и есть «локальное окружение»
по AGENTS.md §4. Ни одного сетевого вызова наружу, ни одного вызова LLM,
ни одного ключа.

**Защитные меры (обязательны):**

- тесты **не читают `.env`** — ни `dotenv`, ни `process.loadEnvFile`. Единственный
  источник — `TEST_DATABASE_URL` со значением по умолчанию
  `postgres://app_owner:app_owner@127.0.0.1:5432/postgres`;
- `global-setup.ts` в самом начале **удаляет** из `process.env` ключи
  `MISTRAL_API_KEY`, `ELEVENLABS_API_KEY`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
  `N8N_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, `SESSION_SECRET` — если владелец
  экспортировал их в оболочке, до тестов они не доберутся;
- `assertLocalDatabase` не даёт запустить тесты против нелокального хоста;
- тестовая база называется `restaurant_test` и пересоздаётся в `global-setup`
  (`DROP DATABASE … WITH (FORCE)` → `CREATE DATABASE` → миграции → функции → роли
  с паролями `n8n_app_test` / `portal_app_test`).

`vitest.config.ts`: `globalSetup: 'db/tests/global-setup.ts'`,
`include: ['db/tests/**/*.test.ts']`, `fileParallelism: false`, `testTimeout: 20000`,
`hookTimeout: 60000`. Каждый файл создаёт **свой** ресторан с уникальным slug через
`helpers/fixtures.ts` и не зависит от seed и от других файлов.

| Файл | Что проверяет |
|---|---|
| `migrate.test.ts` | миграции применяются на чистой базе; повторный прогон ничего не делает; изменение файла применённой миграции даёт понятную ошибку; `rollback` последней миграции и повторное применение; после `migrate` существуют все 8 функций §5.2 |
| `schema.test.ts` | `CHECK` на пустое `ai_disclosure_*` (§11.1); `CHECK` на неизвестный статус, категорию, аллерген; `summary` длиннее 400 отвергается; `EXCLUDE`-ограничение отвергает пересекающиеся брони при прямом `INSERT`; триггеры `delete_after` для трёх таблиц, включая пересчёт при простановке `handled_at`; каскад `pickup_order_items`; `ON DELETE SET NULL` в `call_logs` |
| `permissions.test.ts` | под `n8n_app`: `SELECT` из любой таблицы → ошибка 42501, вызов функции §5.2 → успех, вызов `purge_expired_personal_data()` → отказ; под `portal_app`: `SELECT/INSERT/UPDATE` работают, `DELETE` отклоняется. **Это машинная проверка §3.5** |
| `find-available-slots.test.ts` | закрытый день и особое закрытие → пусто; выбирается наименьший подходящий столик; буфер между бронями соблюдён; прошедшее время не выдаётся; сортировка по близости к `preferred_time`; окно через полночь; компания больше `max_party_size` → пусто; два окна в один день (обед и ужин); даты по обе стороны перехода на зимнее время 25.10.2026 дают ожидаемое локальное время |
| `create-reservation.test.ts` | успешная бронь возвращает метку столика и время; занятое время → `no_table_available` (45001); вне часов работы → `closed_at_requested_time`; прошлое → `slot_in_past`; компания больше лимита → `party_too_large`; `delete_after` = дата визита + 30. **Гонка (обязательно):** (а) детерминированный тест — транзакция A вызывает функцию и не коммитит, транзакция B на тот же единственный столик виснет на блокировке; после коммита A транзакция B получает `no_table_available`; (б) 10 параллельных вызовов на ресторан с одним подходящим столиком → ровно один успех, в базе ровно одна бронь |
| `cancel-reservation.test.ts` | отмена по `+49…` находит бронь, записанную как `0049…`; чужая дата и чужой ресторан не затрагиваются; возвращается число отменённых; повторный вызов возвращает 0; телефон без цифр → `phone_required` |
| `find-menu-items.test.ts` | недоступные позиции не возвращаются никогда; поиск по алиасу; нечёткое совпадение с опечаткой и с другим регистром; умляуты и кириллица; `vegan_only` (сценарий D §1.2); исключение аллергена; выбор языка названия и описания; пустой запрос возвращает всё меню по категориям |
| `pickup.test.ts` | `find_pickup_slots`: лид-тайм и `prep_minutes` учтены, сетка 15 минут, слоты только внутри часов работы, заполненный слот исчезает; `create_pickup_order_atomic`: сумма считается базой, номер из 4 цифр, позиции записаны с ценой на момент заказа, недоступная позиция → `item_unavailable`, слишком раннее время → `pickup_too_early`, пустая корзина → `empty_order`, `delete_after` = дата выдачи + 30. **Гонка (обязательно):** `pickup_slot_capacity = 1`, два параллельных заказа на один слот → один успех, второй `slot_full` (45002) |
| `callback-and-purge.test.ts` | резюме > 400 → `summary_too_long`; неизвестная категория → `invalid_category`; `delete_after` пересчитывается при обработке; `purge_expired_personal_data()` удаляет только просроченное, возвращает верное число, каскадом уносит позиции заказов и обнуляет ссылки в `call_logs` |
| `seed.test.ts` | `seed.sql` применяется, повторный прогон не создаёт дублей и не падает; демо-ресторан находится по slug; в меню есть позиции на трёх языках и хотя бы одна недоступная |

Тест на гонку в варианте (а) — принципиальный: он доказывает наличие блокировки,
а не «повезло с таймингом». Реализация: два независимых соединения postgres.js,
`BEGIN` на обоих, вызов функции в A, вызов в B с ожиданием, проверка через
`pg_stat_activity` или по факту неразрешённого промиса за ~500 мс, затем `COMMIT` в A.

### 5.2 Ручное тестирование (выполняет человек)

Автотесты покрывают логику полностью; человеку остаётся то, что зависит от его машины,
и то, что по природе разрушительно.

1. **Docker и версия образа.** Поднять `pnpm db:up`, убедиться, что контейнер здоров,
   и что `SELECT version()` возвращает ту же минорную версию, что записана в
   `docs/architecture.md`. Автотест этого не проверяет: он работает с той базой,
   которая уже поднята.
2. **Полный откат.** Прогнать `pnpm db:rollback` четыре раза до пустой схемы и
   `pnpm db:migrate` обратно. Это уничтожает данные, поэтому шаг ручной и
   выполняется осознанно (требование обратимости из навыка `db-migrations`).
3. **Бэкап и восстановление.** Навык `deployment` требует после любого изменения схемы
   проверить, что бэкап снимается и реально восстанавливается: `pg_dump` локальной базы
   → восстановление в чистую базу → `pnpm test` против неё. Скрипта `backup.sh` ещё нет
   (итерация 12), поэтому шаг ручной.
4. **Глазами по seed.** Открыть демо-ресторан в psql или GUI: кириллица и умляуты
   отображаются корректно, цены и аллергены на месте, недоступная позиция помечена.
   Кодировку и читаемость человек оценивает лучше теста.
5. **Пароли ролей.** Задать `N8N_APP_PASSWORD` и `PORTAL_APP_PASSWORD` в `.env`,
   прогнать `pnpm db:migrate`, подключиться `psql` под `n8n_app` с этим паролем и
   убедиться, что `SELECT * FROM reservations;` отвергается, а вызов
   `find_menu_items(...)` работает. Это проверка связки «env → роль», которую тест
   выполняет на своих служебных паролях.
6. **Часовые пояса на глаз.** Создать бронь на 20:00 в дату до перехода на зимнее время
   и после (24 и 25 октября 2026) и убедиться, что обе показываются как 20:00 при
   выводе `starts_at AT TIME ZONE 'Europe/Berlin'`.

Инструкцию по этим шагам Codex оформляет в `manual-tests.md` в формате
«предусловия → шаги → ожидаемый результат → что записать».

## 6. Критерии приёмки

- [ ] `pnpm db:up && pnpm db:migrate && pnpm db:seed` на чистой машине проходит без ошибок,
      повторный `db:migrate` не делает ничего.
- [ ] Созданы все 11 таблиц из PROJECT.md §5.1 и все 8 функций из §5.2 с сигнатурами
      из раздела 3.4 этой спеки.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — зелёные; в тестах нет ни одного
      сетевого вызова наружу, ни одного API-ключа, ни одного вызова LLM (AGENTS.md §4).
- [ ] **§13:** двойное бронирование одного слота невозможно — доказано параллельным тестом.
- [ ] **§13:** перепродажа слота самовывоза невозможна — доказано параллельным тестом.
- [ ] **§13:** `purge_expired_personal_data()` отрабатывает и реально удаляет.
- [ ] **§13 (частично):** часовые пояса корректны на уровне базы, включая переход
      на зимнее время; полная проверка — в разговоре, итерация 6.
- [ ] **§13 (частично):** ресторан невозможно создать без объявления об ИИ — `CHECK`
      на уровне базы (§11.1).
- [ ] **§3.5:** роль `n8n_app` не может прочитать ни одной таблицы, но выполняет
      функции §5.2 — доказано тестом.
- [ ] `delete_after` заполняется триггером во всех трёх таблицах с персональными данными;
      в `call_logs` нет аудио, транскрипта и персональных данных.
- [ ] Точные версии зависимостей и образа Postgres зафиксированы; `pnpm-lock.yaml`
      закоммичен; таблица версий в `docs/architecture.md` заполнена с датой проверки.
- [ ] `manual-tests.md` выполним человеком без чтения кода; `report.md` содержит
      отклонения (если были) и результаты прогона тестов.

## 7. Риски и открытые вопросы

**Риски**

1. **`sql.unsafe(...).simple()` внутри `sql.begin()`.** Поведение зависит от версии
   postgres.js. Смягчение — прописанный в 3.6 запасной вариант с `BEGIN/COMMIT`
   внутри строки запроса. Проверяется первым же тестом `migrate.test.ts`.
2. **Прямой запуск `.ts` через Node 24.** Срезание типов не поддерживает enum и
   namespace — в этом коде их нет. Если запуск всё же не заработает, разрешён `tsx`
   (см. 3.8).
3. **Перевод часов и `generate_series` по timestamptz.** Шаг интервала прибавляется
   в абсолютном времени, поэтому окно, пересекающее 02:00–03:00 в ночь перевода,
   даст сетку, сдвинутую на час относительно настенного времени. Для ресторанных
   часов работы это практически недостижимо. Ограничение фиксируется в `db/README.md`;
   тест проверяет, что функция при этом не падает.
4. **Неоднозначное локальное время.** `(дата + время) AT TIME ZONE` для несуществующего
   (весна) или дважды существующего (осень) часа даёт значение по правилам Postgres,
   а не по здравому смыслу. Затрагивает только рестораны, работающие в 02:00–03:00
   ночи перевода. Документируется, не исправляется.
5. **Порог нечёткого поиска 0.3.** Подобран без реальных данных распознавания.
   Настраивается по результатам итерации 6; вынесен в одну константу в
   `200_find_menu_items.sql`, чтобы менять в одном месте.
6. **Блокировка строки ресторана в `create_pickup_order_atomic`** сериализует все
   заказы одного ресторана и кратковременно блокирует правку настроек из портала.
   При ожидаемом объёме это незаметно; если станет узким местом, замена —
   `pg_advisory_xact_lock` по паре (ресторан, слот).

**Открытые вопросы (не блокируют реализацию)**

1. Объединение столиков (`combinable`) для компаний больше самого большого столика.
   Сейчас такая бронь получает `no_table_available`, и агент предложит обратный звонок.
   Решение — после первых реальных разговоров.
2. Национальный формат телефона (`030 123456`) не нормализуется без кода страны.
   Для звонков это не проблема (SIP даёт E.164), но ручное создание брони в портале
   (итерация 9) должно требовать E.164 — заложить в валидацию формы.
3. Хранение исторического названия блюда в позиции заказа. Сейчас хранится только цена
   на момент заказа; переименование блюда задним числом изменит вид старого заказа
   в портале. Дёшево добавить `name_snapshot` в итерации 7, если это будет мешать.
4. Ретенция `call_logs`. Персональных данных там нет, поэтому автоудаления нет.
   Если таблица начнёт расти, добавить прунинг в итерации 15.

## 8. Следующие шаги

Порядок итераций в PROJECT.md §12 менять не нужно, но итерацию 3 стоит разбить на две
спецификации — она содержит блокирующую проверку, результат которой меняет план:

- **Спека 002 — проверка стриминга Voxtral Realtime** в `@livekit/agents-plugin-mistralai`
  (PROJECT.md §2.3, «ПЕРВЫМ ДЕЛОМ» в §12). Это исследовательская задача: установить плагин,
  выяснить, поддерживается ли WebSocket-стриминг или только батчевая транскрипция,
  зафиксировать ответ, дату и версию плагина в `docs/architecture.md`. Результат
  определяет содержание следующей спеки: работаем как задумано, пишем тонкий кастомный
  STT-плагин или временно берём Deepgram. Планировать прототип агента до этого ответа
  бессмысленно.
- **Спека 003 — прототип агента на немецком** без инструментов, разговор в LiveKit
  Playground, замер RAM на сессию через `docker stats` (PROJECT.md §8.1 требует заменить
  оценочные цифры измеренными).

Дальше по §12: итерация 4 (мультиязычность и TTS-роутер), затем 5 (n8n и HMAC) — и
именно там пригодится таблица SQLSTATE из раздела 3.4: workflow отображает коды `45xxx`
на enum-коды ошибок инструментов в `docs/tool-contracts.md`.
