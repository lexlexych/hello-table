// AGENTS.md §4: автотесты не используют реальные значения из окружения разработчика.
// Всё, что тесты проверяют, они передают сами явным объектом конфигурации.
const secretNames = [
  "ADMIN_USERNAME",
  "ADMIN_PASSWORD_HASH",
  "OPERATOR_USERNAME",
  "OPERATOR_PASSWORD_HASH",
  "SESSION_SECRET",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "LIVEKIT_URL",
  "MISTRAL_API_KEY",
  "ELEVENLABS_API_KEY",
  "PORTAL_DATABASE_URL",
  "PORTAL_RESTAURANT_SLUG",
];

for (const name of secretNames) {
  delete process.env[name];
}
