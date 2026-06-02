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
import type { TopbarControlDescriptor } from "../../components/topbarControlsLayout";

function BrowserShell() {
  const {
    contexts,
    selectedContextId,
    setSelectedContextId,
    requiresContextSelection,
    sessionAccountName,
  } = useBrowserContext();
  const [iamIdentity, setIamIdentity] = useState<string | null>(null);
  const [identityAccessMode, setIdentityAccessMode] = useState<ContextAccessMode>(null);
  const visibleContexts = contexts.filter((ctx) => !ctx.hidden || ctx.id === selectedContextId);
  const selected = contexts.find((a) => a.id === selectedContextId);
  const showSelector = requiresContextSelection && visibleContexts.length > 1;
  const { defaultEndpointId, defaultEndpointName } = useDefaultStorageEndpoint();
  const identityLabel = iamIdentity
    ? identityAccessMode === "connection"
      ? `S3 Identity: ${iamIdentity}`
      : `IAM Identity: ${iamIdentity}`
    : null;
  const selectedLabel = selected
    ? formatAccountLabel(selected, defaultEndpointId, defaultEndpointName)
    : requiresContextSelection
      ? "No account selected"
      : sessionAccountName || "S3 session";

  useEffect(() => {
    if (!requiresContextSelection) {
      setIamIdentity(null);
      setIdentityAccessMode("session");
      return;
    }
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
  }, [requiresContextSelection, selectedContextId]);

  const handleS3AccountChange = (selectedValue: string) => {
    const value = selectedValue || null;
    if (value === selectedContextId) return;
    setSelectedContextId(value);
  };

  const renderStaticAccountPill = (mode: "icon" | "icon_label") => {
    if (mode === "icon") {
      return (
        <button
          type="button"
          aria-label={`Account context ${selectedLabel}`}
          title={identityLabel ?? selectedLabel}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <AccountControlIcon className="h-4 w-4" />
        </button>
      );
    }
    return (
      <div
        className={`inline-flex h-10 min-w-[12rem] items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-left shadow-sm dark:border-slate-700 dark:bg-slate-900 ${
          selected ? "text-slate-700 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"
        }`}
        title={identityLabel ?? undefined}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-100">
          <AccountControlIcon className="h-4 w-4" />
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
            Account
          </span>
          <span className="mt-px block max-w-[20rem] truncate text-[13px] font-semibold leading-4">{selectedLabel}</span>
        </span>
      </div>
    );
  };

  const topbarControlDescriptors: TopbarControlDescriptor[] = [
    {
      id: "account",
      icon: <AccountControlIcon className="h-4 w-4" />,
      selectedLabel,
      priority: 10,
      estimatedIconWidth: 36,
      estimatedLabelWidth: 228,
      renderControl: (mode) =>
        showSelector ? (
          <TopbarContextAccountSelector
            contexts={visibleContexts}
            selectedContextId={selectedContextId}
            onContextChange={handleS3AccountChange}
            selectedLabel={selectedLabel}
            identityLabel={identityLabel}
            defaultEndpointId={defaultEndpointId}
            defaultEndpointName={defaultEndpointName}
            widthClassName={mode === "icon" ? "w-10" : "w-48 lg:w-[20rem] xl:w-[28rem] min-w-[12rem] max-w-[48vw]"}
            triggerMode={mode}
          />
        ) : (
          renderStaticAccountPill(mode)
        ),
    },
  ];

  return (
    <Layout
      headerTitle="Browser"
      hideHeader
      hideSidebar
      topbarControlDescriptors={topbarControlDescriptors}
      mainClassName="pb-0"
      disableMainScroll
      fullHeight
    >
      <Outlet key={`${selectedContextId ?? "none"}`} />
    </Layout>
  );
}

function AccountControlIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" strokeWidth={1.5} />
      <path strokeLinecap="round" strokeWidth={1.5} d="M3 10h18" />
      <circle cx="8.5" cy="14.2" r="1.1" strokeWidth={1.4} />
      <path strokeLinecap="round" strokeWidth={1.5} d="M12 14.2h6" />
    </svg>
  );
}

export default function BrowserLayout() {
  return (
    <BrowserContextProvider>
      <BrowserShell />
    </BrowserContextProvider>
  );
}
