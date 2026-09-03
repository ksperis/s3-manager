import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StsCredentials } from "../../api/browser";
import { useBrowserPresignRequests } from "./useBrowserPresignRequests";

const apiMocks = vi.hoisted(() => ({
  presignObject: vi.fn(),
  presignObjectWithSts: vi.fn(),
  presignPart: vi.fn(),
  presignPartWithSts: vi.fn(),
}));

vi.mock("../../api/browser", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/browser")>(
      "../../api/browser",
    );
  return {
    ...actual,
    presignObject: (...args: unknown[]) => apiMocks.presignObject(...args),
  };
});

vi.mock("../../api/browserMultipart", () => ({
  presignPart: (...args: unknown[]) => apiMocks.presignPart(...args),
}));

vi.mock("./stsPresigner", () => ({
  presignObjectWithSts: (...args: unknown[]) =>
    apiMocks.presignObjectWithSts(...args),
  presignPartWithSts: (...args: unknown[]) =>
    apiMocks.presignPartWithSts(...args),
}));

const objectPayload = {
  key: "reports/report.csv",
  operation: "get_object" as const,
};
const partPayload = {
  key: "archives/archive.zip",
  part_number: 2,
};

function credentials(accessKeyId: string): StsCredentials {
  return {
    access_key_id: accessKeyId,
    secret_access_key: `secret-${accessKeyId}`,
    session_token: `token-${accessKeyId}`,
    expiration: "2099-01-01T00:00:00Z",
    endpoint: "https://s3.example.test",
    region: "us-east-1",
  };
}

function renderPresignRequests({
  ensureStsCredentials = vi.fn().mockResolvedValue(credentials("sts-1")),
  useStsPresigner = true,
}: {
  ensureStsCredentials?: ReturnType<typeof vi.fn>;
  useStsPresigner?: boolean;
} = {}) {
  const { result } = renderHook(() =>
    useBrowserPresignRequests({
      accountId: "conn-7",
      ensureStsCredentials,
      requestOptions: { workspaceSurface: "manager" },
      sseCustomerKeyBase64: "customer-key",
      useStsPresigner,
    }),
  );
  return { ensureStsCredentials, result };
}

describe("useBrowserPresignRequests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.presignObject.mockResolvedValue({
      url: "https://backend.example.test/object",
      method: "GET",
      expires_in: 900,
    });
    apiMocks.presignPart.mockResolvedValue({
      url: "https://backend.example.test/part",
      method: "PUT",
      expires_in: 900,
    });
    apiMocks.presignObjectWithSts.mockResolvedValue({
      url: "https://sts.example.test/object",
      method: "GET",
      expires_in: 900,
    });
    apiMocks.presignPartWithSts.mockResolvedValue({
      url: "https://sts.example.test/part",
      method: "PUT",
      expires_in: 900,
    });
  });

  it("uses backend object and multipart presign when STS is disabled", async () => {
    const { ensureStsCredentials, result } = renderPresignRequests({
      useStsPresigner: false,
    });

    await expect(
      result.current.presignObjectRequest("bucket-a", objectPayload),
    ).resolves.toMatchObject({ url: "https://backend.example.test/object" });
    await expect(
      result.current.presignPartRequest("bucket-a", "upload-1", partPayload),
    ).resolves.toMatchObject({ url: "https://backend.example.test/part" });

    expect(ensureStsCredentials).not.toHaveBeenCalled();
    expect(apiMocks.presignObject).toHaveBeenCalledWith(
      "conn-7",
      "bucket-a",
      objectPayload,
      "customer-key",
      { workspaceSurface: "manager" },
    );
    expect(apiMocks.presignPart).toHaveBeenCalledWith(
      "conn-7",
      "bucket-a",
      "upload-1",
      partPayload,
      "customer-key",
      { workspaceSurface: "manager" },
    );
  });

  it("uses current STS credentials without a backend request", async () => {
    const ensureStsCredentials = vi
      .fn()
      .mockResolvedValue(credentials("sts-current"));
    const { result } = renderPresignRequests({ ensureStsCredentials });

    await expect(
      result.current.presignObjectRequest("bucket-a", objectPayload),
    ).resolves.toMatchObject({ url: "https://sts.example.test/object" });

    expect(apiMocks.presignObjectWithSts).toHaveBeenCalledWith(
      credentials("sts-current"),
      "bucket-a",
      objectPayload,
    );
    expect(ensureStsCredentials).toHaveBeenCalledTimes(1);
    expect(apiMocks.presignObject).not.toHaveBeenCalled();
  });

  it("refreshes STS credentials once after a multipart signing error", async () => {
    const currentCredentials = credentials("sts-current");
    const refreshedCredentials = credentials("sts-refreshed");
    const ensureStsCredentials = vi
      .fn()
      .mockResolvedValueOnce(currentCredentials)
      .mockResolvedValueOnce(refreshedCredentials);
    apiMocks.presignPartWithSts
      .mockRejectedValueOnce(new Error("expired session"))
      .mockResolvedValueOnce({
        url: "https://sts.example.test/refreshed-part",
        method: "PUT",
        expires_in: 900,
      });
    const { result } = renderPresignRequests({ ensureStsCredentials });

    await expect(
      result.current.presignPartRequest("bucket-a", "upload-1", partPayload),
    ).resolves.toMatchObject({
      url: "https://sts.example.test/refreshed-part",
    });

    expect(ensureStsCredentials).toHaveBeenNthCalledWith(1);
    expect(ensureStsCredentials).toHaveBeenNthCalledWith(2, true);
    expect(apiMocks.presignPartWithSts).toHaveBeenNthCalledWith(
      2,
      refreshedCredentials,
      "bucket-a",
      "upload-1",
      partPayload,
    );
    expect(apiMocks.presignPart).not.toHaveBeenCalled();
  });

  it("falls back to the backend when refreshed STS signing also fails", async () => {
    const ensureStsCredentials = vi
      .fn()
      .mockResolvedValueOnce(credentials("sts-current"))
      .mockResolvedValueOnce(credentials("sts-refreshed"));
    apiMocks.presignObjectWithSts.mockRejectedValue(
      new Error("STS signing unavailable"),
    );
    const { result } = renderPresignRequests({ ensureStsCredentials });

    await expect(
      result.current.presignObjectRequest("bucket-a", objectPayload),
    ).resolves.toMatchObject({ url: "https://backend.example.test/object" });

    expect(apiMocks.presignObjectWithSts).toHaveBeenCalledTimes(2);
    expect(apiMocks.presignObject).toHaveBeenCalledTimes(1);
  });

  it("falls back to the backend when STS credentials are unavailable", async () => {
    const ensureStsCredentials = vi.fn().mockResolvedValue(null);
    const { result } = renderPresignRequests({ ensureStsCredentials });

    await expect(
      result.current.presignPartRequest("bucket-a", "upload-1", partPayload),
    ).resolves.toMatchObject({ url: "https://backend.example.test/part" });

    expect(apiMocks.presignPartWithSts).not.toHaveBeenCalled();
    expect(apiMocks.presignPart).toHaveBeenCalledTimes(1);
  });
});
