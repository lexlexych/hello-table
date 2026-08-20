# n8n

В проекте используется один self-hosted экземпляр n8n 2.33.3. Локально он запускается в
Docker Compose и доступен только на `http://127.0.0.1:5678`. На Hetzner n8n находится в
той же закрытой Docker-сети, что Postgres. Голосовой агент n8n не вызывает: workflow
зарезервированы для будущих чатов и формуляров.

Экспортированные workflow лежат в `n8n/workflows/`. Они импортируются неактивными и без
credential ID: секреты создаются отдельно в каждом экземпляре n8n и в JSON не попадают.

## Первый локальный запуск

1. Скопируйте `.env.example` в корневой `.env`, если этого ещё не сделали.
2. Задайте три разных секрета:
   - `N8N_APP_PASSWORD` — пароль роли Postgres `n8n_app`;
   - `N8N_WEBHOOK_SECRET` — HMAC-секрет входа из чата/формуляра и Crypto credential;
   - `N8N_ENCRYPTION_KEY` — ключ шифрования внутреннего хранилища credentials n8n.
3. Поднимите базу, примените миграции и синхронизируйте пароли ролей:

   ```powershell
   pnpm db:up
   pnpm db:migrate
   pnpm db:passwords
   pnpm db:seed
   ```

4. Запустите n8n:

   ```powershell
   pnpm n8n:up
   ```

5. Откройте `http://localhost:5678` и создайте локальный owner-аккаунт.

Сгенерировать 32 случайных байта в PowerShell можно так; команду нужно выполнить отдельно
для каждого секрета:

```powershell
[Convert]::ToHexString(
  [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
).ToLower()
```

Локальный Compose имеет известный запасной `N8N_ENCRYPTION_KEY`, чтобы контейнер мог
стартовать до заполнения `.env`. Не используйте этот запасной ключ на Hetzner и не храните
в локальном n8n реальные данные гостей.

## Credentials

Создайте в UI два credentials.

### `hello-table-hmac`

- Тип: **Crypto**.
- Hmac Secret: значение `N8N_WEBHOOK_SECRET` из `.env`.

### `hello-table-postgres`

- Тип: **Postgres**.
- Host: `postgres`.
- Port: `5432`.
- Database: `restaurant`.
- User: `n8n_app`.
- Password: значение `N8N_APP_PASSWORD`.
- SSL: `Disable` внутри локальной Docker-сети.

У `n8n_app` нет прав на таблицы. Роль может только выполнять разрешённые
`SECURITY DEFINER`-функции из `db/roles.sql`.

## Импорт workflow

В UI выберите **Import from File** и по очереди импортируйте:

- `n8n/workflows/reservation-check.json`;
- `n8n/workflows/reservation-create.json`.

> Оба файла удалены из рабочего дерева и сейчас есть только в истории git
> (`git show HEAD:n8n/workflows/reservation-check.json`). Раздел оставлен как есть до
> решения владельца: восстановить экспорт или отказаться от этих workflow.

В каждом workflow:

1. В узле **Compute HMAC** выберите `hello-table-hmac`.
2. В Postgres-узле выберите `hello-table-postgres`.
3. Сохраните workflow.
4. Активируйте workflow.

Production webhook-пути после активации:

- `POST /webhook/reservation.check`;
- `POST /webhook/reservation.create`.

Test URL из редактора (`/webhook-test/...`) предназначен только для ручной настройки.

## Остановка и логи

```powershell
pnpm n8n:logs
pnpm n8n:down
```

`n8n:down` останавливает только n8n и не удаляет его volume. Не удаляйте
`n8n-data-dev`, если хотите сохранить owner-аккаунт, credentials и импортированные
workflow.

## Hetzner

Production Compose использует тот же закреплённый образ и отдельный volume `n8n-data`.
Порт 5678 наружу не публикуется. В итерации 12 UI будет проксироваться через Caddy на
`https://n8n.<домен>` с ограничением по IP владельца. Голосовой агент остаётся
подключённым напрямую к Postgres под ролью `agent_app`.

Перед первым production-запуском обязательно:

- задать новый `N8N_ENCRYPTION_KEY` и сохранить его в защищённом хранилище;
- создать production credentials заново, не переносить локальные секреты;
- импортировать и активировать оба workflow;
- убедиться, что порт 5432 и порт 5678 недоступны извне.

n8n настроен не сохранять payload успешных, ошибочных и ручных executions: запрос на
бронирование содержит имя и телефон гостя. Метаданные n8n хранятся в SQLite внутри volume;
бизнес-данные находятся только в Postgres.

## Бэкап и откат

`n8n-data` и точное значение `N8N_ENCRYPTION_KEY` образуют одну резервную копию: без ключа
восстановленный n8n не расшифрует credentials. Production-процедура бэкапа и восстановления
будет зафиксирована в `docs/runbook.md` в итерации 15.

Откат обновления n8n: остановить сервис, вернуть предыдущий закреплённый тег образа и
восстановить совместимую копию `n8n-data`. Теги `latest` и `stable` в Compose не
используются.

