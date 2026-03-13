import client from "./client";

type StreamBucketsOptions<TProgress> = {
  signal?: AbortSignal;
  onProgress?: (event: TProgress) => void;
};

type StreamBucketsParams<TProgress> = {
  url: string;
  options?: StreamBucketsOptions<TProgress>;
  streamFailedLabel: string;
  missingResultMessage: string;
};

export function resolveApiBaseUrl(): string {
  const base = typeof client.defaults.baseURL === "string" && client.defaults.baseURL.trim() ? client.defaults.baseURL : "/api";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

function isCancelledError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (typeof err !== "object" || err === null) return false;
  const name = "name" in err ? String((err as { name?: unknown }).name ?? "") : "";
  const code = "code" in err ? String((err as { code?: unknown }).code ?? "") : "";
  return name === "CanceledError" || code === "ERR_CANCELED";
}

function buildHeaders(): Headers {
  const headers = new Headers({ Accept: "text/event-stream" });
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

async function fetchStream(url: string, signal?: AbortSignal): Promise<Response> {
  let response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(),
    credentials: "include",
    signal,
  });

  if (response.status === 401 || response.status === 419) {
    try {
      const refresh = await client.post<{ access_token: string; token_type: string }>("/auth/refresh", undefined, { signal });
      if (typeof window !== "undefined") {
        localStorage.setItem("token", refresh.data.access_token);
      }
      response = await fetch(url, {
        method: "GET",
        headers: buildHeaders(),
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
}: StreamBucketsParams<TProgress>): Promise<TResult> {
  const response = await fetchStream(url, options?.signal);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${streamFailedLabel} with status ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    throw new Error(`Unexpected stream response content type: ${contentType}`);
  }
  if (!response.body) {
    throw new Error("Streaming response body is unavailable");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "message";
  let currentDataLines: string[] = [];
  let resultPayload: TResult | null = null;

  const handleEvent = () => {
    if (currentDataLines.length === 0) {
      currentEvent = "message";
      return;
    }
    const payloadText = currentDataLines.join("\n");
    currentDataLines = [];
    const payload = payloadText ? (JSON.parse(payloadText) as Record<string, unknown>) : {};
    if (currentEvent === "progress") {
      options?.onProgress?.(payload as unknown as TProgress);
    } else if (currentEvent === "result") {
      resultPayload = payload as unknown as TResult;
    } else if (currentEvent === "error") {
      const detail = typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail ?? payload);
      throw new Error(detail || streamFailedLabel);
    }
    currentEvent = "message";
  };

  const processLine = (line: string) => {
    if (line === "") {
      handleEvent();
      return;
    }
    if (line.startsWith(":")) {
      return;
    }
    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim() || "message";
      return;
    }
    if (line.startsWith("data:")) {
      currentDataLines.push(line.slice(5).trimStart());
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    buffer = buffer.replace(/\r\n/g, "\n");
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      processLine(line);
      newlineIndex = buffer.indexOf("\n");
    }
    if (done) {
      if (buffer.length > 0) {
        processLine(buffer);
      }
      processLine("");
      break;
    }
  }

  if (!resultPayload) {
    throw new Error(missingResultMessage);
  }
  return resultPayload;
}
