import { describe, expect, it, vi } from "vitest";

import { runWithConcurrencySettled } from "./concurrency";

describe("runWithConcurrencySettled", () => {
  it("bounds concurrency and preserves input order", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const settledIndexes: number[] = [];

    const results = await runWithConcurrencySettled(
      [1, 2, 3, 4, 5],
      2,
      async (value) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        if (value === 3) throw new Error("failed");
        return value * 10;
      },
      (_result, index) => settledIndexes.push(index),
    );

    expect(maxInFlight).toBe(2);
    expect(results.map(({ status }) => status)).toEqual([
      "fulfilled",
      "fulfilled",
      "rejected",
      "fulfilled",
      "fulfilled",
    ]);
    expect(results[0]).toEqual({ status: "fulfilled", value: 10 });
    expect(results[2]).toMatchObject({ status: "rejected" });
    expect(settledIndexes).toHaveLength(5);
  });

  it("isolates settlement observers from the work result", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const results = await runWithConcurrencySettled(
      [1, 2],
      0,
      async (value) => value,
      () => {
        throw new Error("observer failed");
      },
    );

    expect(results).toEqual([
      { status: "fulfilled", value: 1 },
      { status: "fulfilled", value: 2 },
    ]);
    expect(consoleError).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });
});
