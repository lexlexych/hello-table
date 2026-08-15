import { startDownloadFiles } from "./download.ts";

// This entrypoint is intentionally config-free: model assets are public local files and no
// runtime provider or LiveKit secrets are needed to register their download plugins.
await startDownloadFiles();
