import { beforeEach, describe, expect, it, vi } from "vitest";
import { uploadBrowserFile } from "./browserFileUpload";

const fetchMock = vi.fn();

describe("uploadBrowserFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
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
    expect(fetchMock).not.toHaveBeenCalled();
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

    expect(fetchMock).toHaveBeenCalledWith("https://upload.test/put", {
      method: "PUT",
      headers: {
        "X-Signed": "yes",
        "Content-Type": "application/json",
      },
      body: file,
      credentials: "omit",
      signal,
    });
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      loaded: 0,
      total: file.size,
      progress: 0,
    });
    expect(onProgress).toHaveBeenLastCalledWith({
      loaded: file.size,
      total: file.size,
      progress: 1,
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

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
