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
