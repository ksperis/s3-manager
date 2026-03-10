/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";

export function extractManagerError(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    return (error.response?.data as { detail?: string } | undefined)?.detail || error.message || fallback;
  }
  if (error instanceof Error) {
    return error.message || fallback;
  }
  return fallback;
}
