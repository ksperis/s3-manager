import axios, { type AxiosResponse } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { uploadBrowserFile } from "./browserFileUpload";

vi.mock("axios", () => ({
  default: {
    put: vi.fn(),
  },
}));

const putMock = vi.mocked(axios.put);

describe("uploadBrowserFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    putMock.mockResolvedValue({} as AxiosResponse);
  });

  it("delegates proxy uploads without requesting a presigned URL", async () => {
    const uploadProxy = vi.fn().mockResolvedValue(undefined);
    const presign = vi.fn();

    await uploadBrowserFile({
      file: new File(["proxy"], "proxy.txt", { type: "text/plain" }),
      mode: "proxy",
      onProgress: vi.fn(),
      uploadProxy,
      presign,
    });

    expect(uploadProxy).toHaveBeenCalledOnce();
    expect(presign).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
  });

  it("uploads presigned PUT files with signed and content type headers", async () => {
    const file = new File(["put"], "put.json", {
      type: "application/json",
    });
    const signal = new AbortController().signal;
    const onProgress = vi.fn();

    await uploadBrowserFile({
      file,
      mode: "direct",
      signal,
      onProgress,
      uploadProxy: vi.fn(),
      presign: vi.fn().mockResolvedValue({
        url: "https://upload.test/put",
        method: "PUT",
        headers: { "X-Signed": "yes" },
      }),
    });

    expect(putMock).toHaveBeenCalledWith("https://upload.test/put", file, {
      headers: {
        "X-Signed": "yes",
        "Content-Type": "application/json",
      },
      onUploadProgress: onProgress,
      signal,
    });
  });

  it("rejects non-PUT presigned responses instead of keeping a POST fallback", async () => {
    await expect(
      uploadBrowserFile({
        file: new File(["post"], "post.txt"),
        mode: "direct",
        onProgress: vi.fn(),
        uploadProxy: vi.fn(),
        presign: vi.fn().mockResolvedValue({
          url: "https://upload.test/post",
          method: "POST",
        }),
      }),
    ).rejects.toThrow("Unexpected presigned upload method: POST.");

    expect(putMock).not.toHaveBeenCalled();
  });
});
