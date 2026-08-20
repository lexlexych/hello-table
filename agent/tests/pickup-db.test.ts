import { describe, expect, it } from "vitest";
import type { AgentDatabase } from "../src/tools/database.ts";
import { findPickupSlots } from "../src/tools/pickup-db.ts";

function fakeDatabase(rows: readonly object[]) {
  let text = "";
  const query = async (
    strings: TemplateStringsArray,
    ..._queryValues: readonly unknown[]
  ) => {
    text = strings.join("?");
    return rows;
  };
  const sql = Object.assign(query, {
    json: (value: unknown) => value,
  }) as unknown as AgentDatabase;

  return { sql, text: () => text };
}

describe("findPickupSlots", () => {
  it("requests and returns only the nearest pickup slot", async () => {
    const database = fakeDatabase([
      {
        ready_at: "2026-08-20T18:00:00.000Z",
        date: "2026-08-20",
        time: "20:00",
      },
    ]);

    const result = await findPickupSlots(database.sql, {
      restaurant_id: "00000000-0000-4000-8000-000000000001",
      items: [
        {
          menu_item_id: "00000000-0000-4000-8000-000000000002",
          quantity: 1,
          note: null,
        },
      ],
      date: null,
      time: null,
    });

    expect(database.text()).toMatch(/find_pickup_slots_local[\s\S]*1::int/);
    expect(result).toEqual({
      ok: true,
      value: {
        ok: true,
        slots: [
          {
            ready_at: "2026-08-20T18:00:00.000Z",
            date: "2026-08-20",
            time: "20:00",
          },
        ],
      },
    });
  });

  it("rejects a database response containing more than one slot", async () => {
    const database = fakeDatabase([
      {
        ready_at: "2026-08-20T18:00:00.000Z",
        date: "2026-08-20",
        time: "20:00",
      },
      {
        ready_at: "2026-08-20T18:15:00.000Z",
        date: "2026-08-20",
        time: "20:15",
      },
    ]);

    const result = await findPickupSlots(database.sql, {
      restaurant_id: "00000000-0000-4000-8000-000000000001",
      items: [
        {
          menu_item_id: "00000000-0000-4000-8000-000000000002",
          quantity: 1,
          note: null,
        },
      ],
      date: null,
      time: null,
    });

    expect(result).toEqual({ ok: false, error: "invalid_response" });
  });
});
