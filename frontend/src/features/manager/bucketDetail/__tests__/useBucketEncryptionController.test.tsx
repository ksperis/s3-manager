import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultEncryptionExample,
  useBucketEncryptionController,
} from "../useBucketEncryptionController";

const apiMocks = vi.hoisted(() => ({
  deleteBucketEncryption: vi.fn(),
  deleteCephAdminBucketEncryption: vi.fn(),
  getBucketEncryption: vi.fn(),
  getCephAdminBucketEncryption: vi.fn(),
  putBucketEncryption: vi.fn(),
  putCephAdminBucketEncryption: vi.fn(),
}));

vi.mock("../../../../api/buckets", () => ({
  deleteBucketEncryption: (...args: unknown[]) =>
    apiMocks.deleteBucketEncryption(...args),
  getBucketEncryption: (...args: unknown[]) =>
    apiMocks.getBucketEncryption(...args),
  putBucketEncryption: (...args: unknown[]) =>
    apiMocks.putBucketEncryption(...args),
}));

vi.mock("../../../../api/cephAdminBucketDetails", () => ({
  deleteCephAdminBucketEncryption: (...args: unknown[]) =>
    apiMocks.deleteCephAdminBucketEncryption(...args),
  getCephAdminBucketEncryption: (...args: unknown[]) =>
    apiMocks.getCephAdminBucketEncryption(...args),
  putCephAdminBucketEncryption: (...args: unknown[]) =>
    apiMocks.putCephAdminBucketEncryption(...args),
}));

function renderEncryption(
  overrides: Partial<Parameters<typeof useBucketEncryptionController>[0]> = {},
) {
  return renderHook(() =>
    useBucketEncryptionController({
      accountId: "acc-1",
      bucketName: "reports",
      cephAdmin: false,
      enabled: true,
      endpointId: null,
      ...overrides,
    }),
  );
}

describe("useBucketEncryptionController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads, edits, and saves Manager encryption rules", async () => {
    apiMocks.getBucketEncryption.mockResolvedValue({
      rules: JSON.parse(defaultEncryptionExample),
    });
    apiMocks.putBucketEncryption.mockResolvedValue({
      rules: [
        {
          ApplyServerSideEncryptionByDefault: {
            SSEAlgorithm: "aws:kms",
          },
        },
      ],
    });
    const { result } = renderEncryption();

    await act(async () => result.current.load());
    expect(apiMocks.getBucketEncryption).toHaveBeenCalledWith(
      "acc-1",
      "reports",
    );
    expect(result.current.configured).toBe(true);
    expect(result.current.dirty).toBe(false);

    act(() =>
      result.current.setText(
        '[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms"}}]',
      ),
    );
    expect(result.current.dirty).toBe(true);
    await act(async () => result.current.save());

    expect(apiMocks.putBucketEncryption).toHaveBeenCalledWith(
      "acc-1",
      "reports",
      JSON.parse(result.current.text),
    );
    expect(result.current.status).toBe("Bucket encryption updated.");
    expect(result.current.dirty).toBe(false);
  });

  it("uses the Ceph Admin endpoint when disabling encryption", async () => {
    apiMocks.getCephAdminBucketEncryption.mockResolvedValue({
      rules: JSON.parse(defaultEncryptionExample),
    });
    apiMocks.deleteCephAdminBucketEncryption.mockResolvedValue(undefined);
    const { result } = renderEncryption({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.load());
    await act(async () => result.current.remove());

    expect(apiMocks.deleteCephAdminBucketEncryption).toHaveBeenCalledWith(
      7,
      "reports",
    );
    expect(result.current.configured).toBe(false);
    expect(result.current.status).toBe("Bucket encryption disabled.");
  });

  it("rejects valid JSON that is not an array", async () => {
    const { result } = renderEncryption();

    act(() => result.current.setText("{}"));
    await act(async () => result.current.save());

    expect(result.current.error).toBe(
      "Invalid or unsaved bucket encryption configuration (JSON array required).",
    );
    expect(apiMocks.putBucketEncryption).not.toHaveBeenCalled();
  });

  it("does not access encryption APIs when the feature is disabled", async () => {
    const { result } = renderEncryption({ enabled: false });

    await act(async () => result.current.load());
    await act(async () => result.current.save());
    await act(async () => result.current.remove());

    expect(apiMocks.getBucketEncryption).not.toHaveBeenCalled();
    expect(apiMocks.putBucketEncryption).not.toHaveBeenCalled();
    expect(apiMocks.deleteBucketEncryption).not.toHaveBeenCalled();
    expect(result.current.text).toBe("[]");
  });
});
