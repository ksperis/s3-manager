/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ChangeEvent, useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import Layout from "../../components/Layout";
import { BrowserContextProvider, useBrowserContext } from "./BrowserContext";
import { fetchManagerContext, type ManagerAccessMode } from "../../api/managerContext";
import { formatAccountLabel, useDefaultStorageEndpoint } from "../shared/storageEndpointLabel";

function BrowserShell() {
  const {
    contexts,
    selectedContextId,
    setSelectedContextId,
    selectedKind,
    accessError,
  } = useBrowserContext();
  const [iamIdentity, setIamIdentity] = useState<string | null>(null);
  const [identityAccessMode, setIdentityAccessMode] = useState<ManagerAccessMode | null>(null);
  const visibleContexts = contexts.filter((ctx) => !ctx.hidden || ctx.id === selectedContextId);
  const selected = contexts.find((a) => a.id === selectedContextId);
  const showSelector = visibleContexts.length > 1;
  const { defaultEndpointId, defaultEndpointName } = useDefaultStorageEndpoint();
  const identityLabel = iamIdentity
    ? identityAccessMode === "connection"
      ? `Identité S3: ${iamIdentity}`
      : `Identité IAM: ${iamIdentity}`
    : null;
  const baseControlClasses =
    "w-64 rounded-full border border-slate-200 bg-white px-3 py-1.5 ui-caption font-semibold text-slate-700 shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus-visible:ring-offset-slate-900";
  const selectClasses = `appearance-none pr-8 ${baseControlClasses}`;
  const pillClasses = `${baseControlClasses} ${selected ? "" : "text-slate-500 dark:text-slate-400"}`;

  useEffect(() => {
    if (!selectedContextId) {
      setIamIdentity(null);
      setIdentityAccessMode(null);
      return;
    }
    let isMounted = true;
    fetchManagerContext(selectedContextId)
      .then((data) => {
        if (!isMounted) return;
        setIamIdentity(data.iam_identity ?? null);
        setIdentityAccessMode(data.access_mode);
      })
      .catch(() => {
        if (!isMounted) return;
        setIamIdentity(null);
        setIdentityAccessMode(null);
      });
    return () => {
      isMounted = false;
    };
  }, [selectedContextId]);

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
              title={identityLabel ?? undefined}
            >
              {!selected && (
                <option value="">
                  No account selected
                </option>
              )}
              {visibleContexts.map((ctx) => (
                <option key={ctx.id} value={ctx.id} title={ctx.endpoint_url || undefined}>
                  {formatAccountLabel(ctx, defaultEndpointId, defaultEndpointName)}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center ui-caption text-slate-500 dark:text-slate-300">
              ▼
            </div>
          </div>
        ) : (
          <div className={pillClasses} title={identityLabel ?? undefined}>
            {selected ? formatAccountLabel(selected, defaultEndpointId, defaultEndpointName) : "No context selected"}
          </div>
        )}
        {selectedKind === "legacy_user" && (
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 ui-caption font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-200">
            S3 user context
          </span>
        )}
      </div>
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
