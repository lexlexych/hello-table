/**
 * Проверка экспортированных workflow n8n.
 *
 * Тест появился после реального сбоя: у Postgres-узлов был проставлен
 * `typeVersion: 2.7`, которого в n8n 2.27.5 не существует (максимум 2.6). n8n не смог
 * разрешить такой узел, показал его битым и МОЛЧА выбросил все его соединения — три
 * сабворкфлоу приехали в инстанс с разорванными цепочками. Ошибка не ловилась ничем:
 * JSON был валидным, связи внутри файла — согласованными.
 *
 * Ни сети, ни ключей, ни запущенного n8n тест не требует: он читает файлы из
 * `n8n/workflows` и сверяет их с таблицей версий ниже.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Максимальные `typeVersion` для n8n 2.27.5.
 *
 * Источник — распакованные пакеты этой сборки: `n8n-nodes-base@2.27.4` и
 * `@n8n/n8n-nodes-langchain@2.27.4` (обе версии взяты из зависимостей `n8n@2.27.5`).
 * Проверено 20.08.2026. При обновлении n8n таблицу нужно пересверить, иначе тест
 * начнёт пропускать несуществующие версии или ругаться на существующие.
 */
const MAX_TYPE_VERSION: Record<string, number> = {
  "n8n-nodes-base.code": 2,
  "n8n-nodes-base.dataTable": 1.1,
  "n8n-nodes-base.executeWorkflowTrigger": 1.2,
  "n8n-nodes-base.extractFromFile": 1.1,
  "n8n-nodes-base.formTrigger": 2.6,
  "n8n-nodes-base.httpRequest": 4.4,
  "n8n-nodes-base.if": 2.3,
  "n8n-nodes-base.postgres": 2.6,
  "n8n-nodes-base.set": 3.4,
  "n8n-nodes-base.stickyNote": 1,
  "n8n-nodes-base.telegram": 1.2,
  "n8n-nodes-base.telegramTrigger": 1.3,
  "@n8n/n8n-nodes-langchain.agent": 2.2,
  "@n8n/n8n-nodes-langchain.documentDefaultDataLoader": 1.1,
  "@n8n/n8n-nodes-langchain.embeddingsOpenAi": 1.2,
  "@n8n/n8n-nodes-langchain.lmChatOpenRouter": 1,
  "@n8n/n8n-nodes-langchain.memoryBufferWindow": 1.4,
  "@n8n/n8n-nodes-langchain.textSplitterRecursiveCharacterTextSplitter": 1,
  "@n8n/n8n-nodes-langchain.toolWorkflow": 2.2,
  "@n8n/n8n-nodes-langchain.vectorStoreQdrant": 1.3,
};

/** Узлы-триггеры: у них нет входящей main-связи, и это нормально. */
const TRIGGERS = new Set([
  "n8n-nodes-base.executeWorkflowTrigger",
  "n8n-nodes-base.formTrigger",
  "n8n-nodes-base.telegramTrigger",
]);

/** Подузлы кластера: подключаются к родителю связью `ai_*`, main-входа у них нет. */
const SUB_NODES = new Set([
  "@n8n/n8n-nodes-langchain.documentDefaultDataLoader",
  "@n8n/n8n-nodes-langchain.embeddingsOpenAi",
  "@n8n/n8n-nodes-langchain.lmChatOpenRouter",
  "@n8n/n8n-nodes-langchain.memoryBufferWindow",
  "@n8n/n8n-nodes-langchain.textSplitterRecursiveCharacterTextSplitter",
  "@n8n/n8n-nodes-langchain.toolWorkflow",
]);

/** Декоративные узлы не участвуют в исполняемом графе. */
const DECORATIVE_NODES = new Set(["n8n-nodes-base.stickyNote"]);

type Node = {
  name: string;
  type: string;
  typeVersion: number;
  id: string;
  credentials?: unknown;
  parameters?: Record<string, unknown>;
  alwaysOutputData?: boolean;
};
type Target = { node: string; type: string; index: number };
type Workflow = {
  name: string;
  nodes: Node[];
  connections: Record<string, Record<string, Target[][]>>;
};

