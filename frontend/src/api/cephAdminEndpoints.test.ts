import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({ get: vi.fn() }));
const timeoutForRequestProfileMock = vi.hoisted(() => vi.fn(() => 4321));

vi.mock("./client", () => ({
  default: clientMock,
  timeoutForRequestProfile: timeoutForRequestProfileMock,
}));

import {
  getCephAdminEndpointAccess,
  listCephAdminEndpoints,
} from "./cephAdminEndpoints";

describe("Ceph Admin endpoints api", () => {
  beforeEach(() => {
    clientMock.get.mockReset();
    timeoutForRequestProfileMock.mockClear();
    clientMock.get.mockResolvedValue({ data: [] });
  });

  it("uses the interactive timeout for endpoint discovery", async () => {
    await listCephAdminEndpoints();

    expect(timeoutForRequestProfileMock).toHaveBeenCalledWith("interactive");
    expect(clientMock.get).toHaveBeenCalledWith("/ceph-admin/endpoints", {
      timeout: 4321,
    });
  });

  it("preserves access probes, cancellation, and the interactive timeout", async () => {
    const signal = new AbortController().signal;

    await getCephAdminEndpointAccess(7, { probe: true, signal });

    expect(clientMock.get).toHaveBeenCalledWith(
      "/ceph-admin/endpoints/7/access",
      { params: { probe: true }, signal, timeout: 4321 },
    );
  });
});
