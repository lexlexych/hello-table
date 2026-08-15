const secretNames = [
  "MISTRAL_API_KEY",
  "ELEVENLABS_API_KEY",
  "ELEVEN_API_KEY",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "N8N_WEBHOOK_SECRET",
  "TELEGRAM_BOT_TOKEN",
];

for (const name of secretNames) {
  delete process.env[name];
}

initializeLogger({ pretty: false, level: "silent" });

import { initializeLogger } from "@livekit/agents";
