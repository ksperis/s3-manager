/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";

export const OBJECT_PREVIEW_MAX_BYTES = 50 * 1024 * 1024;
export const OBJECT_PREVIEW_TEXT_MAX_BYTES = 64 * 1024;

type ObjectPreviewKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "text"
  | "generic";

export type ObjectPreviewLoadResult = {
  blob: Blob;
  contentType?: string | null;
};

type ObjectPreviewLabels = {
  loading: string;
  unavailable: string;
  tooLarge: string;
  unknownSize: string;
  truncated: string;
  error: string;
  frameTitle: string;
};

type ObjectPreviewProps = {
  name: string;
  sizeBytes?: number | null;
  contentType?: string | null;
  initialText?: string | null;
  resolveContentType?: (signal: AbortSignal) => Promise<string | null>;
  loadBlob: (signal: AbortSignal) => Promise<Blob | ObjectPreviewLoadResult>;
  labels?: Partial<ObjectPreviewLabels>;
  formatError?: (error: unknown) => string;
  variant?: "card" | "modal";
};

type PreviewState =
  | { status: "loading" }
  | { status: "unavailable"; reason: "type" | "too-large" | "unknown-size" }
  | { status: "error"; error: unknown }
  | { status: "text"; content: string; truncated: boolean }
  | {
      status: "media";
      kind: Exclude<ObjectPreviewKind, "text" | "generic">;
      url: string;
    };

const DEFAULT_LABELS: ObjectPreviewLabels = {
  loading: "Loading preview...",
  unavailable: "Preview not available for this file type.",
  tooLarge: "Preview is limited to files of 50 MiB or less. Download the file to open it.",
  unknownSize: "Preview is unavailable because the file size could not be determined.",
  truncated: "Preview truncated to the first 64 KiB.",
  error: "Unable to load preview.",
  frameTitle: "Object preview",
};

const extensionForName = (name: string) => {
  const basename = name.split("/").at(-1) ?? name;
  const index = basename.lastIndexOf(".");
  return index >= 0 ? basename.slice(index + 1).toLowerCase() : "";
};

export const objectPreviewKind = (
  name: string,
  contentType?: string | null,
): ObjectPreviewKind => {
  const normalizedType = (contentType ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (normalizedType.startsWith("image/")) return "image";
  if (normalizedType.startsWith("video/")) return "video";
  if (normalizedType.startsWith("audio/")) return "audio";
  if (normalizedType.includes("pdf")) return "pdf";
  if (
    normalizedType.startsWith("text/") ||
    normalizedType.includes("json") ||
    normalizedType.includes("xml") ||
    normalizedType.includes("yaml") ||
    normalizedType.includes("csv")
  ) {
    return "text";
  }

  const extension = extensionForName(name);
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "avif"].includes(extension)) {
    return "image";
  }
  if (["mp4", "webm", "ogg", "mov", "m4v"].includes(extension)) {
    return "video";
  }
  if (["mp3", "wav", "ogg", "m4a", "flac"].includes(extension)) {
    return "audio";
  }
  if (extension === "pdf") return "pdf";
  if (
    [
      "txt",
      "md",
      "markdown",
      "csv",
      "json",
      "yml",
      "yaml",
      "xml",
      "html",
      "css",
      "js",
      "ts",
      "log",
    ].includes(extension)
  ) {
    return "text";
  }
  return "generic";
};

const normalizeLoadResult = (
  result: Blob | ObjectPreviewLoadResult,
): ObjectPreviewLoadResult =>
  result instanceof Blob ? { blob: result, contentType: result.type || null } : result;

