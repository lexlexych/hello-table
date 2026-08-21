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
  "n8n-nodes-base.evaluation": 4.8,
  "n8n-nodes-base.evaluationTrigger": 4.7,
  "n8n-nodes-base.executeWorkflowTrigger": 1.2,
  "n8n-nodes-base.extractFromFile": 1.1,
  "n8n-nodes-base.formTrigger": 2.6,
  "n8n-nodes-base.httpRequest": 4.4,
  "n8n-nodes-base.if": 2.3,
  "n8n-nodes-base.manualTrigger": 1,
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
  "n8n-nodes-base.manualTrigger",
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

const loadByWorkflowName = (name: string): Workflow => {
  const match = FILES.map(load).find((workflow) => workflow.name === name);
  if (!match) throw new Error(`workflow с именем ${name} не найден`);
  return match;
};

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

describe("ссылки на credentials и workflow синхронизированы без секретов", () => {
  it.each(FILES)(
    "%s содержит только ссылки credentials из id и name",
    (file) => {
      for (const node of load(file).nodes) {
        if (node.credentials === undefined) continue;
        expect(
          node.credentials,
          `${node.name}: credentials должны быть объектом`,
        ).toBeTypeOf("object");
        for (const reference of Object.values(
          node.credentials as Record<string, unknown>,
        )) {
          expect(
            reference,
            `${node.name}: некорректная ссылка credential`,
          ).toBeTypeOf("object");
          expect(
            Object.keys(reference as Record<string, unknown>).sort(),
          ).toEqual(["id", "name"]);
        }
      }
    },
  );

  it("пять тулов оркестратора содержат выбранные ID подворкфлоу", () => {
    const orchestrator = loadByWorkflowName("Basilik Telegram - Orchestrator");
    const tools = orchestrator.nodes.filter(
      (node) => node.type === "@n8n/n8n-nodes-langchain.toolWorkflow",
    );

    expect(tools.length).toBe(5);
    for (const node of tools) {
      const workflowId = node.parameters?.workflowId as
        | { value?: string }
        | undefined;
      expect(workflowId?.value, `${node.name}: подворкфлоу не выбран`).toMatch(
        /^[A-Za-z0-9]+$/,
      );
    }
  });
});

const PORTAL_API_WORKFLOWS = [
  ["Basilik Telegram - Sub: Menu", "/api/integrations/n8n/menu"],
  [
    "Basilik Telegram - Sub: Check availability",
    "/api/integrations/n8n/availability",
  ],
  [
    "Basilik Telegram - Sub: Create reservation",
    "/api/integrations/n8n/reservations",
  ],
] as const;

