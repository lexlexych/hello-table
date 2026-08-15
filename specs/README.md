# specs/ — спецификации задач

Рабочая папка двухэтапного процесса разработки (AGENTS.md §3).

## Формат

```
specs/NNN-<slug>/
├── spec.md           # спецификация — пишет Claude Code (/spec)
├── report.md         # отчёт о реализации — пишет Codex (/impl)
└── manual-tests.md   # инструкция ручного тестирования — пишет Codex, если нужна
```

`NNN` — сквозной трёхзначный номер (001, 002, …). Шаблон спеки — [TEMPLATE.md](TEMPLATE.md).

## Статусы (фронтматтер spec.md)

```
draft → ready-for-impl → in-progress → implemented → verified
```

- `ready-for-impl` ставит `/spec`; запуск `/impl` владельцем означает одобрение спеки;
- `in-progress` ставится в начале `/impl`;
- `implemented` — после приёмки результата в `/impl`;
- `verified` — после того, как владелец выполнил ручные проверки из `manual-tests.md`.
