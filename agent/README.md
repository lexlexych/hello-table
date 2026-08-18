# Голосовой агент ресторана (de / ru / en)

Пакет реализует голосового агента с прямыми инструментами поиска и бронирования через
Postgres RPC. n8n процесс агента не вызывает. Аудио и транскрипты не сохраняются;
`AgentSession.start()` всегда получает явный `record: false`.

Разговор начинается на `AGENT_DEFAULT_LANGUAGE`. Дальше язык определяет распознавание
(ElevenLabs Scribe возвращает его в `UserInputTranscribed.language`), а `LanguageTracker`
в `src/language.ts` решает, когда переключиться: не раньше чем через
`AGENT_LANGUAGE_SWITCH_AFTER` подряд идущих реплик на другом языке, чтобы одно иностранное
слово не меняло язык. Смена языка меняет системный промпт, правила ресторана, фиксированные
фразы, филлеры, тексты ошибок и голос TTS.

## Требования

- Node.js 24 и pnpm 11;
- Docker Compose для локального LiveKit;
- реальные тестовые ключи Mistral (LLM) и ElevenLabs (STT и TTS) только для ручного
  разговора;
- выбранные в ElevenLabs voice id и **обязательно multilingual** model id: немультиязычная
  модель озвучит русский и английский с немецкой артикуляцией;
- локальный PostgreSQL с миграциями и seed, строка `AGENT_DATABASE_URL` под ролью `agent_app`;
- микрофон и браузерный LiveKit-клиент.

Скопируйте корневой `.env.example` в `.env` и заполните его. Runtime-команды `agent:dev`,
`agent:start` и `dev:token` безопасно загружают корневой файл через Node 24
`--env-file-if-exists`, поэтому экспортировать переменные в каждой оболочке не нужно.
`agent:download-files` и Vitest `.env` не читают. Для локального `livekit --dev`
используются только известные dev-ключи
`devkey` / `secret`; никогда не переносите их в production. `ELEVENLABS_BASE_URL` не
задавайте пустой строкой: либо укажите полный EU-residency URL своего тарифа, либо не
объявляйте переменную.

## Первый запуск

```powershell
docker compose -f deploy/docker-compose.dev.yml up -d livekit
pnpm db:up
pnpm db:migrate
pnpm db:passwords
pnpm db:seed
pnpm agent:download-files
pnpm agent:dev
```

`agent:download-files` импортирует плагины Silero и multilingual turn detector, после чего
LiveKit CLI скачивает их локальные модели с Hugging Face. Команде не нужны runtime-конфиг
или API-секреты; она нужна до первого старта воркера. В обычном режиме воркер модель сам не
скачивает.

В другой оболочке выпустите токен:

```powershell
pnpm dev:token -- test-room browser-user
```

Подключите браузерный LiveKit-клиент к напечатанному URL и комнате, используя токен. Первым
звучит непрерываемое объявление об ИИ, затем приветствие. Вход с микрофона включается только
после полного воспроизведения этой фразы. Поиск возвращает только подходящие незанятые
столики вместе с зоной, а бронь создаётся атомарной функцией базы. Инструмент обратного
звонка пока не зарегистрирован.

## Настройка пауз

Сравните `AGENT_TURN_DETECTOR=multilingual` и `off`. Значение `off` сохраняет обязательный
Silero VAD, но не использует multilingual turn detector. Порог окончания реплики задают
`AGENT_MIN_ENDPOINTING_DELAY_MS` и `AGENT_MAX_ENDPOINTING_DELAY_MS`.

> **PII blocker:** LiveKit Agents 1.6.4 на уровне `info` пишет `newTranscript` при
> preemptive generation и `message` после playout. До отдельного исправления запускайте
> прототип только с синтетическими репликами без имён, телефонов и других персональных
> данных. `LOG_LEVEL=warn` скрывает подтверждённые `info`-утечки, но также скрывает
> числовую итоговую телеметрию, поэтому не считается полным исправлением.

## Локальные проверки без внешней сети

```powershell
pnpm test --project agent
pnpm typecheck
pnpm lint
```

Тесты удаляют известные имена секретов из `process.env`, используют `FakeLLM` и текстовый
`session.run()`: STT, TTS, LiveKit Cloud и реальные модели не вызываются.
