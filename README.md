# Restaurant Voice Agent

Голосовой ИИ-агент для ресторана: приём звонков на немецком, русском и английском —
бронирование столиков, заказы на самовывоз, ответы по меню, оформление обратного звонка.
Плюс веб-портал с ролями администратора и оператора.

**Статус:** база данных реализована; немецкий прототип голосового агента остаётся
`in-progress`. В LiveKit Agents 1.6.4 выявлено логирование текста реплик на уровне `info`,
поэтому прототип пока разрешено запускать только с синтетическими данными без PII.

## Документация

- [docs/PROJECT.md](docs/PROJECT.md) — живое техническое задание и источник истины
- [AGENTS.md](AGENTS.md) — правила работы агентов (Claude Code + Codex) и процесс разработки
- [docs/architecture.md](docs/architecture.md) — журнал архитектурных решений и версий
- [docs/tool-contracts.md](docs/tool-contracts.md) — контракты инструментов агента
- [docs/runbook.md](docs/runbook.md) — эксплуатация (итерация 15)

## Как ведётся разработка

Два агента, два этапа на каждую задачу:

1. `/spec <задача>` — Claude Code готовит детальную спецификацию в `specs/NNN-<slug>/spec.md`.
2. Владелец читает спеку; запуск следующего шага — её одобрение.
3. `/impl [NNN]` — Codex реализует по спеке, пишет автотесты (vitest; только локальное
   окружение, без реальных API-ключей, сетевых вызовов и LLM) и инструкцию ручного
   тестирования для всего остального.

Подробности процесса — в [AGENTS.md](AGENTS.md), формат спек — в [specs/README.md](specs/README.md).

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
| `specs/` | спецификации двухэтапного процесса |
| `.claude/` | команды `/spec`, `/impl` и навыки-чеклисты |

Целевая структура и план итераций — [docs/PROJECT.md](docs/PROJECT.md), §9 и §12.

## Локальная база данных

Требуются Node.js 24, pnpm и Docker Compose. Запустите PostgreSQL командой `pnpm db:up`,
затем примените схему и демо-данные: `pnpm db:migrate && pnpm db:seed`. Повторное применение
безопасно. `pnpm test` пересоздаёт только локальную базу `restaurant_test`; реальные `.env`,
API-ключи и внешняя сеть тестам не нужны. Разрушительный `db:reset` требует
`DB_RESET_CONFIRM=1` или `--yes`. Подробности и SQLSTATE — в `db/README.md`.

## Немецкий прототип агента

Прототип использует локальный LiveKit, Voxtral Realtime STT, Mistral LLM, ElevenLabs TTS
и Silero VAD. Скопируйте `.env.example` в корневой `.env` и заполните секции LiveKit,
Mistral, ElevenLabs и поведения агента. Runtime-команды агента и dev-token загружают этот
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

Команда печатает URL локального LiveKit, комнату, identity и токен. Реальные Mistral и
ElevenLabs используются только в ручной проверке владельцем; `pnpm test --project agent`
работает на `FakeLLM`, удаляет ключи из окружения и не выполняет внешних запросов. Детали и
меры приватности — в `agent/README.md`.
