import bcrypt from "bcryptjs";
import { getConfig, type PortalConfig } from "./config";
import type { PortalRole, Session } from "./session";

/**
 * Учётные записи портала живут в переменных окружения (PROJECT.md §7.1): двух ролей
 * достаточно, отдельная таблица пользователей проекту не нужна.
 *
 * Модуль требует Node-рантайма: `bcryptjs` не работает в Edge. Middleware проверяет
 * только подпись сессии и сюда не заходит.
 */

/**
 * Реальный bcrypt-хеш стоимости 12 от строки, которой нет ни у одного пользователя.
 * Нужен, чтобы сверка выполнялась и для несуществующего логина: иначе время ответа
 * выдавало бы, существует ли такой пользователь.
 */
const DUMMY_HASH =
  "$2b$12$ZLpiItr1qBRsRvcZRnFcquXh.L3XPlroOBE/UGRUN8Q2P4ty4zu/2";

export const BCRYPT_COST = 12;

interface Account {
  username: string;
  passwordHash: string;
  role: PortalRole;
}

function accounts(config: PortalConfig): Account[] {
  return [
    {
      username: config.ADMIN_USERNAME,
      passwordHash: config.ADMIN_PASSWORD_HASH,
      role: "admin",
    },
    {
      username: config.OPERATOR_USERNAME,
      passwordHash: config.OPERATOR_PASSWORD_HASH,
      role: "operator",
    },
  ];
}

/** Возвращает сессию при верной паре логин/пароль и `undefined` во всех остальных случаях. */
export async function authenticate(
  username: string,
  password: string,
  config: PortalConfig = getConfig(),
): Promise<Session | undefined> {
  const account = accounts(config).find((item) => item.username === username);
  const matches = await bcrypt.compare(
    password,
    account?.passwordHash ?? DUMMY_HASH,
  );
  if (!account || !matches) {
    return undefined;
  }
  return { username: account.username, role: account.role };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}
