import { log } from "@livekit/agents";

/**
 * Информационные логи инструментов отделены от общего уровня LiveKit: корневой
 * LOG_LEVEL остаётся warn, чтобы SDK не писал тексты реплик, а безопасные данные
 * tool call всё равно были видны при разборе звонка.
 *
 * В input и output разрешено передавать только явно собранные проекции без PII.
 * Никогда не передавать сюда исходный объект аргументов LLM целиком.
 */
export function logToolResult(
  tool: string,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  startedAt: number,
): void {
  log()
    .child({ component: "agent_tool" }, { level: "info" })
    .info(
      {
        tool,
        input,
        output,
        ms: Date.now() - startedAt,
      },
      "agent_tool_result",
    );
}
