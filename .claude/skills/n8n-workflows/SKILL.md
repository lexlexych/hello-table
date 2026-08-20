---
name: n8n-workflows
description: Правила создания и изменения workflow в n8n — вебхуки-инструменты агента, интеграции, Telegram-уведомления, экспорт JSON. Использовать при любой работе с n8n. Use when creating or changing n8n workflows, webhooks or integrations.
---

# Workflow n8n

n8n — оркестрация и интеграции (клей), не источник истины. Разделение ответственности —
docs/PROJECT.md §3.4, безопасность вызовов — §3.5.

## Структура workflow-инструмента

1. **Проверить границу входа.** Открытый webhook начинает с HMAC-проверки `X-Signature`
   через credential `N8N_WEBHOOK_SECRET`. `Execute Sub-workflow Trigger` отдельной подписи
   не требует: его вызывает только уже аутентифицированный workflow того же инстанса.
2. **Валидировать вход общей zod-схемой.** Для облачного n8n это делает Portal API до
   обращения к базе; `restaurant_id` снаружи не принимается, ресторан задаёт конфигурация
   портала.
3. **Облачный n8n вызывает Portal API по HTTPS** через HTTP Request и HTTP Header Auth
   credential (`Authorization: Bearer <PORTAL_N8N_API_KEY>`). Синхронизированный экспорт
   может содержать ссылку credential (`id`, `name`), но не сам Header Value или иной секрет.
4. **Portal API вызывает Postgres-функцию** из PROJECT.md §5.2 под ролью `portal_app`.
   Корректность и атомарность остаются в RPC, а не переезжают в Next.js или n8n.
5. **Строго типизированный ответ** соответствует `docs/tool-contracts.md` и схеме из
   `packages/contracts`: никакого свободного текста и лишних полей.

## Запреты

- **Никакой бизнес-логики в Function-узлах.** Поиск слотов, расчёт сумм, проверки
  вместимости, блокировки — только в Postgres-функциях. Function-узлы n8n не дают
  транзакционных гарантий.
- **Облачному n8n запрещены Postgres credentials и TCP-туннели к базе.** Внешний инстанс
  обращается только к HTTPS API портала; порт 5432 не публикуется.
- **Telegram handoff сохраняется только через Portal API.** В HTTP-теле передаются
  вопрос, язык и стабильный `telegram_user_id`; username и телефон не передаются.

## После изменения

Экспортировать workflow в JSON в `n8n/workflows/` и закоммитить. Workflow, не
экспортированный в репозиторий, считается несуществующим.
