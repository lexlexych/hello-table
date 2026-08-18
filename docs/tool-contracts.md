# Контракты инструментов агента

Источник истины по входам и выходам вебхуков n8n. Каждый контракт дублируется zod-схемой
в `packages/contracts/src/tools.ts`; агент валидирует ответы этими схемами до передачи
в LLM. Список инструментов — docs/PROJECT.md §6, порядок изменения — навык
`.claude/skills/agent-tools/SKILL.md`: сначала контракт здесь → zod-схема → workflow
n8n → регистрация в агенте.

Общие требования ко всем контрактам:

- ответ — строго типизированная JSON-структура, никакого свободного текста;
- каждый запрос несёт `restaurant_id` и `session_id`;
- каждый запрос подписан `X-Signature` (HMAC-SHA256 тела, секрет `N8N_WEBHOOK_SECRET`);
- ошибки — перечислимые коды, а не сообщения в свободной форме.

**Почему в ответе нет текста причины отказа.** Соблазн вернуть из вебхука готовое
`description` («столик занят, попробуйте другое время») велик, но свободный текст в ответе
инструмента — это то, на чём модель начинает достраивать смысл (PROJECT.md §3.4). Поэтому
вебхук отдаёт только код, а произносимую фразу агент берёт из `agent/src/i18n/<язык>.yaml`
по этому коду. Формулировка остаётся предсказуемой и меняется без правки workflow.

**Коды ошибок.** Доменные совпадают с прикладными SQLSTATE из `db/README.md` — n8n
перекладывает код Postgres в поле `error` один в один. Плюс `invalid_request`, который
добавляет сам n8n, если вход не прошёл валидацию:

`restaurant_not_found`, `no_table_available`, `table_not_available`, `table_already_booked`,
`closed_at_requested_time`, `party_too_large`, `slot_in_past`, `invalid_category`,
`summary_too_long`, `invalid_request`.

Транспортные коды формирует агент, а не вебхук: `timeout`, `unreachable` (сеть, DNS или
код ответа не 2xx), `invalid_response` (ответ не по контракту). Отдельного поведения на
каждый из них нет: агент извиняется и предлагает оставить сообщение менеджеру.

**Статус.** Контракты трёх инструментов ниже определены 18.08.2026. Workflow n8n для них
ещё не созданы (итерация 5) — до этого момента вызовы возвращают `unreachable`.
Контракты `get_opening_hours`, `cancel_reservation`, `search_menu`, `check_pickup_slots`,
`create_pickup_order` не определены.

---

## `check_availability` → вебхук `reservation.check`

**Назначение:** свободные столики на конкретный день, время и число гостей. Агент
предварительно узнаёт у гостя все три параметра. Если в ответе столики нескольких зон,
агент спрашивает, какую зону предпочитает гость, и не выбирает сам.

Вебхук вызывает `find_available_tables(p_restaurant, p_date, p_time, p_party_size)`.

**Запрос:**

```jsonc
{
  "restaurant_id": "uuid",
  "session_id": "string",        // имя комнаты LiveKit, персональных данных нет
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

**Ответ (ошибка):** `{ "ok": false, "error": "restaurant_not_found" | "invalid_request" }`

**Таймаут на стороне агента:** `N8N_TIMEOUT_MS` (по умолчанию 8000 мс). При таймауте агент
извиняется и предлагает оставить сообщение менеджеру.

---

## `create_reservation` → вебхук `reservation.create`

**Назначение:** бронь **конкретного** столика, выбранного гостем. `table_id` берётся только
из предыдущего ответа `check_availability`.

Вебхук вызывает `create_reservation_for_table(p_restaurant, p_table, p_date, p_time,
p_party_size, p_guest_name, p_guest_phone, p_language, p_source)`.

Дата и время передаются раздельно, а не одним моментом времени: у роли `n8n_app` нет прав
на таблицы, и прочитать часовой пояс ресторана, чтобы собрать `timestamptz`, n8n не может.
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

**Таймаут на стороне агента:** `N8N_TIMEOUT_MS`. Подтверждать бронь голосом до успешного
ответа запрещено — это правило и в промпте, и в приёмочных проверках.

---

## `request_callback` → вебхук `callback.create`

**Назначение:** сообщение менеджеру ресторана, когда вопрос не решается в разговоре:
банкет от 15 человек, жалоба, особое пожелание, повторно неудавшийся инструмент. Менеджер
перезванивает сам.

Вебхук вызывает `create_callback_request(p_restaurant, p_phone, p_language, p_summary,
p_category)` и отправляет уведомление в Telegram. В Telegram не передаются имя и телефон
гостя — только категория, язык, время и ссылка на карточку (PROJECT.md §11).

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

**Таймаут на стороне агента:** `N8N_TIMEOUT_MS`. Это последний рубеж разговора: если и он
недоступен, агент честно говорит, что записать сообщение сейчас не может, и называет
телефон ресторана.

---

## Шаблон контракта

### `<tool_name>` → вебхук `<webhook.path>`

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