---

# Telegram-бот Basilik (отдельный облачный n8n)

Второй канал ресторана: Telegram-бот, который принимает текст и голосовые сообщения,
отвечает на вопросы о ресторане и меню, проверяет и создаёт брони и передаёт вопрос
оператору. Он живёт **не в локальном n8n из Compose выше**, а в отдельном облачном
инстансе. К прикладной базе он напрямую не подключается: три инструмента данных вызывают
Portal API по HTTPS, а уже портал выполняет разрешённые PostgreSQL RPC.

Экспорт лежит в `n8n/workflows/` и синхронизирован с текущим облачным инстансом: в JSON
сохранены workflow ID и ссылки credentials из `id` + `name`. Сами ключи, токены и пароли в
экспорт не входят.

## Из чего состоит

| Файл | Роль |
|---|---|
| `Basilik Telegram - Orchestrator.json` | Главный workflow: Telegram-триггер, транскрибация голосовых, агент-оркестратор, память, пять инструментов |
| `Basilik Telegram - Sub_ Restaurant info (RAG).json` | Поиск справки о ресторане в Qdrant |
| `Basilik Telegram - Sub_ Menu.json` | Полный каталог меню через Portal API → `get_current_menu` |
| `Basilik Telegram - Sub_ Check availability.json` | Свободные столики через Portal API → `find_available_tables` |
| `Basilik Telegram - Sub_ Create reservation.json` | Бронь через Portal API → `create_reservation_for_table` |
| `Basilik Telegram - Sub_ Operator handoff.json` | Сообщение оператору в Telegram |
| `Basilik Telegram - Ingest_ Restaurant info to Qdrant.json` | Загрузка PDF со справкой в коллекцию Qdrant |

## Credentials

Создайте в облачном инстансе пять учётных записей.

| Credential | Тип | Где используется |
|---|---|---|
| Telegram Bot API | **Telegram** | триггер и ответы в оркестраторе, уведомление оператору |
| OpenRouter | **OpenRouter** | модель агента и HTTP-нода транскрибации |
| OpenAI | **OpenAI** | только эмбеддинги (RAG и загрузчик) |
| Qdrant | **Qdrant** | оба workflow с векторным хранилищем |
| Portal API | **HTTP Header Auth** | три сабворкфлоу меню и бронирования |

### Portal API

В окружении портала задайте случайный `PORTAL_N8N_API_KEY` длиной не меньше 32 символов.
В облачном n8n создайте credential типа **HTTP Header Auth**:

| Поле | Значение |
|---|---|
| Name | `hello-table-portal-api` |
| Header Name | `Authorization` |
| Header Value | `Bearer <значение PORTAL_N8N_API_KEY>` |

Экспорты, синхронизированные с текущим инстансом, уже содержат ссылку на этот credential в
формате `id` + `name`; сам Header Value в JSON не попадает. При импорте в другой инстанс
credential нужно выбрать заново. В ноде
**Get Portal API URL** адрес читается из общей Data Table:

1. В том же проекте n8n создайте Data Table с именем `key_value`.
2. Добавьте строковые столбцы `key` и `value`.
3. Добавьте ровно одну строку: `key = portal_api_base_url`, `value =` публичный HTTPS URL
   портала без завершающего `/`.

Так URL меняется один раз для всех трёх workflow. Ресторан workflow не выбирает: API сам
разрешает `PORTAL_RESTAURANT_SLUG` в серверный `restaurant_id`.

Для локальной проверки облачному n8n нужен временный **HTTP(S)-туннель к порту 3000
портала**, а не TCP-туннель к 55432. В туннель разрешены только вымышленные данные. В
production используется обычный `https://app.<домен>`; Postgres остаётся закрыт.


Отдельный креденшел OpenAI нужен потому, что OpenRouter не отдаёт embeddings API. Если
нужен поставщик в ЕС — замените обе ноды `Embeddings OpenAI` (в `sub-restaurant-info` и в
`ingest-restaurant-info`) на `Embeddings Mistral Cloud`. Менять обязательно **обе сразу**:
коллекция, залитая одной моделью, не ищется другой.

## Порядок импорта

> **Каждый файл — в НОВЫЙ пустой workflow.** «Import from File» не заменяет холст, а
> **добавляет** узлы к тому, что на нём уже есть. Если импортировать все семь файлов в одну
> вкладку, они слипнутся в кучу, а повторяющиеся имена получат суффиксы (`Config1`,
> `Format Response2`) — цепочки при этом развалятся.

Для каждого файла: **Overview → Create Workflow** → на пустом холсте **⋮ → Import from
File** → выбрать файл → **Save**. И только потом браться за следующий.

Порядок важен: сначала шесть вспомогательных, потом оркестратор — иначе в его тулах нечего
выбирать из списка.

