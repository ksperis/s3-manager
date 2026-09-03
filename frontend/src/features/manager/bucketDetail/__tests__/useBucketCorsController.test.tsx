import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultCorsExample,
  useBucketCorsController,
} from "../useBucketCorsController";

const apiMocks = vi.hoisted(() => ({
  deleteBucketCors: vi.fn(),
  deleteCephAdminBucketCors: vi.fn(),
  getBucketCors: vi.fn(),
  getCephAdminBucketCors: vi.fn(),
  putBucketCors: vi.fn(),
  putCephAdminBucketCors: vi.fn(),
}));

vi.mock("../../../../api/buckets", () => ({
  deleteBucketCors: (...args: unknown[]) => apiMocks.deleteBucketCors(...args),
  getBucketCors: (...args: unknown[]) => apiMocks.getBucketCors(...args),
  putBucketCors: (...args: unknown[]) => apiMocks.putBucketCors(...args),
}));

vi.mock("../../../../api/cephAdminBuckets", () => ({
  deleteCephAdminBucketCors: (...args: unknown[]) =>
    apiMocks.deleteCephAdminBucketCors(...args),
  getCephAdminBucketCors: (...args: unknown[]) =>
    apiMocks.getCephAdminBucketCors(...args),
  putCephAdminBucketCors: (...args: unknown[]) =>
    apiMocks.putCephAdminBucketCors(...args),
}));

function renderCors(
  overrides: Partial<Parameters<typeof useBucketCorsController>[0]> = {},
) {
  return renderHook(() =>
    useBucketCorsController({
      accountId: "acc-1",
      bucketName: "reports",
      cephAdmin: false,
      enabled: true,
      endpointId: null,
      ...overrides,
    }),
  );
}

describe("useBucketCorsController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads, edits, and saves Manager CORS rules", async () => {
    apiMocks.getBucketCors.mockResolvedValue({
      rules: [{ AllowedMethods: ["GET"], AllowedOrigins: ["*"] }],
    });
    apiMocks.putBucketCors.mockResolvedValue({
      rules: [{ AllowedMethods: ["GET", "PUT"], AllowedOrigins: ["*"] }],
    });
    const { result } = renderCors();

    await act(async () => result.current.load());
    expect(apiMocks.getBucketCors).toHaveBeenCalledWith("acc-1", "reports");
    expect(result.current.configured).toBe(true);
    expect(result.current.dirty).toBe(false);

    act(() => result.current.setText(defaultCorsExample));
    expect(result.current.dirty).toBe(true);
    await act(async () => result.current.save());

    expect(apiMocks.putBucketCors).toHaveBeenCalledWith(
      "acc-1",
      "reports",
      JSON.parse(defaultCorsExample),
    );
    expect(result.current.dirty).toBe(false);
  });

  it("uses the Ceph Admin endpoint and owns deletion state", async () => {
    apiMocks.getCephAdminBucketCors.mockResolvedValue({
      rules: [{ AllowedMethods: ["GET"] }],
    });
    apiMocks.deleteCephAdminBucketCors.mockResolvedValue(undefined);
    const { result } = renderCors({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.load());
    expect(apiMocks.getCephAdminBucketCors).toHaveBeenCalledWith(7, "reports");
    await act(async () => result.current.remove());

    expect(apiMocks.deleteCephAdminBucketCors).toHaveBeenCalledWith(
      7,
      "reports",
    );
    expect(result.current.configured).toBe(false);
    expect(result.current.text).toBe("[]");
  });

  it("rejects valid JSON that is not an array", async () => {
    const { result } = renderCors();

    act(() => result.current.setText("{}"));
    await act(async () => result.current.save());

    expect(result.current.error).toBe(
      "Invalid or unsaved CORS (JSON array required).",
    );
    expect(apiMocks.putBucketCors).not.toHaveBeenCalled();
  });
});
