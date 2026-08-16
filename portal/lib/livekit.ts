import { AccessToken } from "livekit-server-sdk";
import { getConfig, type PortalConfig } from "./config";
import type { Session } from "./session";

/**
 * Токен на один тестовый звонок. Комната создаётся заново на каждый звонок и живёт только
 * пока идёт разговор — долгоживущих комнат и переиспользуемых токенов у портала нет.
 *
 * Воркер агента входит в комнату сам: в его `WorkerOptions` нет `agentName`, поэтому
 * LiveKit диспатчит его в каждую новую комнату (agent/src/index.ts).
 */

export const TOKEN_TTL_SECONDS = 15 * 60;
export const ROOM_PREFIX = "portal-test-";

export interface TestCallGrant {
  /** Адрес LiveKit для браузера. */
  url: string;
  token: string;
  room: string;
  identity: string;
}

function randomSuffix(): string {
  return globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 12);
}

export async function issueTestCallToken(
  session: Session,
  config: PortalConfig = getConfig(),
): Promise<TestCallGrant> {
  const suffix = randomSuffix();
  const room = `${ROOM_PREFIX}${suffix}`;
  // В identity намеренно нет имени пользователя: оно попадёт в метаданные комнаты LiveKit.
  const identity = `portal-${session.role}-${suffix}`;

  const accessToken = new AccessToken(
    config.LIVEKIT_API_KEY,
    config.LIVEKIT_API_SECRET,
    { identity, ttl: TOKEN_TTL_SECONDS },
  );
  accessToken.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  });

  return {
    url: config.LIVEKIT_URL,
    token: await accessToken.toJwt(),
    room,
    identity,
  };
}
