import { AccessToken } from "livekit-server-sdk";
import { getWebsiteLivekitConfig, type WebsiteLivekitConfig } from "./config";

/**
 * Токен на один звонок агенту с публичного сайта. Устроено так же, как тестовый звонок
 * портала (portal/lib/livekit.ts): комната создаётся заново на каждый звонок и живёт только
 * пока идёт разговор. Отличий два — префикс комнаты и то, что гость не авторизован, поэтому
 * в identity нечего класть, кроме случайного суффикса.
 *
 * Воркер агента входит в комнату сам: в его `WorkerOptions` нет `agentName`, поэтому LiveKit
 * диспатчит его в каждую новую комнату (agent/src/index.ts).
 */

export const TOKEN_TTL_SECONDS = 15 * 60;
export const ROOM_PREFIX = "web-call-";
export const IDENTITY_PREFIX = "web-";

export interface WebsiteCallGrant {
  /** Адрес LiveKit для браузера. */
  url: string;
  token: string;
  room: string;
  identity: string;
}

function randomSuffix(): string {
  return globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 12);
}

export async function issueWebsiteCallToken(
  config: WebsiteLivekitConfig = getWebsiteLivekitConfig(),
): Promise<WebsiteCallGrant> {
  const suffix = randomSuffix();
  const room = `${ROOM_PREFIX}${suffix}`;
  const identity = `${IDENTITY_PREFIX}${suffix}`;

  const accessToken = new AccessToken(config.apiKey, config.apiSecret, {
    identity,
    ttl: TOKEN_TTL_SECONDS,
  });
  accessToken.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  });

  return {
    url: config.url,
    token: await accessToken.toJwt(),
    room,
    identity,
  };
}
