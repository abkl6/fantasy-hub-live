import { describe, expect, it } from "vitest";
import { mapLimit } from "./concurrency";

describe("mapLimit", () => {
  it("keeps input order and never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([30, 5, 20, 1, 10, 2], 3, async (ms, i) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, ms));
      running -= 1;
      return i * 10;
    });
    expect(out).toEqual([0, 10, 20, 30, 40, 50]);
    expect(peak).toBe(3);
  });
});
