# Публичный сайт «Базилик»

Отдельное приложение Next.js 16 для гостей ресторана. Запускается на порту 3001:

```powershell
pnpm website:dev
```

Меню хранится в `lib/menu.ts` и соответствует `demo/Basilik_Menu.pdf`. Для реальной
проверки и создания брони нужны `WEBSITE_DATABASE_URL` под ролью `website_app` и
`WEBSITE_RESTAURANT_ID`. Подключение используется только серверными route handlers;
у роли нет доступа к таблицам, только `EXECUTE` двух RPC бронирования.
