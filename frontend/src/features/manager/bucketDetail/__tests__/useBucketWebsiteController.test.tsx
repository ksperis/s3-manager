import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBucketWebsiteController } from "../useBucketWebsiteController";

const apiMocks = vi.hoisted(() => ({
  deleteBucketWebsite: vi.fn(),
  deleteCephAdminBucketWebsite: vi.fn(),
  getBucketWebsite: vi.fn(),
  getCephAdminBucketWebsite: vi.fn(),
  putBucketWebsite: vi.fn(),
  putCephAdminBucketWebsite: vi.fn(),
}));

vi.mock("../../../../api/buckets", () => ({
  deleteBucketWebsite: (...args: unknown[]) =>
    apiMocks.deleteBucketWebsite(...args),
  getBucketWebsite: (...args: unknown[]) => apiMocks.getBucketWebsite(...args),
  putBucketWebsite: (...args: unknown[]) => apiMocks.putBucketWebsite(...args),
}));

vi.mock("../../../../api/cephAdmin", () => ({
  deleteCephAdminBucketWebsite: (...args: unknown[]) =>
    apiMocks.deleteCephAdminBucketWebsite(...args),
  getCephAdminBucketWebsite: (...args: unknown[]) =>
    apiMocks.getCephAdminBucketWebsite(...args),
  putCephAdminBucketWebsite: (...args: unknown[]) =>
    apiMocks.putCephAdminBucketWebsite(...args),
}));

function renderWebsite(
  overrides: Partial<Parameters<typeof useBucketWebsiteController>[0]> = {},
) {
  return renderHook(() =>
    useBucketWebsiteController({
      accountId: "acc-1",
      bucketName: "site-assets",
      cephAdmin: false,
      enabled: true,
      endpointId: null,
      ...overrides,
    }),
  );
}

const hostingConfiguration = {
  index_document: "index.html",
  error_document: "error.html",
  redirect_all_requests_to: null,
  routing_rules: [{ Condition: { KeyPrefixEquals: "docs/" } }],
};

describe("useBucketWebsiteController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads, edits, and saves a Manager hosting configuration", async () => {
    apiMocks.getBucketWebsite.mockResolvedValue(hostingConfiguration);
    apiMocks.putBucketWebsite.mockResolvedValue({
      ...hostingConfiguration,
      index_document: "home.html",
      routing_rules: [],
    });
    const { result } = renderWebsite();

    await act(async () => result.current.load());

    expect(apiMocks.getBucketWebsite).toHaveBeenCalledWith(
      "acc-1",
      "site-assets",
    );
    expect(result.current.configured).toBe(true);
    expect(result.current.mode).toBe("hosting");
    expect(result.current.indexDocument).toBe("index.html");
    expect(result.current.dirty).toBe(false);

    act(() => {
      result.current.updateIndexDocument(" home.html ");
      result.current.updateRoutingRules("[]");
    });
    expect(result.current.dirty).toBe(true);

    await act(async () => result.current.save());

    expect(apiMocks.putBucketWebsite).toHaveBeenCalledWith(
      "acc-1",
      "site-assets",
      {
        error_document: "error.html",
        index_document: "home.html",
        redirect_all_requests_to: null,
        routing_rules: [],
      },
    );
    expect(result.current.status).toBe("Website configuration updated.");
    expect(result.current.indexDocument).toBe("home.html");
    expect(result.current.dirty).toBe(false);

    act(() => result.current.updateErrorDocument("fallback.html"));
    expect(result.current.status).toBeNull();
  });

  it("validates the active website mode before saving", async () => {
    const { result } = renderWebsite();

    act(() => result.current.updateIndexDocument(""));
    await act(async () => result.current.save());
    expect(result.current.error).toBe("Index document is required.");

    act(() => {
      result.current.updateIndexDocument("index.html");
      result.current.updateRoutingRules("{}");
    });
    await act(async () => result.current.save());
    expect(result.current.error).toBe("Routing rules must be a JSON array.");

    act(() => {
      result.current.updateMode("redirect");
      result.current.updateRedirectHost("");
    });
    await act(async () => result.current.save());
    expect(result.current.error).toBe("Redirect hostname is required.");
    expect(apiMocks.putBucketWebsite).not.toHaveBeenCalled();
  });

  it("loads and clears a Ceph Admin redirect configuration", async () => {
    apiMocks.getCephAdminBucketWebsite.mockResolvedValue({
      redirect_all_requests_to: {
        host_name: "www.example.com",
        protocol: "https",
      },
    });
    apiMocks.deleteCephAdminBucketWebsite.mockResolvedValue(undefined);
    const { result } = renderWebsite({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.load());
    expect(result.current.mode).toBe("redirect");
    expect(result.current.redirectHost).toBe("www.example.com");
    expect(result.current.redirectProtocol).toBe("https");

    await act(async () => result.current.clear());

    expect(apiMocks.deleteCephAdminBucketWebsite).toHaveBeenCalledWith(
      7,
      "site-assets",
    );
    expect(result.current.configured).toBe(false);
    expect(result.current.mode).toBe("hosting");
    expect(result.current.status).toBe("Website configuration cleared.");
  });

  it("does not access APIs when the endpoint capability is disabled", async () => {
    const { result } = renderWebsite({ enabled: false });

    await act(async () => result.current.load());
    await act(async () => result.current.save());
    await act(async () => result.current.clear());

    expect(apiMocks.getBucketWebsite).not.toHaveBeenCalled();
    expect(apiMocks.putBucketWebsite).not.toHaveBeenCalled();
    expect(apiMocks.deleteBucketWebsite).not.toHaveBeenCalled();
  });
});
