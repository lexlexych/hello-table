import { fileURLToPath } from "node:url";
import { cli, WorkerOptions } from "@livekit/agents";

cli.runApp(
  new WorkerOptions({
    agent: fileURLToPath(new URL("./worker.ts", import.meta.url)),
    // Дефолт SDK — 10с. Холодный форк job-процесса (импорт графа модулей + нативный
    // onnxruntime-node для Silero VAD в prewarm) на Windows иногда не укладывается в 10с и
    // роняет job с "runner initialization timed out" ещё до входа в комнату.
    initializeProcessTimeout: 30_000,
    // Дефолт SDK в dev — 0: без этого каждый звонок форкает и прогревает процесс с нуля
    // именно в момент звонка. При 1 прогрев запускается сразу при старте pnpm agent:dev
    // (ProcPool.start() отрабатывает до входа в комнату), и звонок берёт уже готовый процесс.
    numIdleProcesses: 1,
  }),
);