export default function ObjectPreview({
  name,
  sizeBytes,
  contentType,
  initialText,
  resolveContentType,
  loadBlob,
  labels,
  formatError,
  variant = "modal",
}: ObjectPreviewProps) {
  const resolvedLabels = useMemo(
    () => ({ ...DEFAULT_LABELS, ...labels }),
    [labels],
  );
  const [state, setState] = useState<PreviewState>({ status: "loading" });

  useEffect(() => {
    const normalizedSize =
      typeof sizeBytes === "number" && Number.isFinite(sizeBytes) && sizeBytes >= 0
        ? sizeBytes
        : null;
    if (normalizedSize === null) {
      setState({ status: "unavailable", reason: "unknown-size" });
      return undefined;
    }
    if (normalizedSize > OBJECT_PREVIEW_MAX_BYTES) {
      setState({ status: "unavailable", reason: "too-large" });
      return undefined;
    }

    const controller = new AbortController();
    let active = true;
    let objectUrl: string | null = null;
    setState({ status: "loading" });

    const loadPreview = async () => {
      const resolvedSourceContentType =
        contentType || (await resolveContentType?.(controller.signal)) || null;
      if (!active) return;
      const sourceKind = objectPreviewKind(name, resolvedSourceContentType);
      if (sourceKind === "generic") {
        setState({ status: "unavailable", reason: "type" });
        return;
      }
      if (
        sourceKind === "text" &&
        initialText !== null &&
        initialText !== undefined
      ) {
        setState({
          status: "text",
          content: initialText.slice(0, OBJECT_PREVIEW_TEXT_MAX_BYTES),
          truncated:
            normalizedSize > OBJECT_PREVIEW_TEXT_MAX_BYTES ||
            initialText.length > OBJECT_PREVIEW_TEXT_MAX_BYTES,
        });
        return;
      }

      const rawResult = await loadBlob(controller.signal);
      if (!active) return;
      const result = normalizeLoadResult(rawResult);
      if (result.blob.size > OBJECT_PREVIEW_MAX_BYTES) {
        setState({ status: "unavailable", reason: "too-large" });
        return;
      }
      const resolvedContentType =
        result.contentType || resolvedSourceContentType || result.blob.type || null;
      const kind = objectPreviewKind(name, resolvedContentType);
      if (kind === "generic") {
        setState({ status: "unavailable", reason: "type" });
        return;
      }
      if (kind === "text") {
        const textBlob = result.blob.slice(0, OBJECT_PREVIEW_TEXT_MAX_BYTES);
        const text = await textBlob.text();
        if (!active) return;
        setState({
          status: "text",
          content: text,
          truncated:
            result.blob.size > OBJECT_PREVIEW_TEXT_MAX_BYTES ||
            normalizedSize > OBJECT_PREVIEW_TEXT_MAX_BYTES,
        });
        return;
      }
      objectUrl = URL.createObjectURL(result.blob);
      setState({ status: "media", kind, url: objectUrl });
    };

    void loadPreview()
      .catch((error) => {
        if (!active || controller.signal.aborted) return;
        setState({ status: "error", error });
      });

    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    contentType,
    initialText,
    loadBlob,
    name,
    resolveContentType,
    sizeBytes,
  ]);

  const containerClassName =
    variant === "card"
      ? "min-h-28 rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] p-3"
      : "rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/40";
  const mediaHeightClassName =
    variant === "card" ? "max-h-[52vh]" : "max-h-[58vh]";
  const textHeightClassName =
    variant === "card" ? "max-h-80" : "max-h-[58vh]";

  return (
    <div className={containerClassName}>
      {state.status === "loading" ? (
        <div className="ui-body text-slate-500 dark:text-slate-300">
          {resolvedLabels.loading}
        </div>
      ) : null}

      {state.status === "error" ? (
        <div role="alert" className="ui-body font-semibold text-rose-600 dark:text-rose-200">
          {formatError?.(state.error) || resolvedLabels.error}
        </div>
      ) : null}

      {state.status === "unavailable" ? (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center ui-body text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {state.reason === "too-large"
            ? resolvedLabels.tooLarge
            : state.reason === "unknown-size"
              ? resolvedLabels.unknownSize
              : resolvedLabels.unavailable}
        </div>
      ) : null}

      {state.status === "text" ? (
        <div className="space-y-2">
          <pre
            className={`${textHeightClassName} overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-4 ui-caption text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100`}
          >
            {state.content}
          </pre>
          {state.truncated ? (
            <p className="ui-caption font-semibold text-slate-500 dark:text-slate-400">
              {resolvedLabels.truncated}
            </p>
          ) : null}
        </div>
      ) : null}

      {state.status === "media" && state.kind === "image" ? (
        <img
          src={state.url}
          alt={name}
          className={`mx-auto ${mediaHeightClassName} w-full rounded-lg bg-white object-contain dark:bg-slate-950`}
        />
      ) : null}

      {state.status === "media" && state.kind === "video" ? (
        <video
          src={state.url}
          controls
          className={`mx-auto ${mediaHeightClassName} w-full rounded-lg bg-black`}
        />
      ) : null}

      {state.status === "media" && state.kind === "audio" ? (
        <audio src={state.url} controls className="w-full" />
      ) : null}

      {state.status === "media" && state.kind === "pdf" ? (
        <iframe
          title={resolvedLabels.frameTitle}
          src={state.url}
          className={`${variant === "card" ? "h-[52vh]" : "h-[58vh]"} w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950`}
        />
      ) : null}
    </div>
  );
}
