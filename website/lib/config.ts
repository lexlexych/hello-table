import { z } from "zod";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const websiteConfigSchema = z.object({
  WEBSITE_DATABASE_URL: z.url(),
  WEBSITE_RESTAURANT_ID: z.string().regex(uuidPattern),
});

export type WebsiteConfig = Readonly<{
  databaseUrl: string;
  restaurantId: string;
}>;

export function getWebsiteConfig(environment: NodeJS.ProcessEnv = process.env): WebsiteConfig {
  const parsed = websiteConfigSchema.parse(environment);
  const databaseUrl = new URL(parsed.WEBSITE_DATABASE_URL);
  if (decodeURIComponent(databaseUrl.username) !== "website_app") {
    throw new Error("WEBSITE_DATABASE_URL must use the website_app role");
  }
  return {
    databaseUrl: parsed.WEBSITE_DATABASE_URL,
    restaurantId: parsed.WEBSITE_RESTAURANT_ID,
  };
}

/**
 * LiveKit валидируется отдельной схемой, а не полями `websiteConfigSchema`. Иначе стенд без
 * LiveKit ронял бы форму брони, а стенд без базы — виджет звонка: обе части сайта живут
 * независимо друг от друга (см. docs/architecture.md).
 */
const websiteLivekitConfigSchema = z.object({
  LIVEKIT_URL: z.string().min(1),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
});

export type WebsiteLivekitConfig = Readonly<{
  /** Адрес LiveKit, который получит браузер гостя. */
  url: string;
  apiKey: string;
  apiSecret: string;
}>;

export function getWebsiteLivekitConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WebsiteLivekitConfig {
  const parsed = websiteLivekitConfigSchema.parse(environment);
  return {
    url: parsed.LIVEKIT_URL,
    apiKey: parsed.LIVEKIT_API_KEY,
    apiSecret: parsed.LIVEKIT_API_SECRET,
  };
}
