import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * Репозиторий держит один `.env` в корне — так же, как его читает агент. Next ищет `.env`
 * только в папке приложения, поэтому корневой файл подгружается здесь: `next.config.ts`
 * исполняется в каждом процессе Next (dev-сервер, сборка, воркеры сборки).
 *
 * Через `NODE_OPTIONS=--env-file-if-exists` это не сделать: Node запрещает такой флаг
 * дочерним воркерам, и сборка падает.
 */
const rootEnvFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
