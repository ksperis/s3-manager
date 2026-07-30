import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ObjectPreview, {
  OBJECT_PREVIEW_MAX_BYTES,
  OBJECT_PREVIEW_TEXT_MAX_BYTES,
  objectPreviewKind,
} from "./ObjectPreview";

const createObjectUrlMock = vi.fn(() => "blob:object-preview");
const revokeObjectUrlMock = vi.fn();

describe("ObjectPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: createObjectUrlMock,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: revokeObjectUrlMock,
    });
  });

  it("prioritizes the content type and falls back to the file extension", () => {
    expect(objectPreviewKind("report.pdf", "image/png")).toBe("image");
    expect(objectPreviewKind("report.pdf", "text/html")).toBe("text");
    expect(objectPreviewKind("photo.avif", "application/octet-stream")).toBe("image");
    expect(objectPreviewKind("recording.m4a")).toBe("audio");
    expect(objectPreviewKind("archive.bin")).toBe("generic");
  });

  it.each([
    ["image", "photo.png", "image/png", "img"],
    ["video", "clip.mp4", "video/mp4", "video"],
    ["audio", "sound.mp3", "audio/mpeg", "audio"],
    ["pdf", "report.pdf", "application/pdf", "iframe"],
  ])("renders a %s preview", async (_kind, name, contentType, selector) => {
    const { container } = render(
      <ObjectPreview
        name={name}
        sizeBytes={128}
        contentType={contentType}
        loadBlob={async () => new Blob(["preview"], { type: contentType })}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector(selector)).toBeInTheDocument();
    });
    expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
  });

  it("renders and truncates text without loading a second blob", async () => {
    const loadBlob = vi.fn();
    const initialText = "a".repeat(OBJECT_PREVIEW_TEXT_MAX_BYTES + 10);
    render(
      <ObjectPreview
        name="notes.txt"
        sizeBytes={OBJECT_PREVIEW_TEXT_MAX_BYTES + 10}
        contentType="text/plain"
        initialText={initialText}
        loadBlob={loadBlob}
      />,
    );

    expect(await screen.findByText("Preview truncated to the first 64 KiB.")).toBeInTheDocument();
    expect(screen.getByText("a".repeat(OBJECT_PREVIEW_TEXT_MAX_BYTES))).toBeInTheDocument();
    expect(loadBlob).not.toHaveBeenCalled();
  });

  it("does not load previews with an unknown or excessive size", () => {
    const loadUnknown = vi.fn();
    const { rerender } = render(
      <ObjectPreview
        name="photo.png"
        sizeBytes={null}
        contentType="image/png"
        loadBlob={loadUnknown}
      />,
    );

    expect(
      screen.getByText("Preview is unavailable because the file size could not be determined."),
    ).toBeInTheDocument();
    expect(loadUnknown).not.toHaveBeenCalled();

    const loadLarge = vi.fn();
    rerender(
      <ObjectPreview
        name="photo.png"
        sizeBytes={OBJECT_PREVIEW_MAX_BYTES + 1}
        contentType="image/png"
        loadBlob={loadLarge}
      />,
    );
    expect(
      screen.getByText(
        "Preview is limited to files of 50 MiB or less. Download the file to open it.",
      ),
    ).toBeInTheDocument();
    expect(loadLarge).not.toHaveBeenCalled();
  });

  it("accepts a preview exactly at the 50 MiB boundary", async () => {
    const loadBlob = vi.fn(async () => new Blob(["image"], { type: "image/png" }));
    render(
      <ObjectPreview
        name="photo.png"
        sizeBytes={OBJECT_PREVIEW_MAX_BYTES}
        contentType="image/png"
        loadBlob={loadBlob}
      />,
    );

    expect(await screen.findByRole("img", { name: "photo.png" })).toBeInTheDocument();
    expect(loadBlob).toHaveBeenCalledTimes(1);
  });

  it("resolves missing metadata before deciding whether to load the blob", async () => {
    const resolveContentType = vi.fn(async () => "image/png");
    const loadBlob = vi.fn(async () => new Blob(["image"], { type: "image/png" }));
    render(
      <ObjectPreview
        name="object-without-extension"
        sizeBytes={10}
        resolveContentType={resolveContentType}
        loadBlob={loadBlob}
      />,
    );

    expect(
      await screen.findByRole("img", { name: "object-without-extension" }),
    ).toBeInTheDocument();
    expect(resolveContentType).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(loadBlob).toHaveBeenCalledTimes(1);
  });

  it("shows unsupported and error states", async () => {
    const unsupportedLoader = vi.fn(async () =>
      new Blob(["binary"], { type: "application/octet-stream" }),
    );
    const { rerender } = render(
      <ObjectPreview
        name="archive.bin"
        sizeBytes={10}
        contentType="application/octet-stream"
        loadBlob={unsupportedLoader}
      />,
    );
    expect(
      await screen.findByText("Preview not available for this file type."),
    ).toBeInTheDocument();
    expect(unsupportedLoader).not.toHaveBeenCalled();

    rerender(
      <ObjectPreview
        name="photo.png"
        sizeBytes={10}
        contentType="image/png"
        loadBlob={async () => {
          throw new Error("network failed");
        }}
        formatError={(error) => (error instanceof Error ? error.message : "failed")}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("network failed");
  });

  it("aborts pending work and revokes created object URLs on cleanup", async () => {
    let capturedSignal: AbortSignal | null = null;
    const pending = new Promise<Blob>(() => undefined);
    const first = render(
      <ObjectPreview
        name="photo.png"
        sizeBytes={10}
        contentType="image/png"
        loadBlob={(signal) => {
          capturedSignal = signal;
          return pending;
        }}
      />,
    );

    first.unmount();
    expect(capturedSignal?.aborted).toBe(true);

    const second = render(
      <ObjectPreview
        name="photo.png"
        sizeBytes={10}
        contentType="image/png"
        loadBlob={async () => new Blob(["image"], { type: "image/png" })}
      />,
    );
    expect(await screen.findByRole("img", { name: "photo.png" })).toBeInTheDocument();
    second.unmount();
    expect(revokeObjectUrlMock).toHaveBeenCalledWith("blob:object-preview");
  });
});
