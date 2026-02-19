/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import Layout from "../../components/Layout";
import TopbarContextAccountSelector, {
  type ContextAccessMode,
} from "../../components/TopbarContextAccountSelector";
import { BrowserContextProvider, useBrowserContext } from "./BrowserContext";
import { fetchManagerContext } from "../../api/managerContext";
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
  const [identityAccessMode, setIdentityAccessMode] = useState<ContextAccessMode>(null);
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
    "h-9 w-60 rounded-xl border border-slate-200/80 bg-white px-3 ui-caption font-semibold text-slate-700 shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus-visible:ring-offset-slate-900";
  const pillClasses = `inline-flex items-center ${baseControlClasses} ${selected ? "" : "text-slate-500 dark:text-slate-400"}`;
  const selectedLabel = selected
    ? formatAccountLabel(selected, defaultEndpointId, defaultEndpointName)
    : "No account selected";

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

  const handleS3AccountChange = (selectedValue: string) => {
    const value = selectedValue || null;
    if (value === selectedContextId) return;
    setSelectedContextId(value);
  };

  const inlineAction = (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-3">
        <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Contexte</span>
        {showSelector ? (
          <TopbarContextAccountSelector
            contexts={visibleContexts}
            selectedContextId={selectedContextId}
            onContextChange={handleS3AccountChange}
            selectedLabel={selectedLabel}
            identityLabel={identityLabel}
            accessMode={identityAccessMode ?? "session"}
            defaultEndpointId={defaultEndpointId}
            defaultEndpointName={defaultEndpointName}
          />
        ) : (
          <div className={pillClasses} title={identityLabel ?? undefined}>
            {selectedLabel}
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
