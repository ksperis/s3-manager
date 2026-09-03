import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBucketAclController } from "../useBucketAclController";

const apiMocks = vi.hoisted(() => ({
  getBucketAcl: vi.fn(),
  getCephAdminBucketAcl: vi.fn(),
  updateBucketAcl: vi.fn(),
  updateCephAdminBucketAcl: vi.fn(),
}));

vi.mock("../../../../api/bucketDetails", () => ({
  getBucketAcl: (...args: unknown[]) => apiMocks.getBucketAcl(...args),
  updateBucketAcl: (...args: unknown[]) => apiMocks.updateBucketAcl(...args),
}));

vi.mock("../../../../api/cephAdminBucketDetails", () => ({
  getCephAdminBucketAcl: (...args: unknown[]) =>
    apiMocks.getCephAdminBucketAcl(...args),
  updateCephAdminBucketAcl: (...args: unknown[]) =>
    apiMocks.updateCephAdminBucketAcl(...args),
}));

function renderAcl(
  overrides: Partial<Parameters<typeof useBucketAclController>[0]> = {},
) {
  return renderHook(() =>
    useBucketAclController({
      accountId: "acc-1",
      bucketName: "reports",
      cephAdmin: false,
      enabled: true,
      endpointId: null,
      ...overrides,
    }),
  );
}

const publicReadAcl = {
  owner: "owner-1",
  grants: [
    {
      grantee: {
        type: "Group",
        uri: "http://acs.amazonaws.com/groups/global/AllUsers",
      },
      permission: "READ",
    },
  ],
};

const ownerOnlyAcl = {
  owner: "owner-1",
  grants: [
    {
      grantee: { id: "owner-1", type: "CanonicalUser" },
      permission: "FULL_CONTROL",
    },
  ],
};

describe("useBucketAclController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads and infers a Manager bucket ACL", async () => {
    apiMocks.getBucketAcl.mockResolvedValue(publicReadAcl);
    const { result } = renderAcl();

    await act(async () => result.current.load());

    expect(apiMocks.getBucketAcl).toHaveBeenCalledWith("acc-1", "reports");
    expect(result.current.acl).toEqual(publicReadAcl);
    expect(result.current.preset).toBe("public-read");
    expect(result.current.configured).toBe(true);
    expect(result.current.dirty).toBe(false);
  });

  it("recognizes the canonical owner-only grant as the private ACL", async () => {
    apiMocks.getBucketAcl.mockResolvedValue(ownerOnlyAcl);
    const { result } = renderAcl();

    await act(async () => result.current.load());

    expect(result.current.preset).toBe("private");
    expect(result.current.configured).toBe(false);
    expect(result.current.dirty).toBe(false);
  });

  it("preserves the accepted canned preset after saving", async () => {
    apiMocks.getBucketAcl.mockResolvedValue(publicReadAcl);
    apiMocks.updateBucketAcl.mockResolvedValue(ownerOnlyAcl);
    const { result } = renderAcl();
    await act(async () => result.current.load());

    act(() => result.current.updatePreset("bucket-owner-read"));
    expect(result.current.dirty).toBe(true);
    await act(async () => result.current.save());

    expect(apiMocks.updateBucketAcl).toHaveBeenCalledWith(
      "acc-1",
      "reports",
      "bucket-owner-read",
    );
    expect(result.current.preset).toBe("bucket-owner-read");
    expect(result.current.status).toBe("Bucket ACL updated.");
    expect(result.current.dirty).toBe(false);
  });

  it("validates and saves a custom canned ACL value", async () => {
    apiMocks.updateBucketAcl.mockResolvedValue(ownerOnlyAcl);
    const { result } = renderAcl();

    act(() => result.current.updatePreset("custom"));
    await act(async () => result.current.save());
    expect(result.current.error).toBe("ACL value is required.");

    act(() => result.current.updateCustom(" vendor-canned-acl "));
    await act(async () => result.current.save());

    expect(apiMocks.updateBucketAcl).toHaveBeenCalledWith(
      "acc-1",
      "reports",
      "vendor-canned-acl",
    );
    expect(result.current.preset).toBe("custom");
    expect(result.current.custom).toBe("vendor-canned-acl");
    expect(result.current.dirty).toBe(false);
  });

  it("uses Ceph Admin APIs and respects a missing endpoint context", async () => {
    apiMocks.getCephAdminBucketAcl.mockResolvedValue(publicReadAcl);
    apiMocks.updateCephAdminBucketAcl.mockResolvedValue(publicReadAcl);
    const { result } = renderAcl({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.load());
    await act(async () => result.current.save());
    expect(apiMocks.getCephAdminBucketAcl).toHaveBeenCalledWith(7, "reports");
    expect(apiMocks.updateCephAdminBucketAcl).toHaveBeenCalledWith(
      7,
      "reports",
      "public-read",
    );

    const disabled = renderAcl({ enabled: false });
    await act(async () => disabled.result.current.load());
    await act(async () => disabled.result.current.save());
    expect(apiMocks.getBucketAcl).not.toHaveBeenCalled();
    expect(apiMocks.updateBucketAcl).not.toHaveBeenCalled();
  });
});
