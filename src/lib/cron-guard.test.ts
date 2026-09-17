import { beforeEach, describe, expect, it, vi } from "vitest";

const cronKeysToken = "db-scheduler-token";

vi.mock("@/integrations/supabase/cron-auth", () => ({
  authenticateCronRequest: async (request: Request) => {
    const token = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
    return token === "platform-secret" ? null : new Response("Unauthorized", { status: 401 });
  },
}));

const insert = vi.fn(async () => ({ error: null }));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { token: cronKeysToken } }) }),
      }),
      insert,
    }),
  },
}));

const { authenticateCron } = await import("./cron-guard.server");

const call = (token?: string) =>
  authenticateCron(
    new Request("http://localhost/api/public/cron/ffpc", {
      method: "POST",
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    }),
  );

describe("authenticateCron", () => {
  beforeEach(() => insert.mockClear());

  it("accepts the platform cron secret", async () => {
    expect(await call("platform-secret")).toBeNull();
  });

  it("accepts the database scheduler's key", async () => {
    expect(await call(cronKeysToken)).toBeNull();
  });

  it("rejects anything else and records the rejection", async () => {
    const denied = await call("wrong");
    expect(denied?.status).toBe(401);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("rejects a request with no key at all", async () => {
    expect((await call())?.status).toBe(401);
  });
});