const DIR = join(process.cwd(), "n8n", "workflows");
const FILES = readdirSync(DIR)
  .filter((file) => file.endsWith(".json"))
  .sort();

const load = (file: string): Workflow =>
  JSON.parse(readFileSync(join(DIR, file), "utf8")) as Workflow;

const targetsOf = (workflow: Workflow): Target[] =>
  Object.values(workflow.connections)
    .flatMap((outputs) => Object.values(outputs))
    .flatMap((branches) => branches.flat())
    .filter(
      (target): target is Target => target !== null && target !== undefined,
    );

it("экспорты вообще существуют", () => {
  expect(FILES.length).toBe(7);
});

describe.each(FILES)("%s", (file) => {
  const workflow = load(file);
  const names = new Set(workflow.nodes.map((node) => node.name));

  it("имеет имя, узлы и связи", () => {
    expect(typeof workflow.name).toBe("string");
    expect(workflow.name.length).toBeGreaterThan(0);
    expect(workflow.nodes.length).toBeGreaterThan(0);
    expect(workflow.connections).toBeTypeOf("object");
  });

  it("не превышает typeVersion, существующие в n8n 2.27.5", () => {
    for (const node of workflow.nodes) {
      const max = MAX_TYPE_VERSION[node.type];
      expect(
        max,
        `неизвестный тип узла ${node.type} (${node.name})`,
      ).toBeDefined();
      expect(
        node.typeVersion,
        `${node.name}: typeVersion ${node.typeVersion} > ${max} — n8n не разрешит узел и выбросит его связи`,
      ).toBeLessThanOrEqual(max as number);
    }
  });

  it("не содержит дублей имён и идентификаторов узлов", () => {
    expect(names.size).toBe(workflow.nodes.length);
    expect(new Set(workflow.nodes.map((node) => node.id)).size).toBe(
      workflow.nodes.length,
    );
  });
});

describe.each(FILES)("%s: граф", (file) => {
  const workflow = load(file);
  const names = new Set(workflow.nodes.map((node) => node.name));

  it("ссылается только на существующие узлы", () => {
    for (const source of Object.keys(workflow.connections)) {
      expect(
        names.has(source),
        `связь исходит из несуществующего узла ${source}`,
      ).toBe(true);
    }
    for (const target of targetsOf(workflow)) {
      expect(
        names.has(target.node),
        `связь ведёт в несуществующий узел ${target.node}`,
      ).toBe(true);
    }
  });

  it("не оставляет висячих узлов", () => {
    const connected = new Set<string>(Object.keys(workflow.connections));
    for (const target of targetsOf(workflow)) connected.add(target.node);

    for (const node of workflow.nodes) {
      if (DECORATIVE_NODES.has(node.type)) continue;
      expect(
        connected.has(node.name),
        `узел ${node.name} не соединён ни с чем`,
      ).toBe(true);
    }
  });

  it("доводит каждый обычный узел до входа main", () => {
    const mainTargets = new Set(
      Object.values(workflow.connections)
        .flatMap((outputs) => outputs.main ?? [])
        .flat()
        .map((target) => target.node),
    );

    for (const node of workflow.nodes) {
      if (
        TRIGGERS.has(node.type) ||
        SUB_NODES.has(node.type) ||
        DECORATIVE_NODES.has(node.type)
      )
        continue;
      expect(
        mainTargets.has(node.name),
        `в узел ${node.name} не входит ни одна main-связь`,
      ).toBe(true);
    }
  });

  it("подключает каждый подузел к родителю связью ai_*", () => {
    for (const node of workflow.nodes) {
      if (!SUB_NODES.has(node.type)) continue;
      const outputs = workflow.connections[node.name];
      expect(outputs, `подузел ${node.name} никуда не подключён`).toBeDefined();
      const kinds = Object.keys(outputs as Record<string, unknown>);
      expect(kinds.every((kind) => kind.startsWith("ai_"))).toBe(true);
    }
  });

  it("ровно один триггер", () => {
    expect(
      workflow.nodes.filter((node) => TRIGGERS.has(node.type)).length,
    ).toBe(1);
  });
});

