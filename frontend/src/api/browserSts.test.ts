import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("./client", () => ({
  default: clientMock,
}));

import {
  getBrowserStsCredentials,
  getBrowserStsStatus,
} from "./browserSts";

describe("browser STS api", () => {
  beforeEach(() => {
    clientMock.get.mockReset();
    clientMock.get.mockResolvedValue({ data: {} });
  });

  it("loads STS availability for the Portal workspace", async () => {
    await getBrowserStsStatus("101", { workspaceSurface: "portal" });

    expect(clientMock.get).toHaveBeenCalledWith("/browser/sts", {
      params: { account_id: "101" },
      headers: { "X-S3-Workspace": "portal" },
    });
  });

  it("loads credentials for the Manager Browser workspace", async () => {
    await getBrowserStsCredentials("12", { workspaceSurface: "manager" });

    expect(clientMock.get).toHaveBeenCalledWith(
      "/browser/sts/credentials",
      {
        params: { account_id: "12" },
        headers: { "X-S3-Workspace": "manager-browser" },
      },
    );
  });
});
