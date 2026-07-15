/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("./client", () => ({ default: { get: mocks.get } }));

import { fetchManagerContext } from "./managerContext";

describe("manager context API", () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.get.mockResolvedValue({ data: {} });
  });

  it("only requests remote limits explicitly", async () => {
    await fetchManagerContext(41);
    expect(mocks.get).toHaveBeenLastCalledWith("/manager/context", {
      params: { account_id: 41 },
    });

    await fetchManagerContext(41, { includeLimits: true });
    expect(mocks.get).toHaveBeenLastCalledWith("/manager/context", {
      params: { include_limits: true, account_id: 41 },
    });
  });
});
