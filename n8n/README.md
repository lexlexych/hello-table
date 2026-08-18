# n8n

В проекте используется один self-hosted экземпляр n8n 2.33.3. Локально он запускается в
Docker Compose и доступен только на `http://127.0.0.1:5678`. На Hetzner n8n находится в
той же закрытой Docker-сети, что Postgres. Голосовой агент n8n не вызывает: workflow
используются публичным сайтом ресторана и остаются входом для формуляров.

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

В каждом workflow:

1. В узле **Compute HMAC** выберите `hello-table-hmac`.
2. В Postgres-узле выберите `hello-table-postgres`.
3. Сохраните workflow.
4. Активируйте workflow.

Production webhook-пути после активации:

- `POST /webhook/reservation.check`;
- `POST /webhook/reservation.create`.

Публичный `website` вызывает их только из серверных route handlers: браузер не получает
ни внутренний URL n8n, ни `N8N_WEBHOOK_SECRET`. Созданная бронь получает источник
`website`, чтобы не смешиваться со звонком или ручным действием сотрудника в портале.

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
