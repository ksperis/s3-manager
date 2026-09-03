/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import client from "./client";
import { notifyAdminPendingRequestsRefresh } from "../utils/adminPendingRequestsRefresh";

export type SecurityCredential = { id: string; name: string; created_at: string; last_used_at?: string | null };
export type SecuritySession = {
  id: string;
  principal_type: string;
  auth_type: string;
  created_at: string;
  last_activity_at: string;
  idle_expires_at: string;
  absolute_expires_at: string;
  ip_address?: string | null;
  user_agent?: string | null;
  revoked_at?: string | null;
  current: boolean;
  user_id?: number | null;
  s3_session_id?: string | null;
};
export type AdminSecuritySession = SecuritySession & {
  user_email?: string | null;
  user_full_name?: string | null;
  user_role?: string | null;
};
export type ExternalIdentity = {
  id: string;
  provider_type: string;
  provider_id: string;
  email?: string | null;
  email_verified: boolean;
  created_at: string;
  last_login_at?: string | null;
};
export type ExternalLinkRequest = {
  id: string;
  user_id: number;
  user_email: string;
  user_role: string;
  provider_type: string;
  provider_id: string;
  email: string;
  status: string;
  created_at: string;
  expires_at: string;
};
export type AdminPasskey = SecurityCredential & { revoked_at?: string | null };
export type AdminExternalIdentity = ExternalIdentity & {
  subject: string;
  link_source: string;
  revoked_at?: string | null;
};
export type AdminUserSecurity = {
  user_id: number;
  email: string;
  role: string;
  has_local_password: boolean;
  passkey_required: boolean;
  passkeys: AdminPasskey[];
  external_identities: AdminExternalIdentity[];
  sessions: SecuritySession[];
};
type RecentWebAuthnVerification = { mfa_verified_at: string };

export async function listSecurityCredentials(): Promise<SecurityCredential[]> {
  return (await client.get<SecurityCredential[]>("/auth/security/webauthn/credentials")).data;
}
export async function beginSecurityPasskey(): Promise<Record<string, unknown> & { challenge: string }> {
  return (await client.post<Record<string, unknown> & { challenge: string }>("/auth/security/webauthn/registration/options")).data;
}
export async function finishSecurityPasskey(credential: unknown, name: string): Promise<void> {
  await client.post("/auth/security/webauthn/registration/verify", { credential, name });
}
export async function beginRecentWebAuthnVerification(): Promise<Record<string, unknown> & { challenge: string }> {
  return (await client.post<Record<string, unknown> & { challenge: string }>("/auth/security/webauthn/authentication/options")).data;
}
export async function finishRecentWebAuthnVerification(credential: unknown): Promise<RecentWebAuthnVerification> {
  return (await client.post<RecentWebAuthnVerification>("/auth/security/webauthn/authentication/verify", { credential })).data;
}
export async function revokeSecurityCredential(id: string): Promise<void> {
  await client.delete(`/auth/security/webauthn/credentials/${encodeURIComponent(id)}`);
}
export async function regenerateRecoveryCodes(): Promise<string[]> {
  return (await client.post<{ codes: string[] }>("/auth/security/recovery-codes")).data.codes;
}
export async function listSecuritySessions(): Promise<SecuritySession[]> {
  return (await client.get<SecuritySession[]>("/auth/sessions")).data;
}
export async function revokeSecuritySession(id: string): Promise<void> {
  await client.delete(`/auth/sessions/${encodeURIComponent(id)}`);
}
export async function logoutAllSessions(): Promise<void> {
  await client.post("/auth/logout-all");
}
export async function listExternalIdentities(): Promise<ExternalIdentity[]> {
  return (await client.get<ExternalIdentity[]>("/auth/security/external-identities")).data;
}
export async function revokeExternalIdentity(id: string): Promise<void> {
  await client.delete(`/auth/security/external-identities/${encodeURIComponent(id)}`);
}
export async function listAdminSessions(): Promise<AdminSecuritySession[]> {
  return (await client.get<AdminSecuritySession[]>("/admin/identity/sessions")).data;
}
export async function adminRevokeSession(id: string): Promise<void> {
  await client.delete(`/admin/identity/sessions/${encodeURIComponent(id)}`);
}
export async function listExternalLinkRequests(): Promise<ExternalLinkRequest[]> {
  return (await client.get<ExternalLinkRequest[]>("/admin/identity/link-requests")).data;
}
export async function decideExternalLinkRequest(id: string, approve: boolean): Promise<void> {
  try {
    await client.post(`/admin/identity/link-requests/${encodeURIComponent(id)}`, { approve });
  } finally {
    notifyAdminPendingRequestsRefresh();
  }
}

export async function getAdminUserSecurity(userId: number): Promise<AdminUserSecurity> {
  return (await client.get<AdminUserSecurity>(`/admin/users/${userId}/security`)).data;
}

export async function resetAdminUserMfa(userId: number): Promise<void> {
  await client.post(`/admin/users/${userId}/mfa/reset`);
}

export async function setAdminUserPassword(userId: number, password: string): Promise<void> {
  await client.put(`/admin/users/${userId}/security/password`, { password });
}

export async function addAdminExternalIdentity(
  userId: number,
  payload: {
    provider_type: "oidc" | "ldap";
    provider_id: string;
    subject: string;
    email?: string | null;
    email_verified?: boolean;
    restore?: boolean;
  },
): Promise<AdminExternalIdentity> {
  return (await client.post<AdminExternalIdentity>(`/admin/users/${userId}/external-identities`, payload)).data;
}

export async function revokeAdminExternalIdentity(userId: number, identityId: string): Promise<void> {
  await client.delete(`/admin/users/${userId}/external-identities/${encodeURIComponent(identityId)}`);
}

export async function restoreAdminExternalIdentity(userId: number, identityId: string): Promise<void> {
  await client.post(`/admin/users/${userId}/external-identities/${encodeURIComponent(identityId)}/restore`);
}

export async function revokeAdminUserSession(userId: number, sessionId: string): Promise<void> {
  await client.delete(`/admin/users/${userId}/security/sessions/${encodeURIComponent(sessionId)}`);
}
