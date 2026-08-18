# Публичный сайт «Базилик»

Отдельное приложение Next.js 16 для гостей ресторана. Запускается на порту 3001:

```powershell
pnpm website:dev
```

Меню хранится в `lib/menu.ts` и соответствует `demo/Basilik_Menu.pdf`. Для реальной
проверки и создания брони нужны `WEBSITE_N8N_BASE_URL`, `WEBSITE_N8N_WEBHOOK_SECRET` и
`WEBSITE_RESTAURANT_ID`; секрет используется только серверными route handlers.
