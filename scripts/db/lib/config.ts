export type DbTarget = { url: string; database: string };
export function resolveTarget(argv: string[]): DbTarget {
  const i = argv.indexOf("--url");
  const url = i >= 0 ? argv[i + 1] : process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL or --url is required");
  const parsed = new URL(url);
  return { url, database: decodeURIComponent(parsed.pathname.slice(1)) };
}
export function assertLocalDatabase(url: string): void {
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(host))
    throw new Error(
      `Refusing destructive operation on non-local database host: ${host}`,
    );
}
export function rolePasswords(): {
  agentApp?: string | undefined;
  n8nApp?: string | undefined;
  portalApp?: string | undefined;
  websiteApp?: string | undefined;
} {
  return {
    agentApp: process.env.AGENT_APP_PASSWORD || undefined,
    n8nApp: process.env.N8N_APP_PASSWORD || undefined,
    portalApp: process.env.PORTAL_APP_PASSWORD || undefined,
    websiteApp: process.env.WEBSITE_APP_PASSWORD || undefined,
  };
}
