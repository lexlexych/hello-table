import { describe, expect, it } from "vitest";
import { loadConfig } from "@/lib/config";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
  verifySession,
} from "@/lib/session";
import { authenticate } from "@/lib/users";
import {
  TEST_ADMIN_PASSWORD,
  TEST_OPERATOR_PASSWORD,
  TEST_SESSION_SECRET,
  testEnv,
} from "./fixtures";

async function config() {
  return loadConfig((await testEnv()) as unknown as NodeJS.ProcessEnv);
}

describe("сверка пароля", () => {
  it("пускает администратора с верным паролем", async () => {
    const session = await authenticate(
      "admin",
      TEST_ADMIN_PASSWORD,
      await config(),
    );
    expect(session).toEqual({ username: "admin", role: "admin" });
  });

  it("пускает оператора с верным паролем", async () => {
    const session = await authenticate(
      "operator",
      TEST_OPERATOR_PASSWORD,
      await config(),
    );
    expect(session).toEqual({ username: "operator", role: "operator" });
  });

  it("не пускает с чужим паролем", async () => {
    expect(
      await authenticate("admin", TEST_OPERATOR_PASSWORD, await config()),
    ).toBeUndefined();
  });

  it("не пускает несуществующего пользователя", async () => {
    expect(
      await authenticate("root", TEST_ADMIN_PASSWORD, await config()),
    ).toBeUndefined();
  });
});

describe("сессия", () => {
  it("подписывает и проверяет сессию", async () => {
    const token = await signSession(
      { username: "admin", role: "admin" },
      TEST_SESSION_SECRET,
    );
    expect(await verifySession(token, TEST_SESSION_SECRET)).toEqual({
      username: "admin",
      role: "admin",
    });
  });

  it("отвергает подделанный токен", async () => {
    const token = await signSession(
      { username: "operator", role: "operator" },
      TEST_SESSION_SECRET,
    );
    const [header, payload, signature] = token.split(".");
    // Роль в payload заменена на admin, подпись осталась прежней.
    const tampered = Buffer.from(
      Buffer.from(payload ?? "", "base64url")
        .toString("utf8")
        .replace('"role":"operator"', '"role":"admin"'),
      "utf8",
    ).toString("base64url");

    expect(
      await verifySession(
        `${header}.${tampered}.${signature}`,
        TEST_SESSION_SECRET,
      ),
    ).toBeUndefined();
  });

  it("отвергает токен, подписанный другим секретом", async () => {
    const token = await signSession(
      { username: "admin", role: "admin" },
      "another-secret-that-is-long-enough-0123456789",
    );
    expect(await verifySession(token, TEST_SESSION_SECRET)).toBeUndefined();
  });

  it("отвергает истёкший токен", async () => {
    const token = await signSession(
      { username: "admin", role: "admin" },
      TEST_SESSION_SECRET,
      -1,
    );
    expect(await verifySession(token, TEST_SESSION_SECRET)).toBeUndefined();
  });

  it("отвергает отсутствие токена", async () => {
    expect(await verifySession(undefined, TEST_SESSION_SECRET)).toBeUndefined();
  });

  it("выдаёт cookie с флагами httpOnly и SameSite=Strict", () => {
    expect(SESSION_COOKIE).toBe("portal_session");
    expect(sessionCookieOptions(false)).toMatchObject({
      httpOnly: true,
      sameSite: "strict",
      secure: false,
      path: "/",
    });
    expect(sessionCookieOptions(true).secure).toBe(true);
  });
});
