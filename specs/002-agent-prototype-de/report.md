# Отчёт о реализации спеки 002

Дата: 15.08.2026  
Среда: Windows, Node.js 24.19.0, pnpm 11.21.0, Docker Engine 27.3.1,
Docker Compose 2.30.3, PostgreSQL 18.6

Статус спеки сохранён `in-progress`: помимо невыполненных ручных проверок найден
блокирующий риск PII. LiveKit Agents 1.6.4 на уровне `info` логирует пользовательский
`newTranscript` при preemptive generation и полный `message` ответа после playout. Ответ
может повторять имя или телефон, поэтому прототип разрешено запускать только с полностью
синтетическими данными и нельзя считать реализованным до устранения утечки.

## Реализованный объём

- Создан рабочий пакет `agent/`: LiveKit worker, Voxtral Realtime STT, явный Silero VAD,
  Mistral LLM, ElevenLabs TTS и переключаемый multilingual turn detector.
- Env-конфиг валидируется zod до загрузки тяжёлых provider plugins и регистрации worker.
  Parent CLI и job child используют отдельные preflight entrypoints; job замыкает один
  валидированный Config. Ошибка содержит только имена полей и причины, но не значения
  секретов.
- `download-files` использует отдельный config-free entrypoint: до запуска CLI он
  импортирует Silero и LiveKit turn-detector, чтобы их assets появились в
  `Plugin.registeredPlugins`; runtime/API-секреты не читаются. Mistral и ElevenLabs сюда не
  импортируются: их plugin-классы не переопределяют `downloadFiles()` и локальных assets не
  имеют.
- `session.start()` получает опции только через `buildStartOptions()` с литеральным
  `record: false`; это защищено автотестом.
- Немецкий системный prompt ограничивает ответы одной-двумя фразами, запрещает выдумывать
  данные и честно сообщает об отсутствии инструментов. Бронирование и другие действия не
  реализованы.
- Фиксированные немецкие фразы загружаются из YAML и валидируются. До старта сессии
  аудиовход выключается; объявление об ИИ ставится первым непрерываемым сообщением, его
  `waitForPlayout()` завершается, и только затем аудиовход включается в `finally`.
- Собственная телеметрия открывает не больше одного bucket только по EOU пользовательского
  хода, принимает LLM/TTS того же `speechId`, игнорирует VAD/STT и standalone TTS, после
  чего считает p50/max и пишет только числовую сводку и `rssBytes`. Это не подавляет
  отдельные текстовые `info`-логи самого LiveKit SDK — известный блокер описан ниже.
- Ошибка модели вызывает единственную фиксированную немецкую аварийную фразу; приложение
  само не пишет текст ошибки или реплик, но framework-логирование пока нарушает общий
  privacy-критерий.
- Добавлен локальный LiveKit 1.13.5 в dev-compose: loopback-only ports, рабочий healthcheck,
  лимит 512 MiB; `db:down` теперь останавливает только PostgreSQL. Добавлен browser join-token.
- Добавлены 8 файлов Vitest с 20 тестами без сети/ключей/LLM. Agent и DB оформлены как
  отдельные Vitest projects, поэтому agent-тесты запускаются без PostgreSQL.
- Обновлены `.env.example`, корневой и agent README, lock-файл, таблица версий и журнал
  решений. Команды агента/token загружают корневой `.env` через
  `--env-file-if-exists`; тесты `.env` не читают.
- Добавлен `.gitattributes` с LF policy: полный Biome остаётся воспроизводимым после
  Windows checkout; 20 ранее отмеченных файлов нормализованы без логического diff.

## Ключевые файлы

