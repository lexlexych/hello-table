# Restaurant Voice Agent

Голосовой ИИ-агент для ресторана: приём звонков на немецком, русском и английском —
бронирование столиков, заказы на самовывоз, ответы по меню, оформление обратного звонка.
Плюс веб-портал с ролями администратора и оператора.

**Статус:** база данных реализована; голосовой агент говорит на трёх языках и
переключается по речи гостя, но остаётся `in-progress`. В LiveKit Agents 1.6.4 выявлено логирование текста реплик на уровне `info`,
поэтому прототип пока разрешено запускать только с синтетическими данными без PII и при
`LOG_LEVEL=warn`. Портал поднят в объёме «вход, роли, тестовый звонок, столики и меню».

## Документация

- [docs/PROJECT.md](docs/PROJECT.md) — живое техническое задание и источник истины
- [AGENTS.md](AGENTS.md) — правила работы над проектом и порядок выполнения задачи
- [docs/architecture.md](docs/architecture.md) — журнал архитектурных решений и версий
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — журнал работ: что изменено в каждой задаче
- [docs/manual-tests.md](docs/manual-tests.md) — проверки, которые выполняет человек
- [docs/tool-contracts.md](docs/tool-contracts.md) — контракты инструментов агента
- [docs/runbook.md](docs/runbook.md) — эксплуатация (итерация 15)

## Как ведётся разработка

Проект ведёт один агент — Claude Code либо Codex, правила для них одинаковы. Задача целиком
проходит один цикл: разобраться → объяснить план словами и получить подтверждение владельца →
привести документацию в соответствие → реализовать → проверить (vitest; только локальное
окружение, без реальных API-ключей, сетевых вызовов и LLM, остальное — инструкцией в
`docs/manual-tests.md`) → записать сделанное в `docs/CHANGELOG.md`.

Подробности — в [AGENTS.md](AGENTS.md).

## Структура

| Путь | Назначение |
|---|---|
| `packages/contracts/` | общие типы и zod-схемы (единственный источник) |
| `agent/` | голосовой агент (LiveKit Agents, Node 24) |
| `portal/` | веб-портал (Next.js 16) |
| `db/` | миграции, Postgres-функции, роли, seed |
| `n8n/workflows/` | экспортированные workflow n8n (JSON) |
| `deploy/` | docker-compose, Caddy, конфиги LiveKit |
| `docs/` | документация проекта |
| `specs/` | архив спецификаций прежнего процесса, не пополняется |
| `.claude/` | навыки-чеклисты (канонические) |
| `.agents/` | адаптеры тех же навыков для Codex |

Целевая структура и план итераций — [docs/PROJECT.md](docs/PROJECT.md), §9 и §12.

## Локальная база данных

Требуются Node.js 24, pnpm и Docker Compose. Запустите PostgreSQL командой `pnpm db:up`,
затем примените схему и демо-данные: `pnpm db:migrate && pnpm db:seed`. Повторное применение
безопасно. `pnpm test` пересоздаёт только локальную базу `restaurant_test`; реальные `.env`,
API-ключи и внешняя сеть тестам не нужны. Разрушительный `db:reset` требует
`DB_RESET_CONFIRM=1` или `--yes`. Подробности и SQLSTATE — в `db/README.md`.

## Голосовой агент

Агент использует локальный LiveKit, OpenAI `gpt-transcribe`, `gpt-5.6-terra` LLM,
OpenAI `tts-1` и Silero VAD. Разговор начинается на `AGENT_DEFAULT_LANGUAGE` и дальше идёт
на языке гостя — de, ru или en. Скопируйте `.env.example` в корневой `.env` и заполните
секции LiveKit, OpenAI и поведения агента. Runtime-команды агента и dev-token загружают этот
файл через Node 24 `--env-file-if-exists`; вручную экспортировать переменные не нужно.
`agent:download-files` конфиг и секреты не читает. Затем:

```powershell
docker compose -f deploy/docker-compose.dev.yml up -d livekit
pnpm agent:download-files
pnpm agent:dev
```

Для браузерного клиента выпустите локальный join-токен:

```powershell
pnpm dev:token -- test-room browser-user
```

Команда печатает URL локального LiveKit, комнату, identity и токен. Реальные модели OpenAI
используются только в ручной проверке владельцем; `pnpm test --project agent`
работает на `FakeLLM`, удаляет ключи из окружения и не выполняет внешних запросов. Детали и
меры приватности — в `agent/README.md`.

## Портал и тестовый звонок

Портал (Next.js 16) даёт вход с ролями, справочники столиков и меню и тестовый звонок
из браузера.
Цепочку STT → LLM → TTS он не реализует: страница подключает микрофон к комнате LiveKit,
куда воркер агента входит сам. Подробности — в `portal/README.md`.

Заведите пароли (команда спросит пароль и напечатает bcrypt-хеш для `.env`):

```powershell
pnpm portal:hash
```

Затем в трёх терминалах:

```powershell
pnpm livekit:up
pnpm agent:dev
pnpm portal:dev
```

Портал открывается на **http://localhost:3000** — именно `localhost`: микрофон браузер
отдаёт только в защищённом контексте. Транскрипт показывается на экране и нигде не
сохраняется. Пошаговая проверка — [docs/manual-tests.md](docs/manual-tests.md).

## Локальный production-режим

Для запуска без dev-сервера используйте отдельные команды. `portal:prod` и `website:prod`
сначала собирают приложение, затем запускают готовую Next.js-сборку; после изменений кода
команду нужно выполнить снова. Агент не требует отдельной сборки: `agent:prod` запускает его
в режиме `start`.

```powershell
pnpm portal:prod   # http://localhost:3000
pnpm website:prod  # http://localhost:3001
pnpm agent:prod
```

Локальный production-режим не меняет значения в `.env`: в частности,
`PORTAL_COOKIE_SECURE=false` остаётся корректным для `http://localhost`.