describe("облачный n8n ходит в Portal API, а не в Postgres", () => {
  it.each(FILES)("%s не содержит Postgres-ноды", (file) => {
    expect(
      load(file).nodes.some((node) => node.type === "n8n-nodes-base.postgres"),
    ).toBe(false);
  });

  it.each(PORTAL_API_WORKFLOWS)(
    "%s содержит один credentialed HTTP Request на %s",
    (workflowName, path) => {
      const workflow = loadByWorkflowName(workflowName);
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
    (workflowName) => {
      const workflow = loadByWorkflowName(workflowName);
      const lookups = workflow.nodes.filter(
        (node) => node.type === "n8n-nodes-base.dataTable",
      );
      expect(lookups).toHaveLength(1);
      expect(lookups[0]?.parameters).toMatchObject({
        operation: "get",
        dataTableId: { __rl: true, value: "key_value", mode: "name" },
        matchType: "allConditions",
        filters: {
          conditions: [
            {
              keyName: "key",
              keyValue: "portal_api_base_url",
            },
          ],
        },
        limit: 1,
      });
      const lookupParameters = lookups[0]?.parameters;
      expect(lookupParameters?.resource ?? "row").toBe("row");
      expect(lookupParameters?.returnAll ?? false).toBe(false);
      const filters = lookupParameters?.filters as
        | { conditions?: Array<{ condition?: string }> }
        | undefined;
      expect(filters?.conditions?.[0]?.condition ?? "eq").toBe("eq");
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

const ORCHESTRATOR_TOOL_INPUTS = {
  restaurant_info: {
    question:
      "={{ $fromAI('question', 'Вопрос гостя о ресторане', 'string') }}",
  },
  get_menu: {
    language:
      "={{ $fromAI('language', 'Язык разговора: de, ru или en', 'string') }}",
  },
  check_availability: {
    date: "={{ $fromAI('date', 'Дата в формате YYYY-MM-DD', 'string') }}",
    time: "={{ $fromAI('time', 'Время в формате HH:MM', 'string') }}",
    party_size:
      "={{ $fromAI('party_size', 'Число гостей, целое от 1 до 100', 'number') }}",
  },
  create_reservation: {
    table_id:
      "={{ $fromAI('table_id', 'table_id первого подходящего столика из ответа check_availability', 'string') }}",
    date: "={{ $fromAI('date', 'Дата в формате YYYY-MM-DD, та же, что в check_availability', 'string') }}",
    time: "={{ $fromAI('time', 'Время в формате HH:MM, то же, что в check_availability', 'string') }}",
    party_size:
      "={{ $fromAI('party_size', 'Число гостей, целое от 1 до 100', 'number') }}",
    guest_name:
      "={{ $fromAI('guest_name', 'Имя гостя, которое он назвал', 'string') }}",
    language:
      "={{ $fromAI('language', 'Язык разговора: de, ru или en', 'string') }}",
  },
  handoff_to_operator: {
    question:
      "={{ $fromAI('question', 'Вопрос или просьба гостя своими словами, не длиннее 400 символов', 'string') }}",
    language:
      "={{ $fromAI('language', 'Язык разговора: de, ru или en', 'string') }}",
    telegram_user_id:
      "={{ $('Telegram Trigger').first().json.message.from.id }}",
    telegram_username:
      "={{ $('Telegram Trigger').first().json.message.from.username || '' }}",
  },
} as const;

describe("оркестратор передаёт входы в выбранные сабворкфлоу", () => {
  const orchestrator = loadByWorkflowName("Basilik Telegram - Orchestrator");

  it.each(Object.entries(ORCHESTRATOR_TOOL_INPUTS))(
    "%s содержит полный mapping входных параметров",
    (toolName, expectedValues) => {
      const tool = orchestrator.nodes.find((node) => node.name === toolName);
      expect(tool).toBeDefined();
      const inputs = tool?.parameters?.workflowInputs as
        | {
            mappingMode?: string;
            value?: Record<string, unknown>;
            matchingColumns?: string[];
            schema?: Array<{ id?: string }>;
            attemptToConvertTypes?: boolean;
          }
        | undefined;

      expect(inputs?.mappingMode).toBe("defineBelow");
      expect(inputs?.value).toEqual(expectedValues);
      expect(inputs?.matchingColumns).toEqual([]);
      expect(inputs?.attemptToConvertTypes).toBe(true);
      expect(inputs?.schema?.map((field) => field.id)).toEqual(
        Object.keys(expectedValues),
      );
    },
  );
});

describe("ручная загрузка политики ресторана в Qdrant", () => {
  const workflow = loadByWorkflowName(
    "Basilik Telegram - Ingest: Restaurant info to Qdrant",
  );

  it("использует ручной триггер и готовые чанки без повторного splitter", () => {
    expect(
      workflow.nodes.filter(
        (node) => node.type === "n8n-nodes-base.manualTrigger",
      ),
    ).toHaveLength(1);
    expect(
      workflow.nodes.some((node) => node.type === "n8n-nodes-base.formTrigger"),
    ).toBe(false);
    expect(
      workflow.nodes.some((node) => node.type.includes("textSplitter")),
    ).toBe(false);
  });

  it("готовит один непустой item на каждый из 11 разделов PDF", () => {
    const code = workflow.nodes.find(
      (node) => node.name === "Prepare Policy Chunks",
    );
    expect(code?.type).toBe("n8n-nodes-base.code");

    const jsCode = code?.parameters?.jsCode;
    expect(jsCode).toBeTypeOf("string");
    const execute = new Function(jsCode as string) as () => unknown;
    const result = execute();
    expect(Array.isArray(result)).toBe(true);

    const chunks = result as Array<{
      json: {
        text: string;
        section: string;
        section_order: number;
        source: string;
        document_version: string;
        language: string;
      };
    }>;
    expect(chunks).toHaveLength(11);
    expect(chunks.map((chunk) => chunk.json.section)).toEqual([
      "Бронирование",
      "Отмена и перенос брони",
      "Напоминания и подтверждение визита",
      "Банкеты и большие группы",
      "Детское меню",
      "Бизнес-ланч",
      "Оплата",
      "Свой алкоголь (corkage)",
      "Дресс-код и атмосфера",
      "Питомцы",
      "Часы работы, адрес и парковка",
    ]);
    expect(chunks.map((chunk) => chunk.json.section_order)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    expect(new Set(chunks.map((chunk) => chunk.json.section)).size).toBe(11);

    for (const chunk of chunks) {
      expect(chunk.json.text.startsWith(`${chunk.json.section}\n\n`)).toBe(
        true,
      );
      expect(chunk.json.text.length).toBeGreaterThan(chunk.json.section.length);
      expect(chunk.json.source).toBe("Basilik_Policy.pdf");
      expect(chunk.json.document_version).toBe("2026-08");
      expect(chunk.json.language).toBe("ru");
    }
  });

  it("передаёт текст и метаданные каждого item в Default Data Loader", () => {
    const loader = workflow.nodes.find(
      (node) => node.name === "Default Data Loader",
    );
    expect(loader?.parameters).toMatchObject({
      jsonMode: "expressionData",
      jsonData: "={{ $json.text }}",
    });

    const options = loader?.parameters?.options as
      | {
          metadata?: {
            metadataValues?: Array<{ name?: string; value?: string }>;
          };
        }
      | undefined;
    expect(options?.metadata?.metadataValues).toEqual([
      { name: "section", value: "={{ $json.section }}" },
      { name: "section_order", value: "={{ $json.section_order }}" },
      { name: "source", value: "={{ $json.source }}" },
      {
        name: "document_version",
        value: "={{ $json.document_version }}",
      },
      { name: "language", value: "={{ $json.language }}" },
    ]);
  });
});