1. `Basilik Telegram - Sub_ Restaurant info (RAG).json`
2. `Basilik Telegram - Sub_ Menu.json`
3. `Basilik Telegram - Sub_ Check availability.json`
4. `Basilik Telegram - Sub_ Create reservation.json`
5. `Basilik Telegram - Sub_ Operator handoff.json`
6. `Basilik Telegram - Ingest_ Restaurant info to Qdrant.json`
7. `Basilik Telegram - Orchestrator.json`

В исходном инстансе ссылки на credentials и пять сабворкфлоу уже синхронизированы. После
импорта в другой инстанс выберите локальные credentials и сабворкфлоу заново, затем
проверьте, что в пяти tool-нодах сохранились все значения `workflowInputs.value`.

## Версии узлов

Все `typeVersion` в экспортах подобраны под **n8n 2.27.5** и сверены с пакетами этой сборки
(`n8n-nodes-base@2.27.4`, `@n8n/n8n-nodes-langchain@2.27.4`).

Это не формальность. Версия выше существующей делает узел неразрешимым: n8n рисует его
битым и **молча выбрасывает все его соединения**, а JSON при этом остаётся валидным. Именно
так первая редакция этих workflow приехала в инстанс с разорванными цепочками — у Postgres
стояло `2.7`, которого нет (максимум `2.6`).

Проверяет это автотест `n8n/tests/workflows.test.ts`: таблица максимумов, связность графа,
отсутствие висячих исполняемых узлов, корректный Data Table lookup, Sticky Note и
полные `workflowInputs.value` пяти инструментов оркестратора. Он также допускает только
ссылки credentials из `id` и `name`. При обновлении n8n таблицу в тесте нужно пересверить с
новыми пакетами.

```bash
pnpm exec vitest run --project n8n
```


## Что править после импорта

| Где | Что |
|---|---|
| Data Table `key_value` | строка `portal_api_base_url` → публичный HTTPS URL портала без завершающего `/` |
| `sub-operator-handoff` → нода **Config** | `operator_chat_id` вместо `REPLACE_WITH_OPERATOR_CHAT_ID` |
| `Basilik Telegram - Orchestrator` → пять тулов | при переносе в другой инстанс выбрать соответствующие сабворкфлоу и заново проверить mapping входов |
| `Basilik Telegram - Orchestrator` → **OpenRouter Chat Model** | модель, если `openai/gpt-4.1-mini` не устраивает |
| оба workflow с Qdrant | имя коллекции, если оно не `basilik_info` |

Общий URL Portal API хранится в Data Table; локальные константы остальных workflow остаются
в их нодах `Config`.

## Наполнение базы знаний

1. Создайте в Qdrant коллекцию `basilik_info` с размерностью вектора **1536**
   (`text-embedding-3-small`).
2. Откройте `ingest-restaurant-info`, нажмите **Test workflow** и перейдите по ссылке формы.
3. Загрузите PDF со справкой — например `demo/Basilik_Policy.pdf` из репозитория.

Повторный запуск **добавляет** фрагменты, а не заменяет их. Перед перезаливкой того же
документа очистите коллекцию, иначе бот будет находить дубли.

## Почему здесь нет HMAC

Навык `.claude/skills/n8n-workflows/SKILL.md` требует первым узлом проверять `X-Signature`.
Это правило написано для вебхуков, открытых наружу: у `reservation.check` и
`reservation.create` точка входа доступна из интернета, и подпись — единственное, что
отличает вызов агента от чужого запроса.

У сабворкфлоу Telegram-бота внешней точки входа нет вообще. Их триггер —
`Execute Sub-workflow Trigger`, вызвать его может только другой workflow того же инстанса,
уже прошедший аутентификацию n8n. Подписывать нечего и некому.

Валидация входа (второй пункт навыка) живёт в Portal API и использует схемы из
`packages/contracts`. Если модель прислала «завтра» вместо `2026-09-01`, HTTP endpoint
возвращает `{ "ok": false, "error": "invalid_request" }`, и агент переспрашивает гостя.
Code-нода после HTTP Request только пропускает готовый envelope или превращает сетевой сбой
в `unreachable`; SQLSTATE и бизнес-правила в n8n больше не разбираются.

## Границы

- Транскрибируются только **голосовые сообщения** Telegram (`message.voice`, OGG/Opus).
  Пересланные аудиофайлы `message.audio` идут в ветку текста и остаются без ответа —
  для них нужна отдельная ветка с другим значением `format`.
- Сообщения без текста и без голоса (фото, стикер, документ) попадают в текстовую ветку
  с пустым вводом: агент отвечает фразой о сбое. Отдельной ветки под них нет.
- Брони из Telegram пишутся с `source = 'phone'`: значения `'telegram'` в
  `reservations_source_check` нет, а миграцию под этот канал не заводили.
- Передача оператору ничего не пишет в `callback_requests` — только сообщение в Telegram.
  Имя и телефон гостя туда не попадают: бот их не спрашивает и не знает.
- OpenRouter и Qdrant Cloud — сервисы за пределами ЕС. Это осознанное отступление от
  правила `docs/PROJECT.md` §11, принятое владельцем для этого канала.
