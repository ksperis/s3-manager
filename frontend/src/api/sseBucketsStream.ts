import client, { buildApiRequestHeaders } from "./client";
import { sanitizeErrorMessage } from "../utils/apiError";
import { consumeSseStream } from "./sseStream";

type StreamBucketsOptions<TProgress> = {
  signal?: AbortSignal;
  onProgress?: (event: TProgress) => void;
};

type StreamBucketsParams<TProgress> = {
  url: string;
  options?: StreamBucketsOptions<TProgress>;
  streamFailedLabel: string;
  missingResultMessage: string;
  requestInit?: RequestInit;
};

export function resolveApiBaseUrl(): string {
  const base = typeof client.defaults.baseURL === "string" && client.defaults.baseURL.trim() ? client.defaults.baseURL : "/api";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

export function buildJsonPostRequestInit(payload: unknown): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  };
}

function isCancelledError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (typeof err !== "object" || err === null) return false;
  const name = "name" in err ? String((err as { name?: unknown }).name ?? "") : "";
  const code = "code" in err ? String((err as { code?: unknown }).code ?? "") : "";
  return name === "CanceledError" || code === "ERR_CANCELED";
}

function buildHeaders(method: string, extraHeaders?: HeadersInit): Headers {
  const headers = buildApiRequestHeaders(method, extraHeaders);
  headers.set("Accept", "text/event-stream");
  return headers;
}

async function fetchStream(url: string, signal?: AbortSignal, requestInit?: RequestInit): Promise<Response> {
  const method = requestInit?.method?.toUpperCase() ?? "GET";
  let response = await fetch(url, {
    ...requestInit,
    method,
    headers: buildHeaders(method, requestInit?.headers),
    credentials: "include",
    signal,
  });

  if (response.status === 401 || response.status === 419) {
    try {
      await client.post("/auth/refresh", undefined, { signal });
      response = await fetch(url, {
        ...requestInit,
        method,
        headers: buildHeaders(method, requestInit?.headers),
        credentials: "include",
        signal,
      });
    } catch (err) {
      if (isCancelledError(err)) throw err;
    }
  }

  return response;
}

export async function streamBucketsWithSse<TProgress, TResult>({
  url,
  options,
  streamFailedLabel,
  missingResultMessage,
  requestInit,
}: StreamBucketsParams<TProgress>): Promise<TResult> {
  const response = await fetchStream(url, options?.signal, requestInit);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(sanitizeErrorMessage(text || `${streamFailedLabel} with status ${response.status}`, streamFailedLabel));
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    throw new Error("Unexpected stream response format");
  }
  if (!response.body) {
    throw new Error("Streaming response body is unavailable");
  }

  let resultPayload: TResult | null = null;

  await consumeSseStream(response.body, ({ event, data }) => {
    const payload = data ? (JSON.parse(data) as Record<string, unknown>) : {};
    if (event === "progress") {
      options?.onProgress?.(payload as unknown as TProgress);
    } else if (event === "result") {
      resultPayload = payload as unknown as TResult;
    } else if (event === "error") {
      const detail = typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail ?? payload);
      throw new Error(sanitizeErrorMessage(detail || streamFailedLabel, streamFailedLabel));
    }
  });

  if (!resultPayload) {
    throw new Error(missingResultMessage);
  }
  return resultPayload;
}
