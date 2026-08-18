import { z } from "zod";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const websiteConfigSchema = z.object({
  WEBSITE_N8N_BASE_URL: z.url(),
  WEBSITE_N8N_WEBHOOK_SECRET: z.string().min(32),
  WEBSITE_RESTAURANT_ID: z.string().regex(uuidPattern),
});

export type WebsiteConfig = Readonly<{
  n8nBaseUrl: string;
  n8nWebhookSecret: string;
  restaurantId: string;
}>;

export function getWebsiteConfig(environment: NodeJS.ProcessEnv = process.env): WebsiteConfig {
  const parsed = websiteConfigSchema.parse(environment);
  return {
    n8nBaseUrl: parsed.WEBSITE_N8N_BASE_URL.replace(/\/$/, ""),
    n8nWebhookSecret: parsed.WEBSITE_N8N_WEBHOOK_SECRET,
    restaurantId: parsed.WEBSITE_RESTAURANT_ID,
  };
}
