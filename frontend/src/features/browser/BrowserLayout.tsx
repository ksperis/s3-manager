/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ChangeEvent, useEffect, useState } from "react";
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
  const isAccessModeToggleVisible = accessMode === "admin" || accessMode === "portal";
  const canToggleAccess = canSwitchAccess && isAccessModeToggleVisible;
  const baseControlClasses =
    "w-48 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus-visible:ring-offset-slate-900";
  const selectClasses = `appearance-none pr-8 ${baseControlClasses}`;
  const pillClasses = `${baseControlClasses} ${selected ? "" : "text-slate-500 dark:text-slate-400"}`;
  const [showTopbar, setShowTopbar] = useState(false);

  useEffect(() => {
    if (!showTopbar) return;
    const handleBlur = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-topbar]") || target.closest("[data-topbar-toggle]")) return;
      setShowTopbar(false);
    };
    document.addEventListener("pointerdown", handleBlur, true);
    document.addEventListener("focusin", handleBlur, true);
    return () => {
      document.removeEventListener("pointerdown", handleBlur, true);
      document.removeEventListener("focusin", handleBlur, true);
    };
  }, [showTopbar]);

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
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">S3Account</span>
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
              <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[10px] text-slate-500 dark:text-slate-300">
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
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-200">
            S3 user context
          </span>
        )}
      </div>
      {isAccessModeToggleVisible && (
        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] font-semibold ${
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
        </div>
      )}
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setShowTopbar((prev) => !prev)}
        aria-label={showTopbar ? "Hide top bar" : "Show top bar"}
        aria-pressed={showTopbar}
        title={showTopbar ? "Hide top bar" : "Show top bar"}
        data-topbar-toggle
        className={`fixed left-1/2 top-2 z-30 -translate-x-1/2 rounded-full border px-2 py-1 text-[10px] font-semibold shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
          showTopbar
            ? "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            : "border-slate-200 bg-white/90 text-slate-600 hover:text-primary dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-200"
        }`}
      >
        <span aria-hidden="true">{showTopbar ? "▲" : "▼"}</span>
      </button>
      <Layout
        hideHeader
        hideSidebar
        hideTopbar={!showTopbar}
        topbarContent={inlineAction}
        mainClassName="pb-0"
        disableMainScroll
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
    </>
  );
}

export default function BrowserLayout() {
  return (
    <S3AccountProvider>
      <BrowserShell />
    </S3AccountProvider>
  );
}
