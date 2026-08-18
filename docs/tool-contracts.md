# Контракты инструментов агента

Источник истины по входам и выходам инструментов. Каждый контракт дублируется zod-схемой
в `packages/contracts/src/tools.ts`; агент валидирует результат прямого Postgres RPC до
передачи в LLM. Совместимые n8n-входы сохраняются для будущих чатов и формуляров, но
голосовой агент их не вызывает. Порядок изменения — навык
`.claude/skills/agent-tools/SKILL.md`: контракт → zod-схема → Postgres RPC → регистрация.

Общие требования ко всем контрактам:

- ответ — строго типизированная JSON-структура, никакого свободного текста;
- `restaurant_id` прямого агента берётся из валидированного конфига, а не от LLM;
- n8n-вход дополнительно несёт `session_id` и подписывается `X-Signature`;
- ошибки — перечислимые коды, а не сообщения в свободной форме.

**Почему в ответе нет текста причины отказа.** Соблазн вернуть из transport-обёртки готовое
`description` («столик занят, попробуйте другое время») велик, но свободный текст в ответе
инструмента — это то, на чём модель начинает достраивать смысл (PROJECT.md §3.4). Поэтому
обёртка отдаёт только код, а произносимую фразу агент берёт из `agent/src/i18n/<язык>.yaml`
по этому коду. Формулировка остаётся предсказуемой и меняется без правки workflow.

**Коды ошибок.** Доменные совпадают с прикладными SQLSTATE из `db/README.md`: прямой
клиент переводит SQLSTATE в `error`. `invalid_request` используется только n8n, если
чат или формуляр не прошёл валидацию:

`restaurant_not_found`, `no_table_available`, `table_not_available`, `table_already_booked`,
`closed_at_requested_time`, `party_too_large`, `slot_in_past`, `invalid_category`,
`summary_too_long`, `invalid_request`.

Транспортные коды формирует агент: `timeout`, `unreachable` (соединение с базой или иной
ошибочный SQLSTATE), `invalid_response` (результат RPC не по контракту). Отдельного поведения на
каждый из них нет: агент извиняется и предлагает оставить сообщение менеджеру.

**Статус.** `check_availability`, `create_reservation` и `search_menu` зарегистрированы в
голосовом агенте и напрямую вызывают RPC под ролью `agent_app`. Их ранее экспортированные
workflow n8n остаются для чата и формуляров. `request_callback` имеет контракт, но временно
не зарегистрирован и не имеет workflow. Остальные контракты пока не определены.

---

## `check_availability` → `find_available_tables`

**Назначение:** свободные столики на конкретный день, время и число гостей. Агент
предварительно узнаёт у гостя все три параметра. Если в ответе столики нескольких зон,
агент спрашивает, какую зону предпочитает гость, и не выбирает сам.

TypeScript-функция `findAvailableTables` вызывает
`find_available_tables(p_restaurant, p_date, p_time, p_party_size)` параметризованным
запросом. Совместимый n8n-вход называется `reservation.check`.

**Запрос:**

```jsonc
{
  "restaurant_id": "uuid",
  "session_id": "string",        // только n8n-вход; прямому RPC не передаётся
  "date": "2026-09-01",          // YYYY-MM-DD, местная дата ресторана
  "time": "19:00",               // HH:MM, местное время ресторана
  "party_size": 4
}
```

**Ответ (успех):**

```jsonc
{
  "ok": true,
  "tables": [
    { "table_id": "uuid", "label": "T3", "seats": 4, "zone": "Hauptraum" },
    { "table_id": "uuid", "label": "T9", "seats": 4, "zone": "Terrasse" }
  ]
}
```

`zone` может быть `null`: у столика зона не обязательна. Пустой `tables` — это не ошибка,
а «на это время свободных столиков нет»: так же функция отвечает на закрытый день,
прошедшее время и слишком большую компанию.

**Ответ (ошибка):** `{ "ok": false, "error": "restaurant_not_found" | "invalid_request" }`;
`invalid_request` возможен только через n8n.

**Таймаут на стороне агента:** `AGENT_DATABASE_TIMEOUT_MS` (по умолчанию 8000 мс). При таймауте агент
извиняется и предлагает оставить сообщение менеджеру.

---

## `create_reservation` → `create_reservation_for_table`

**Назначение:** бронь **конкретного** столика, выбранного гостем. `table_id` берётся только
из предыдущего ответа `check_availability`.

TypeScript-функция `createReservation` вызывает
`create_reservation_for_table(p_restaurant, p_table, p_date, p_time, p_party_size,
p_guest_name, p_guest_phone, p_language, p_source)`. Совместимый n8n-вход называется
`reservation.create`.

Дата и время передаются раздельно, а не одним моментом времени: у ролей `agent_app` и
`n8n_app` нет прав на таблицы, и прочитать часовой пояс ресторана они не могут.
Перевод в момент времени делает Postgres-функция.

**Запрос:**

