> **Правила проекта — в корневом [AGENTS.md](../AGENTS.md), они главнее этого файла.**
> Что и как устроено в портале — `portal/README.md`; исходное техническое решение — архивная
> спека `specs/004-portal-test-call/spec.md`. Блок ниже создаёт и восстанавливает сам `next dev`;
> он про версию Next, а не про правила проекта.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