- `agent/src/config.ts` — схема и безопасная загрузка окружения.
- `agent/src/session.ts` — сборка моделей, endpointing, `record: false`, загрузка ресурсов.
- `agent/src/bootstrap.ts`, `index.ts`, `worker.ts` — CLI preflight, runner и job preflight.
- `agent/src/download.ts`, `download-files.ts` — регистрация model plugins до download CLI.
- `agent/src/agent-definition.ts`, `startup.ts` — сессия, disclosure-first и аварийная фраза.
- `agent/src/telemetry.ts` — числовая телеметрия задержки/RSS.
- `agent/src/prompts/system.de.md`, `agent/src/i18n/de.yaml` — немецкое поведение.
- `agent/tests/*.test.ts`, `agent/tests/setup.ts` — 20 локальных тестов и очистка секретов.
- `scripts/dev-token.ts`, `deploy/docker-compose.dev.yml` — локальное подключение браузера.
- `specs/002-agent-prototype-de/manual-tests.md` — восемь живых проверок владельца.

## Отклонения и уточнения относительно спеки

1. `AGENT_TURN_DETECTOR=off` реализован как явный `turnDetection: 'vad'`, а не как
   отсутствие поля. В LiveKit Agents 1.6.4 `undefined` автоматически включает другой
   встроенный detector; только `'vad'` действительно выключает multilingual-модель и при
   этом оставляет обязательный Silero.
2. Иллюстративный псевдокод спеки соединял `greeting` перед `ai_disclosure`. Реализация
   меняет порядок на disclosure → greeting, потому что критерии той же спеки и PROJECT.md
   §11 требуют, чтобы объявление об ИИ было самым первым текстом.
3. Vitest-конфиг разделён на проекты `agent` и `database`, а не только расширен общим
   `include`. Это позволяет выполнить требование о полностью локальных agent-тестах без
   запуска PostgreSQL; полный `vitest run` всё равно прогоняет обе матрицы.
4. Автоматический запуск воркера до `download-files` ожидаемо остановился на отсутствии
   локальной ONNX-модели turn detector. Модель не скачивалась автоматически: это внешний
   сетевой шаг ручного теста 1. Поэтому регистрация воркера и наличие немецкого в
   `languages.json` пока не подтверждены.

Архитектурные причины этих уточнений записаны в `docs/architecture.md`; объём итерации не
расширен.

## Известный блокер: PII в framework-логах

Финальное ревью исходников `@livekit/agents` 1.6.4 подтвердило две утечки на уровне
`info`: `AgentActivity` пишет `newTranscript` при включённой по умолчанию preemptive
generation и `message: forwardedText` после playout. Второе поле содержит полный ответ
агента и может повторять PII из пользовательской реплики. Текущего `LOG_LEVEL=info` и
`enableLogging: false` у ElevenLabs недостаточно.

До исправления запрещены реальные имена, телефоны, бронирования и другие персональные
данные. Для закрытия блока нужно явно отключить preemptive generation и обеспечить
проверяемую фильтрацию либо подавление framework-логов с текстом, сохранив безопасную
числовую телеметрию. Это отмечено как непройденная часть ручного privacy-теста.

## Установка и supply-chain

Команда:

```powershell
$env:CI='true'; pnpm install --frozen-lockfile=false
```

Результат: exit 0, 353 разрешённых пакета, native postinstall успешны. Pnpm 11 потребовал
явно разрешить ровно четыре build scripts: `@livekit/local-inference`, `onnxruntime-node`,
`protobufjs`, `sharp`. Пять согласованных LiveKit-пакетов 1.6.4 добавлены в
`minimumReleaseAgeExclude`, поскольку обязательная версия опубликована меньше
репозиторного карантина `minimumReleaseAge: 1440` минут. Версия менеджера закреплена как
`packageManager: pnpm@11.21.0`. Все прямые версии фиксированы точно;
`@livekit/rtc-node` 0.13.33 зафиксирован как прямой peer.

Повторная проверка `$env:CI='true'; pnpm install --frozen-lockfile --reporter=append-only`
завершилась exit 0 на pnpm 11.21.0: lockfile прошёл supply-chain policies, 241 package link
восстановлен из локального content-addressable store, native install scripts завершились.
Lock-файл не изменился.

