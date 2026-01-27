/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type OnboardingStatus = {
  dismissed: boolean;
  can_dismiss: boolean;
  seed_user_configured: boolean;
  endpoint_configured: boolean;
};

export async function fetchOnboardingStatus(): Promise<OnboardingStatus> {
  const { data } = await client.get<OnboardingStatus>("/admin/onboarding");
  return data;
}

export async function dismissOnboarding(): Promise<OnboardingStatus> {
  const { data } = await client.post<OnboardingStatus>("/admin/onboarding/dismiss");
  return data;
}
