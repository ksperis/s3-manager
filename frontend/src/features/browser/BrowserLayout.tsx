/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ChangeEvent } from "react";
import { Outlet } from "react-router-dom";
import Layout from "../../components/Layout";
import { S3AccountProvider, useS3AccountContext } from "../manager/S3AccountContext";
import { formatAccountLabel, useDefaultStorageEndpoint } from "../shared/storageEndpointLabel";

function BrowserShell() {
  const {
    accounts,
    selectedS3AccountId,
    setSelectedS3AccountId,
    requiresS3AccountSelection,
    sessionS3AccountName,
    selectedS3AccountType,
    accessError,
    iamIdentity,
    accessMode,
    setAccessMode,
    canSwitchAccess,
  } = useS3AccountContext();
  const selected = accounts.find((a) => a.id === selectedS3AccountId);
  const showSelector = requiresS3AccountSelection && accounts.length > 1;
  const { defaultEndpointId, defaultEndpointName } = useDefaultStorageEndpoint();
  const isAccessModeToggleVisible = accessMode === "admin" || accessMode === "portal";
  const canToggleAccess = canSwitchAccess && isAccessModeToggleVisible;
  const identityLabel = iamIdentity
    ? `Identité IAM: ${iamIdentity}`
    : selectedS3AccountType === "s3_user" && sessionS3AccountName
      ? `Compte utilisateur S3: ${sessionS3AccountName}`
      : "Identité non disponible";
  const baseControlClasses =
    "w-64 rounded-full border border-slate-200 bg-white px-3 py-1.5 ui-caption font-semibold text-slate-700 shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus-visible:ring-offset-slate-900";
  const selectClasses = `appearance-none pr-8 ${baseControlClasses}`;
  const pillClasses = `${baseControlClasses} ${selected ? "" : "text-slate-500 dark:text-slate-400"}`;

  const handleS3AccountChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value || null;
    if (value === selectedS3AccountId) return;
    setSelectedS3AccountId(value);
  };
  const handleAccessModeToggle = () => {
    if (!canToggleAccess) return;
    setAccessMode(accessMode === "admin" ? "portal" : "admin");
  };

  const inlineAction = (
    <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:gap-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Account</span>
        {requiresS3AccountSelection ? (
          showSelector ? (
            <div className="relative">
              <select
                className={selectClasses}
                value={selectedS3AccountId ?? ""}
                onChange={handleS3AccountChange}
              >
                {!selected && (
                  <option value="">
                    No account selected
                  </option>
                )}
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id} title={acc.storage_endpoint_url || undefined}>
                    {formatAccountLabel(acc, defaultEndpointId, defaultEndpointName)}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center ui-caption text-slate-500 dark:text-slate-300">
                ▼
              </div>
            </div>
          ) : (
            <div className={pillClasses} title={selected?.storage_endpoint_url || undefined}>
              {selected ? formatAccountLabel(selected, defaultEndpointId, defaultEndpointName) : "No account selected"}
            </div>
          )
        ) : (
          <div className={pillClasses}>{sessionS3AccountName || "RGW session"}</div>
        )}
        {selectedS3AccountType === "s3_user" && (
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 ui-caption font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-200">
            S3 user context
          </span>
        )}
      </div>
      {isAccessModeToggleVisible && (
        <div className="flex items-center gap-2">
          <span
            className={`ui-caption font-semibold ${
              canToggleAccess ? "text-slate-500 dark:text-slate-400" : "text-slate-400 dark:text-slate-500"
            }`}
          >
            Admin
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={accessMode === "admin"}
            onClick={handleAccessModeToggle}
            disabled={!canToggleAccess}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              accessMode === "admin"
                ? "bg-amber-400/80 dark:bg-amber-500/70"
                : "bg-slate-200 dark:bg-slate-700"
            } ${canToggleAccess ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
            aria-label={
              accessMode === "admin"
                ? canToggleAccess
                  ? "Mode admin actif, passer en portail"
                  : "Mode admin actif"
                : canToggleAccess
                  ? "Mode portail actif, passer en admin"
                  : "Mode portail actif"
            }
            title={
              accessMode === "admin"
                ? canToggleAccess
                  ? "Mode admin actif"
                  : "Mode admin actif"
                : canToggleAccess
                  ? "Mode portail actif"
                  : "Mode portail actif"
            }
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition ${
                accessMode === "admin" ? "translate-x-4" : "translate-x-1"
              }`}
            />
          </button>
          <span
            role="img"
            aria-label={identityLabel}
            title={identityLabel}
            className="flex h-6 w-6 items-center justify-center rounded-full ui-caption text-primary opacity-30 transition hover:bg-slate-200/70 hover:text-sky-600 hover:opacity-80 dark:hover:bg-slate-800/60"
          >
            ℹ️
          </span>
        </div>
      )}
    </div>
  );

  return (
    <Layout
      hideHeader
      hideSidebar
      topbarContent={inlineAction}
      mainClassName="pb-0"
      disableMainScroll
      fullHeight
    >
      <>
        {accessError && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 ui-body text-amber-800 shadow-sm dark:border-amber-900/40 dark:bg-amber-900/30 dark:text-amber-100">
            Accès refusé pour /browser. Vérifiez vos droits sur le compte ou contactez un administrateur.
          </div>
        )}
        <Outlet key={`${selectedS3AccountId ?? "session"}:${accessMode ?? "default"}`} />
      </>
    </Layout>
  );
}

export default function BrowserLayout() {
  return (
    <S3AccountProvider>
      <BrowserShell />
    </S3AccountProvider>
  );
}
