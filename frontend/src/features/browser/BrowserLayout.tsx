/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ChangeEvent } from "react";
import { Outlet } from "react-router-dom";
import Layout from "../../components/Layout";
import { S3AccountProvider, useS3AccountContext } from "../manager/S3AccountContext";

function BrowserShell() {
  const {
    accounts,
    selectedS3AccountId,
    setSelectedS3AccountId,
    requiresS3AccountSelection,
    sessionS3AccountName,
    selectedS3AccountType,
    accessError,
    accessMode,
    setAccessMode,
    canSwitchAccess,
  } = useS3AccountContext();
  const selected = accounts.find((a) => a.id === selectedS3AccountId);
  const showSelector = requiresS3AccountSelection && accounts.length > 1;
  const showAccessToggle = canSwitchAccess && (accessMode === "admin" || accessMode === "portal");
  const baseControlClasses =
    "w-56 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus-visible:ring-offset-slate-900";
  const selectClasses = `appearance-none pr-10 ${baseControlClasses}`;
  const pillClasses = `${baseControlClasses} ${selected ? "" : "text-slate-500 dark:text-slate-400"}`;
  const badgeClasses =
    "inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

  const handleS3AccountChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value || null;
    if (value === selectedS3AccountId) return;
    setSelectedS3AccountId(value);
  };
  const handleAccessModeToggle = () => {
    if (!showAccessToggle) return;
    setAccessMode(accessMode === "admin" ? "portal" : "admin");
  };

  const inlineAction = (
    <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:gap-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">S3Account</span>
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
                  <option key={acc.id} value={acc.id}>
                    {acc.name} {!acc.rgw_account_id ? "(S3 user)" : ""}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs text-slate-500 dark:text-slate-300">
                ▼
              </div>
            </div>
          ) : (
            <div className={pillClasses}>
              {selected ? `${selected.name}${!selected.rgw_account_id ? " · S3 user" : ""}` : "No account selected"}
            </div>
          )
        ) : (
          <div className={pillClasses}>{sessionS3AccountName || "RGW session"}</div>
        )}
        {selectedS3AccountType === "s3_user" && (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-200">
            S3 user context
          </span>
        )}
      </div>
      {accessMode && (accessMode === "admin" || accessMode === "portal") && (showAccessToggle || accessMode === "admin") && (
        <button
          type="button"
          onClick={handleAccessModeToggle}
          disabled={!showAccessToggle}
          className={`${badgeClasses} ${
            accessMode === "admin"
              ? "border-amber-300/80 bg-amber-50 text-amber-700 hover:border-amber-400 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
              : "border-slate-200/70 bg-white/80 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200"
          } ${showAccessToggle ? "" : "cursor-default opacity-80"}`}
          aria-label={
            accessMode === "admin"
              ? showAccessToggle
                ? "Mode admin actif, passer en portail"
                : "Mode admin actif"
              : "Mode portail actif, passer en admin"
          }
          title={
            accessMode === "admin"
              ? showAccessToggle
                ? "Mode admin actif"
                : "Mode admin actif"
              : "Mode portail actif"
          }
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3l7 3v6c0 5-3.5 7.5-7 9-3.5-1.5-7-4-7-9V6l7-3z" />
          </svg>
        </button>
      )}
    </div>
  );

  return (
    <Layout
      hideHeader
      hideSidebar
      topbarContent={inlineAction}
    >
      <>
        {accessError && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-sm dark:border-amber-900/40 dark:bg-amber-900/30 dark:text-amber-100">
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
