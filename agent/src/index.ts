import { fileURLToPath } from "node:url";
import { cli, WorkerOptions } from "@livekit/agents";

cli.runApp(
  new WorkerOptions({
    agent: fileURLToPath(new URL("./worker.ts", import.meta.url)),
  }),
);
