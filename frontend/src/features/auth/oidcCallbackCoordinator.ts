/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { AuthenticationResponse } from "../../api/auth";

type CompleteOidcLogin = (
  providerId: string,
  code: string,
  state: string,
) => Promise<AuthenticationResponse>;

const inFlightCallbacks = new Map<string, Promise<AuthenticationResponse>>();

export function coordinateOidcCallback(
  providerId: string,
  code: string,
  state: string,
  complete: CompleteOidcLogin,
): Promise<AuthenticationResponse> {
  const key = `${providerId}\u0000${state}`;
  const existing = inFlightCallbacks.get(key);
  if (existing) return existing;

  const request = complete(providerId, code, state).finally(() => {
    if (inFlightCallbacks.get(key) === request) {
      inFlightCallbacks.delete(key);
    }
  });
  inFlightCallbacks.set(key, request);
  return request;
}
