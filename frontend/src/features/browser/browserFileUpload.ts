/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios, { type AxiosProgressEvent } from "axios";

type PresignedFileUpload = {
  url: string;
  method: string;
  headers?: Record<string, string>;
};

type UploadBrowserFileParams = {
  file: File;
  mode: "direct" | "proxy";
  signal?: AbortSignal;
  onProgress: (event: AxiosProgressEvent) => void;
  uploadProxy: () => Promise<void>;
  presign: () => Promise<PresignedFileUpload>;
};

export const uploadBrowserFile = async ({
  file,
  mode,
  signal,
  onProgress,
  uploadProxy,
  presign,
}: UploadBrowserFileParams): Promise<void> => {
  if (mode === "proxy") {
    await uploadProxy();
    return;
  }

  const signedUpload = await presign();
  const method = signedUpload.method.toUpperCase();
  if (method !== "PUT") {
    throw new Error(`Unexpected presigned upload method: ${method}.`);
  }

  await axios.put(signedUpload.url, file, {
    headers: {
      ...(signedUpload.headers || {}),
      "Content-Type": file.type || "application/octet-stream",
    },
    onUploadProgress: onProgress,
    signal,
  });
};
