import { hashPassword } from "@/lib/users";

/** Синтетические значения: ни одного реального ключа (AGENTS.md §4). */
export const TEST_SESSION_SECRET =
  "test-session-secret-not-a-real-one-0123456789";
export const TEST_ADMIN_PASSWORD = "admin-test-password";
export const TEST_OPERATOR_PASSWORD = "operator-test-password";

export interface TestEnv {
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD_HASH: string;
  OPERATOR_USERNAME: string;
  OPERATOR_PASSWORD_HASH: string;
  SESSION_SECRET: string;
  LIVEKIT_URL: string;
  LIVEKIT_API_KEY: string;
  LIVEKIT_API_SECRET: string;
}

let cached: TestEnv | undefined;

/** bcrypt cost 12 считается заметное время, поэтому хеши создаются один раз на файл. */
export async function testEnv(): Promise<TestEnv> {
  cached ??= {
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD_HASH: await hashPassword(TEST_ADMIN_PASSWORD),
    OPERATOR_USERNAME: "operator",
    OPERATOR_PASSWORD_HASH: await hashPassword(TEST_OPERATOR_PASSWORD),
    SESSION_SECRET: TEST_SESSION_SECRET,
    LIVEKIT_URL: "ws://localhost:7880",
    LIVEKIT_API_KEY: "test-key",
    LIVEKIT_API_SECRET: "test-secret-value-for-token-signing",
  };
  return cached;
}
