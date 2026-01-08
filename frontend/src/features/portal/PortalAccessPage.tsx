/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import { usePortalAccountContext } from "./PortalAccountContext";
import {
  PortalExternalAccessCredentials,
  PortalExternalAccessStatus,
  assignAccessGrant,
  enableMyExternalAccess,
  enableUserExternalAccess,
  fetchUserExternalAccess,
  fetchMyExternalAccess,
  revokeAccessGrant,
  revokeMyExternalAccess,
  revokeUserExternalAccess,
  rotateMyExternalAccessKey,
  rotateUserExternalAccessKey,
} from "../../api/portalAccess";
import { listPortalMembers, PortalMember } from "../../api/portal";

function CopyButton({ value, label }: { value: string; label: string }) {
  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // ignore
    }
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center justify-center rounded-md bg-slate-900 px-2 py-1 ui-caption font-semibold text-white shadow-sm transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
    >
      {label}
    </button>
  );
}

export default function PortalAccessPage() {
  const { accountIdForApi, portalContext, reloadAccounts, reloadPortalContext } = usePortalAccountContext();
  const canSelf = portalContext?.permissions?.includes("portal.external.self.manage") ?? false;
  const canTeam = portalContext?.permissions?.includes("portal.external.team.manage") ?? false;

  const [status, setStatus] = useState<PortalExternalAccessStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSecret, setLastSecret] = useState<PortalExternalAccessCredentials | null>(null);

  const load = useCallback(async () => {
    if (!accountIdForApi) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMyExternalAccess(accountIdForApi);
      setStatus(data);
    } catch (err) {
      console.error(err);
      setStatus(null);
      setError("Unable to load external access status.");
    } finally {
      setLoading(false);
    }
  }, [accountIdForApi]);

  useEffect(() => {
    void load();
  }, [load]);

  const allowExternal = status?.allow_external_access ?? false;
  const externalEnabled = status?.external_enabled ?? false;
  const allowedPackages = status?.allowed_packages ?? [];

  const handleEnable = async () => {
    if (!accountIdForApi) return;
    setError(null);
    setLastSecret(null);
    try {
      const creds = await enableMyExternalAccess(accountIdForApi);
      setLastSecret(creds);
      await load();
      await reloadPortalContext();
      await reloadAccounts();
    } catch (err) {
      console.error(err);
      setError("Unable to enable external access.");
    }
  };

  const handleRotate = async () => {
    if (!accountIdForApi) return;
    setError(null);
    setLastSecret(null);
    try {
      const creds = await rotateMyExternalAccessKey(accountIdForApi);
      setLastSecret(creds);
      await load();
      await reloadPortalContext();
      await reloadAccounts();
    } catch (err) {
      console.error(err);
      setError("Unable to rotate key.");
    }
  };

  const handleRevoke = async () => {
    if (!accountIdForApi) return;
    setError(null);
    setLastSecret(null);
    try {
      await revokeMyExternalAccess(accountIdForApi);
      await load();
      await reloadPortalContext();
      await reloadAccounts();
    } catch (err) {
      console.error(err);
      setError("Unable to revoke external access.");
    }
  };

  const [members, setMembers] = useState<PortalMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [selectedUserStatus, setSelectedUserStatus] = useState<PortalExternalAccessStatus | null>(null);
  const [packageKey, setPackageKey] = useState<string>("BucketReadOnly");
  const [bucket, setBucket] = useState<string>("");
  const [grantStatus, setGrantStatus] = useState<string | null>(null);
  const [grantError, setGrantError] = useState<string | null>(null);

  const loadTeam = useCallback(async () => {
    if (!accountIdForApi || !canTeam) {
      setMembers([]);
      return;
    }
    setTeamLoading(true);
    setTeamError(null);
    try {
      const data = await listPortalMembers(accountIdForApi);
      setMembers(data);
      if (!selectedUserId && data.length > 0) {
        setSelectedUserId(data[0].user_id);
      }
    } catch (err) {
      console.error(err);
      setTeamError("Unable to load members.");
      setMembers([]);
    } finally {
      setTeamLoading(false);
    }
  }, [accountIdForApi, canTeam, selectedUserId]);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  const loadSelectedUser = useCallback(async () => {
    if (!accountIdForApi || !canTeam || !selectedUserId) {
      setSelectedUserStatus(null);
      return;
    }
    try {
      const data = await fetchUserExternalAccess(accountIdForApi, selectedUserId);
      setSelectedUserStatus(data);
    } catch (err) {
      console.error(err);
      setSelectedUserStatus(null);
    }
  }, [accountIdForApi, canTeam, selectedUserId]);

  useEffect(() => {
    void loadSelectedUser();
  }, [loadSelectedUser]);

  const teamPackageOptions = useMemo(() => {
    const base = ["BucketReadOnly", "BucketReadWrite", "BucketAdmin"];
    if (portalContext?.portal_role === "AccessAdmin" && allowedPackages.length > 0) {
      return base.filter((p) => allowedPackages.includes(p));
    }
    return base;
  }, [allowedPackages, portalContext?.portal_role]);

  const handleEnableUser = async (userId: number) => {
    if (!accountIdForApi) return;
    setGrantError(null);
    setGrantStatus(null);
    try {
      const creds = await enableUserExternalAccess(accountIdForApi, userId);
      setLastSecret(creds);
      await load();
      await loadTeam();
      if (selectedUserId === userId) {
        await loadSelectedUser();
      }
    } catch (err) {
      console.error(err);
      setGrantError("Unable to enable external access for user.");
    }
  };

  const handleRotateUser = async (userId: number) => {
    if (!accountIdForApi) return;
    setGrantError(null);
    setGrantStatus(null);
    try {
      const creds = await rotateUserExternalAccessKey(accountIdForApi, userId);
      setLastSecret(creds);
      await load();
      if (selectedUserId === userId) {
        await loadSelectedUser();
      }
    } catch (err) {
      console.error(err);
      setGrantError("Unable to rotate user key.");
    }
  };

  const handleRevokeUser = async (userId: number) => {
    if (!accountIdForApi) return;
    setGrantError(null);
    setGrantStatus(null);
    try {
      await revokeUserExternalAccess(accountIdForApi, userId);
      await load();
      await loadTeam();
      if (selectedUserId === userId) {
        await loadSelectedUser();
      }
    } catch (err) {
      console.error(err);
      setGrantError("Unable to revoke user external access.");
    }
  };

  const handleAssignGrant = async (event: FormEvent) => {
    event.preventDefault();
    if (!accountIdForApi || !selectedUserId) return;
    setGrantError(null);
    setGrantStatus(null);
    try {
      const result = await assignAccessGrant(accountIdForApi, {
        user_id: selectedUserId,
        package_key: packageKey,
        bucket: bucket.trim(),
      });
      setGrantStatus(`Grant ${result.materialization_status} (id=${result.id}).`);
      if (result.materialization_error) {
        setGrantError(result.materialization_error);
      }
      await load();
      await loadSelectedUser();
    } catch (err) {
      console.error(err);
      setGrantError("Unable to assign grant.");
    }
  };

  const handleRevokeGrant = async (userId: number, grantId: number) => {
    if (!accountIdForApi) return;
    setGrantError(null);
    setGrantStatus(null);
    try {
      await revokeAccessGrant(accountIdForApi, userId, grantId);
      setGrantStatus("Grant revoked.");
      await loadSelectedUser();
    } catch (err) {
      console.error(err);
      setGrantError("Unable to revoke grant.");
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="External access" description="Opt-in IAM credentials + access packages." />

      {!accountIdForApi && <PageBanner tone="warning">Select an account to manage access.</PageBanner>}
      {loading && <PageBanner tone="info">Loading…</PageBanner>}
      {error && <PageBanner tone="error">{error}</PageBanner>}

      {status && (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
            <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">My access</p>
            <div className="mt-2 space-y-2 ui-body text-slate-700 dark:text-slate-200">
              <div>External allowed: {allowExternal ? "Yes" : "No"}</div>
              <div>External enabled: {externalEnabled ? "Yes" : "No"}</div>
              <div>IAM username: {status.iam_username ?? "—"}</div>
            </div>

            {!allowExternal && (
              <PageBanner tone="warning" className="mt-3">
                External access is disabled for this endpoint.
              </PageBanner>
            )}

            {canSelf && allowExternal && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {!externalEnabled ? (
                  <button
                    type="button"
                    onClick={handleEnable}
                    className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600"
                  >
                    Enable external access
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={handleRotate}
                      className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 ui-caption font-semibold text-slate-700 shadow-sm transition hover:border-primary/60 hover:text-primary-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      Rotate key
                    </button>
                    <button
                      type="button"
                      onClick={handleRevoke}
                      className="inline-flex items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 ui-caption font-semibold text-rose-700 shadow-sm transition hover:bg-rose-100 dark:border-rose-900/40 dark:bg-rose-950/60 dark:text-rose-100"
                    >
                      Revoke
                    </button>
                  </>
                )}
              </div>
            )}

            {status.keys.length > 0 && (
              <div className="mt-4">
                <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Keys</p>
                <ul className="mt-2 space-y-2">
                  {status.keys.map((k) => (
                    <li key={k.access_key_id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 ui-caption dark:bg-slate-900">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">{k.access_key_id}</span>
                      <span className="text-slate-500 dark:text-slate-400">
                        {k.is_active ? "active" : "inactive"} {k.status ? `(${k.status})` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
            <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Packages</p>
            {status.grants.length === 0 ? (
              <p className="mt-2 ui-body text-slate-500 dark:text-slate-400">No access packages assigned.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {status.grants.map((g) => (
                  <li key={g.id} className="rounded-lg bg-slate-50 px-3 py-2 ui-caption dark:bg-slate-900">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        {g.package_key} on {g.bucket}
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">{g.materialization_status}</span>
                    </div>
                    {g.materialization_error && (
                      <div className="mt-1 text-rose-600 dark:text-rose-200">{g.materialization_error}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {allowedPackages.length > 0 && (
              <PageBanner tone="info" className="mt-3">
                Allowed packages for delegated admins: {allowedPackages.join(", ")}
              </PageBanner>
            )}
          </div>
        </div>
      )}

      {lastSecret && (
        <PageBanner tone="success">
          <div className="space-y-2">
            <div className="ui-body font-semibold">Secret shown once</div>
            <div className="flex flex-wrap items-center gap-2 ui-caption">
              <span className="font-semibold">Access key:</span> <span>{lastSecret.access_key_id}</span>
              <CopyButton value={lastSecret.access_key_id} label="Copy" />
            </div>
            <div className="flex flex-wrap items-center gap-2 ui-caption">
              <span className="font-semibold">Secret key:</span> <span>{lastSecret.secret_access_key}</span>
              <CopyButton value={lastSecret.secret_access_key} label="Copy" />
            </div>
          </div>
        </PageBanner>
      )}

      {canTeam && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Team access</p>
          {teamLoading && <PageBanner tone="info" className="mt-3">Loading members…</PageBanner>}
          {teamError && <PageBanner tone="error" className="mt-3">{teamError}</PageBanner>}
          {grantError && <PageBanner tone="error" className="mt-3">{grantError}</PageBanner>}
          {grantStatus && <PageBanner tone="info" className="mt-3">{grantStatus}</PageBanner>}

          {members.length > 0 && (
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full table-fixed">
                <thead className="bg-slate-50 dark:bg-slate-900">
                  <tr className="text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <th className="w-1/2 px-4 py-3">User</th>
                    <th className="w-1/4 px-4 py-3">Role</th>
                    <th className="w-1/4 px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.user_id} className="border-t border-slate-200/70 dark:border-slate-800">
                      <td className="px-4 py-3 ui-body text-slate-900 dark:text-slate-100">{m.email}</td>
                      <td className="px-4 py-3 ui-caption text-slate-500 dark:text-slate-400">{m.portal_role}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {!m.external_enabled ? (
                            <button
                              type="button"
                              onClick={() => void handleEnableUser(m.user_id)}
                              disabled={!allowExternal}
                              className="inline-flex items-center justify-center rounded-md bg-primary px-2 py-1 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Enable
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleRotateUser(m.user_id)}
                                className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-2 py-1 ui-caption font-semibold text-slate-700 shadow-sm transition hover:border-primary/60 hover:text-primary-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                              >
                                Rotate
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleRevokeUser(m.user_id)}
                                className="inline-flex items-center justify-center rounded-md border border-rose-200 bg-rose-50 px-2 py-1 ui-caption font-semibold text-rose-700 shadow-sm transition hover:bg-rose-100 dark:border-rose-900/40 dark:bg-rose-950/60 dark:text-rose-100"
                              >
                                Revoke
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form onSubmit={handleAssignGrant} className="mt-4 grid gap-3 md:grid-cols-4">
            <select
              value={selectedUserId ?? ""}
              onChange={(e) => setSelectedUserId(Number(e.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 ui-body text-slate-700 shadow-sm transition focus:border-primary focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              required
            >
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.email}
                </option>
              ))}
            </select>
            <select
              value={packageKey}
              onChange={(e) => setPackageKey(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 ui-body text-slate-700 shadow-sm transition focus:border-primary focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {teamPackageOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <input
              value={bucket}
              onChange={(e) => setBucket(e.target.value)}
              placeholder="Bucket name"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 ui-body text-slate-700 shadow-sm transition focus:border-primary focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              required
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600"
            >
              Assign package
            </button>
          </form>

          {selectedUserId && selectedUserStatus && (
            <div className="mt-4">
              <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Current grants
              </p>
              {selectedUserStatus.grants.length === 0 ? (
                <p className="mt-2 ui-body text-slate-500 dark:text-slate-400">No grants for selected user.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {selectedUserStatus.grants.map((g) => (
                    <li key={g.id} className="rounded-lg bg-slate-50 px-3 py-2 ui-caption dark:bg-slate-900">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          {g.package_key} on {g.bucket}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500 dark:text-slate-400">{g.materialization_status}</span>
                          <button
                            type="button"
                            onClick={() => void handleRevokeGrant(selectedUserId, g.id)}
                            className="inline-flex items-center justify-center rounded-md border border-rose-200 bg-rose-50 px-2 py-1 ui-caption font-semibold text-rose-700 shadow-sm transition hover:bg-rose-100 dark:border-rose-900/40 dark:bg-rose-950/60 dark:text-rose-100"
                          >
                            Revoke
                          </button>
                        </div>
                      </div>
                      {g.materialization_error && (
                        <div className="mt-1 text-rose-600 dark:text-rose-200">{g.materialization_error}</div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {!canSelf && !canTeam && (
        <PageBanner tone="warning">You do not have permission to manage external access.</PageBanner>
      )}
    </div>
  );
}
