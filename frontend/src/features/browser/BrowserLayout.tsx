/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ChangeEvent } from "react";
import { Outlet } from "react-router-dom";
import Layout from "../../components/Layout";
import { BrowserContextProvider, useBrowserContext } from "./BrowserContext";
import { formatAccountLabel, useDefaultStorageEndpoint } from "../shared/storageEndpointLabel";

function BrowserShell() {
  const {
    contexts,
    selectedContextId,
    setSelectedContextId,
    selectedKind,
    accessError,
  } = useBrowserContext();
  const selected = contexts.find((a) => a.id === selectedContextId);
  const showSelector = contexts.length > 1;
  const { defaultEndpointId, defaultEndpointName } = useDefaultStorageEndpoint();
  const identityLabel = selected?.endpoint ? `Endpoint: ${selected.endpoint}` : "Endpoint non disponible";
  const baseControlClasses =
    "w-64 rounded-full border border-slate-200 bg-white px-3 py-1.5 ui-caption font-semibold text-slate-700 shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus-visible:ring-offset-slate-900";
  const selectClasses = `appearance-none pr-8 ${baseControlClasses}`;
  const pillClasses = `${baseControlClasses} ${selected ? "" : "text-slate-500 dark:text-slate-400"}`;

  const handleS3AccountChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value || null;
    if (value === selectedContextId) return;
    setSelectedContextId(value);
  };

  const inlineAction = (
    <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:gap-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Contexte</span>
        {showSelector ? (
            <div className="relative">
              <select
                className={selectClasses}
                value={selectedContextId ?? ""}
                onChange={handleS3AccountChange}
              >
                {!selected && (
                  <option value="">
                    No account selected
                  </option>
                )}
                {contexts.map((ctx) => (
                  <option key={ctx.id} value={ctx.id} title={ctx.endpoint || undefined}>
                    {ctx.kind === "connection"
                      ? `Connection: ${ctx.name}`
                      : ctx.raw
                        ? formatAccountLabel(ctx.raw as any, defaultEndpointId, defaultEndpointName)
                        : ctx.name}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center ui-caption text-slate-500 dark:text-slate-300">
                ▼
              </div>
            </div>
          ) : (
            <div className={pillClasses} title={selected?.endpoint || undefined}>
              {selected ? (selected.kind === "connection" ? `Connection: ${selected.name}` : selected.name) : "No context selected"}
            </div>
          )}
        {selectedKind === "s3_user" && (
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 ui-caption font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-200">
            S3 user context
          </span>
        )}
      </div>
      <span
        role="img"
        aria-label={identityLabel}
        title={identityLabel}
        className="flex h-6 w-6 items-center justify-center rounded-full ui-caption text-primary opacity-30 transition hover:bg-slate-200/70 hover:text-sky-600 hover:opacity-80 dark:hover:bg-slate-800/60"
      >
        ℹ️
      </span>
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
        <Outlet key={`${selectedContextId ?? "none"}`} />
      </>
    </Layout>
  );
}

export default function BrowserLayout() {
  return (
    <BrowserContextProvider>
      <BrowserShell />
    </BrowserContextProvider>
  );
}