Один frozen-запуск внутри sandbox не дал вывода после начала пересоздания `node_modules` и
был остановлен, чтобы не оставлять зависший процесс. Повтор вне sandbox успешно завершил
восстановление. Временный workspace-store `.pnpm-store` удалён и в итоговые файлы не входит.

## Автоматические проверки

| Проверка | Результат |
|---|---|
| `biome check .` | exit 0; 46 файлов, diagnostics 0 |
| `pnpm install --frozen-lockfile --reporter=append-only` | exit 0; supply-chain policy passed |
| `tsc --noEmit` | exit 0 |
| `vitest run --project agent` | exit 0; 8/8 файлов, 20/20 тестов |
| последний полный `vitest run` до download regression | exit 0; 17/17 файлов, 108/108 тестов |
| PostgreSQL для полного прогона | `postgres:18.6`, unique project, healthy, `127.0.0.1:56433` |
| `docker compose ... config --quiet` | exit 0 |
| LiveKit dev-контейнер | healthy; HTTP 200; 512 MiB; published ports только loopback |
| `pnpm db:down` в unique project | exit 0; PostgreSQL stopped, LiveKit остался healthy |
| `node scripts/dev-token.ts spec002-review synthetic-browser` с dev-ключами | exit 0, token создан локально |
| старт воркера до `download-files` | exit 1: отсутствует локальная turn-detector ONNX-модель; ручной шаг |

Повторная матрица запускалась в уникальном compose-проекте
`hello-table-spec002-review-developer`: целевые LiveKit TCP 7880/7881 и UDP 50000–50100,
PostgreSQL на временном loopback-порту 56433 и отдельный volume. `docker inspect` подтвердил
`healthy`, 536870912 bytes и loopback bindings. После проверки оба контейнера, сеть, volume
и временный override удалены; project label queries пусты. Чужие Docker-ресурсы не
останавливались.

Отдельной build-команды нет: пакет запускается Node.js 24 напрямую из TypeScript, как
предписано спекой; блокирующей проверкой сборки служит `tsc --noEmit`.

В автотестах удаляются `MISTRAL_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVEN_API_KEY`,
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `N8N_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`.
Conversation test использует `voice.testing.FakeLLM`; STT/TTS/LiveKit Cloud/LLM и внешняя
сеть не вызываются.

## Как запустить локально

После копирования `.env.example` в корневой `.env` и заполнения тестовых значений:

```powershell
docker compose -f deploy/docker-compose.dev.yml up -d livekit
pnpm agent:download-files
pnpm agent:dev
pnpm dev:token -- test-room browser-user
```

`agent:download-files` — осознанный внешний запрос к Hugging Face. Реальные ключи Mistral и
ElevenLabs нужны только для ручного разговора; не передавать их в тесты и результаты.
Runtime-команды агента и `dev:token` автоматически читают корневой `.env`;
`agent:download-files` и Vitest его не читают.

## Что осталось владельцу

Выполнить все восемь сценариев `manual-tests.md` и записать:

- поддержку `de` моделью turn detector и успешную регистрацию воркера;
- субъективное качество немецкого разговора и краткость ответов;
- p50/max четырёх этапов и общей задержки минимум за 10 ходов;
- лучший режим detector и endpointing без перебивания внутренних пауз;
- три значения RSS параллельных сессий;
- отсутствие аудио/транскриптов на диске и текста реплик в логах;
- наличие немецкого голоса Voxtral TTS для решения итерации 4;
- фиксированную аварийную фразу при неверном Mistral key.

До устранения PII-блокера и переноса фактических latency/RSS в `docs/PROJECT.md` и
`docs/architecture.md` критерии приёмки не закрыты. Статус `implemented` и чекбокс
итерации 3 не выставлялись.
