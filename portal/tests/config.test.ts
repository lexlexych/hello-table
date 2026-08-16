import { describe, expect, it } from "vitest";
import { loadConfig } from "@/lib/config";
import { testEnv } from "./fixtures";

describe("конфигурация портала", () => {
  it("принимает полное корректное окружение", async () => {
    const env = await testEnv();
    const config = loadConfig(env as unknown as NodeJS.ProcessEnv);

    expect(config.ADMIN_USERNAME).toBe("admin");
    expect(config.OPERATOR_USERNAME).toBe("operator");
    // Флаг по умолчанию выключен: локально портал работает по http.
    expect(config.PORTAL_COOKIE_SECURE).toBe(false);
  });

  it("включает Secure только по явному значению true", async () => {
    const env = { ...(await testEnv()), PORTAL_COOKIE_SECURE: "true" };
    expect(
      loadConfig(env as unknown as NodeJS.ProcessEnv).PORTAL_COOKIE_SECURE,
    ).toBe(true);
  });

  it("падает, если переменных нет", () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(
      /Invalid portal configuration/,
    );
  });

  it("отвергает пароль, записанный в открытом виде вместо bcrypt-хеша", async () => {
    const env = { ...(await testEnv()), ADMIN_PASSWORD_HASH: "hunter2" };
    expect(() => loadConfig(env as unknown as NodeJS.ProcessEnv)).toThrow(
      /ADMIN_PASSWORD_HASH: must be a bcrypt hash/,
    );
  });

  it("отвергает слишком короткий секрет подписи", async () => {
    const env = { ...(await testEnv()), SESSION_SECRET: "short" };
    expect(() => loadConfig(env as unknown as NodeJS.ProcessEnv)).toThrow(
      /SESSION_SECRET/,
    );
  });

  it("не выводит значения секретов в текст ошибки", async () => {
    const env = {
      ...(await testEnv()),
      SESSION_SECRET: "short",
      LIVEKIT_API_SECRET: "",
    };

    let message = "";
    try {
      loadConfig(env as unknown as NodeJS.ProcessEnv);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("SESSION_SECRET");
    expect(message).not.toContain("short");
    expect(message).not.toContain(env.ADMIN_PASSWORD_HASH);
  });
});
