import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { proxy } from "@/proxy";
import { testEnv } from "./fixtures";

beforeAll(async () => {
  Object.assign(process.env, await testEnv());
});

describe("proxy и машинный API n8n", () => {
  it("пропускает integration route к собственной Bearer-проверке без cookie", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3000/api/integrations/n8n/menu", {
        method: "POST",
      }),
    );
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("по-прежнему закрывает обычный API без браузерной сессии", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3000/api/menu/categories", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });
});
