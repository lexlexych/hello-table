import { validateRuntimeCommandConfig } from "./startup.ts";

// Keep this bootstrap dependency-light: invalid runtime configuration must fail before importing
// LiveKit/plugin modules or attempting worker registration.
process.env.LOG_LEVEL ??= "info";
validateRuntimeCommandConfig();

await import("./index.ts");
