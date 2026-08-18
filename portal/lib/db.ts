import postgres from "postgres";
import { getConfig } from "./config";

/**
 * Единственное подключение портала к базе. Роль — `portal_app` (PROJECT.md §5.3):
 * чтение и запись справочников, но никакого DDL и никакого DELETE на таблицах
 * с персональными данными — это ограничено правами в `db/roles.sql`, а не кодом.
 *
 * Модуль импортируется только из серверных компонентов и обработчиков API с
 * `runtime = "nodejs"`. В `proxy.ts` его тянуть нельзя: тот исполняется на каждый
 * запрос, включая статику.
 */

// `next dev` перезагружает модули на каждое изменение файла. Без этого якоря каждая
// перезагрузка открывала бы новый пул, а старый оставался бы висеть на соединениях.
const anchor = globalThis as typeof globalThis & {
  __portalSql?: postgres.Sql;
};

export function db(): postgres.Sql {
  anchor.__portalSql ??= postgres(getConfig().PORTAL_DATABASE_URL, {
    max: 5,
    idle_timeout: 30,
    connect_timeout: 10,
    // Сообщения NOTICE в консоль портала не нужны: они только шумят.
    onnotice: () => {},
  });
  return anchor.__portalSql;
}