```jsonc
{
  "restaurant_id": "uuid",
  "session_id": "string",
  "table_id": "uuid",            // из ответа check_availability
  "date": "2026-09-01",
  "time": "19:00",
  "party_size": 4,
  "guest_name": "Anna",
  "guest_phone": "+4930...",     // null, если гость не назвал
  "language": "de"
}
```

**Ответ (успех):**

```jsonc
{
  "ok": true,
  "reservation_id": "uuid",
  "table_label": "T3",
  "starts_at": "2026-09-01T19:00:00+02:00",
  "ends_at": "2026-09-01T20:30:00+02:00"
}
```

**Ответ (ошибка):**

```jsonc
{ "ok": false, "error": "table_already_booked" }
```

**Коды ошибок:** `table_already_booked` (столик заняли между поиском и бронью),
`table_not_available` (столик выключен, чужой или мест меньше, чем гостей),
`closed_at_requested_time`, `party_too_large`, `slot_in_past`, `restaurant_not_found`,
`invalid_request`.

**Таймаут на стороне агента:** `AGENT_DATABASE_TIMEOUT_MS`. Подтверждать бронь голосом до успешного
ответа запрещено — это правило и в промпте, и в приёмочных проверках.

---

## `search_menu` → `get_current_menu`

**Назначение:** загрузить в контекст модели весь доступный на момент вопроса каталог ресторана.
Каждая позиция содержит свою категорию, поэтому агент может ответить и на вопрос «к какой
категории относится блюдо». Инструмент вызывается при **каждом** вопросе о меню: он не хранит
снимок между репликами и не принимает от LLM строку поиска, фильтр или идентификатор ресторана.

**Запрос:**

```jsonc
{
  "restaurant_id": "uuid", // из валидированного конфига; LLM его не передаёт
  "language": "de"         // текущий язык сессии; LLM его не передаёт
}
```

**Ответ (успех):**

```jsonc
{
  "ok": true,
  "categories": [
    {
      "id": "uuid",
      "name": "Pizza",
      "items": [
        {
          "id": "uuid",
          "name": "Pizza Margherita",
          "description": "Tomaten und Mozzarella",
          "price_cents": 950,
          "price": "9,50 €",
          "allergens": ["gluten", "milk"],
          "is_vegetarian": true,
          "is_vegan": false,
          "weight_g": 320,
          "volume_ml": null,
          "kcal": 780,
          "protein_g": 31,
          "fat_g": 27,
          "carbs_g": 96
        }
      ]
    }
  ]
}
```

В результате только `menu_items.is_available = true`. Названия, описания и категории
локализованы RPC; `price` форматируется агентом из целых `price_cents` до передачи модели.
`aliases` и `prep_minutes` не возвращаются: это внутренние данные будущего инструмента
самовывоза, а не справочная информация для гостя.

**Ответ (ошибка):**

```jsonc
{ "ok": false, "error": "restaurant_not_found" }
```

**Коды ошибок:** `restaurant_not_found`; транспортные `timeout`, `unreachable`,
`invalid_response` формирует агент. Перед RPC он произносит обычный `filler_checking` на
языке сессии; при ошибке — фразу из `tool_errors` того же языка.

**Таймаут на стороне агента:** `AGENT_DATABASE_TIMEOUT_MS`; при недоступной базе агент не
зависает молча и не выдаёт сведения из памяти.

---

## `request_callback` → пока не зарегистрирован

**Назначение:** сообщение менеджеру ресторана, когда вопрос не решается в разговоре:
банкет от 15 человек, жалоба, особое пожелание, повторно неудавшийся инструмент. Менеджер
перезванивает сам.

Целевой путь должен вызвать `create_callback_request(...)` и отправить уведомление в
Telegram. В текущем агенте инструмента нет: до отдельной реализации он не обещает гостю
создать сообщение или оформить обратный звонок. n8n-вход `callback.create` также не создан.

**Запрос:**

```jsonc
{
  "restaurant_id": "uuid",
  "session_id": "string",
  "category": "banquet",         // banquet | complaint | special | other
  "summary": "string",           // не длиннее 400 символов
  "phone": "+4930...",           // null, если гость не назвал
  "language": "de"
}
```

**Ответ (успех):** `{ "ok": true, "callback_id": "uuid" }`

**Ответ (ошибка):** `{ "ok": false, "error": "invalid_category" | "summary_too_long" | "restaurant_not_found" | "invalid_request" }`

**Текущее поведение:** инструмент не зарегистрирован. Агент честно говорит, что записать
сообщение сейчас не может, и не обещает обратный звонок.

---

## Шаблон контракта

### `<tool_name>` → `<postgres_rpc>`

**Назначение:** …

**Запрос:**

```jsonc
{
  "restaurant_id": "uuid",
  "session_id": "string",
  // поля инструмента …
}
```

**Ответ (успех):**

```jsonc
{
  "ok": true
  // поля результата …
}
```

**Ответ (ошибка):**

```jsonc
{
  "ok": false,
  "error": "<enum-код ошибки>"
}
```

**Коды ошибок:** …

**Таймаут на стороне агента:** … мс; поведение при таймауте: …