describe("секреты и идентификаторы инстанса не попадают в репозиторий", () => {
  it.each(FILES)("%s не содержит credentials", (file) => {
    for (const node of load(file).nodes) {
      expect(
        node.credentials,
        `${node.name} несёт credentials`,
      ).toBeUndefined();
    }
  });

  it("тулы оркестратора не содержат ID подворкфлоу", () => {
    // ID сабворкфлоу свои в каждом инстансе n8n. Владелец выбирает их из списка после
    // импорта; закоммиченный ID молча увёл бы тул в чужой workflow.
    const orchestrator = load("telegram-orchestrator.json");
    const tools = orchestrator.nodes.filter(
      (node) => node.type === "@n8n/n8n-nodes-langchain.toolWorkflow",
    );

    expect(tools.length).toBe(5);
    for (const node of tools) {
      const workflowId = node.parameters?.workflowId as
        | { value?: string }
        | undefined;
      expect(workflowId?.value, `${node.name} несёт ID подворкфлоу`).toBe("");
    }
  });
});

const PORTAL_API_WORKFLOWS = [
  ["sub-menu.json", "/api/integrations/n8n/menu"],
  ["sub-check-availability.json", "/api/integrations/n8n/availability"],
  ["sub-create-reservation.json", "/api/integrations/n8n/reservations"],
] as const;

describe("облачный n8n ходит в Portal API, а не в Postgres", () => {
  it.each(FILES)("%s не содержит Postgres-ноды", (file) => {
    expect(
      load(file).nodes.some((node) => node.type === "n8n-nodes-base.postgres"),
    ).toBe(false);
  });

  it.each(PORTAL_API_WORKFLOWS)(
    "%s содержит один credentialed HTTP Request на %s",
    (file, path) => {
      const workflow = load(file);
      const requests = workflow.nodes.filter(
        (node) => node.type === "n8n-nodes-base.httpRequest",
      );
      expect(requests).toHaveLength(1);
      const parameters = requests[0]?.parameters;
      expect(parameters?.authentication).toBe("genericCredentialType");
      expect(parameters?.genericAuthType).toBe("httpHeaderAuth");
      expect(parameters?.url).toContain(path);
      expect(JSON.stringify(workflow)).not.toContain("restaurant_id");
      expect(JSON.stringify(workflow)).not.toContain("executeQuery");
    },
  );

  it.each(PORTAL_API_WORKFLOWS)(
    "%s читает Portal API URL из Data Table key_value и содержит описание",
    (file) => {
      const workflow = load(file);
      const lookups = workflow.nodes.filter(
        (node) => node.type === "n8n-nodes-base.dataTable",
      );
      expect(lookups).toHaveLength(1);
      expect(lookups[0]?.parameters).toMatchObject({
        resource: "row",
        operation: "get",
        dataTableId: { __rl: true, value: "key_value", mode: "name" },
        matchType: "allConditions",
        filters: {
          conditions: [
            {
              keyName: "key",
              condition: "eq",
              keyValue: "portal_api_base_url",
            },
          ],
        },
        returnAll: false,
        limit: 1,
      });
      expect(lookups[0]?.alwaysOutputData).toBe(true);

      const notes = workflow.nodes.filter(
        (node) => node.type === "n8n-nodes-base.stickyNote",
      );
      expect(notes).toHaveLength(1);
      expect(notes[0]?.parameters?.content).toContain("Portal API");
      expect(notes[0]?.parameters?.content).toContain("portal_api_base_url");

      const serialized = JSON.stringify(workflow);
      expect(serialized).toContain("$json.value");
      expect(serialized).not.toContain("https://app.REPLACE_WITH_DOMAIN");
    },
  );
});
