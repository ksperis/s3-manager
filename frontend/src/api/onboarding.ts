/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type OnboardingStatus = {
  dismissed: boolean;
  complete: boolean;
  endpoint_configured: boolean;
  storage_access_configured: boolean;
};

export async function fetchOnboardingStatus(): Promise<OnboardingStatus> {
  const { data } = await client.get<OnboardingStatus>("/admin/onboarding");
  return data;
}

export async function dismissOnboarding(): Promise<OnboardingStatus> {
  const { data } = await client.post<OnboardingStatus>("/admin/onboarding/dismiss");
  return data;
}
