/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Outlet } from "react-router-dom";
import Layout from "../../components/Layout";
import type { SidebarBodyRenderArgs } from "../../components/Sidebar";
import TopbarContextAccountSelector, {
  type ContextAccessMode,
} from "../../components/TopbarContextAccountSelector";
import { BrowserContextProvider, useBrowserContext } from "./BrowserContext";
import { fetchManagerContext } from "../../api/managerContext";
import { formatAccountLabel, useDefaultStorageEndpoint } from "../shared/storageEndpointLabel";
import type { TopbarControlDescriptor } from "../../components/topbarControlsLayout";
import {
  TOPBAR_CONTEXT_SELECTOR_ESTIMATED_LABEL_WIDTH,
  TOPBAR_CONTEXT_SELECTOR_ICON_WIDTH_CLASS,
  TOPBAR_CONTEXT_SELECTOR_VALUE_WIDTH_CLASS,
  TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS,
} from "../../components/topbarControlWidths";

export type BrowserSidebarBodyRenderer = (args: SidebarBodyRenderArgs) => ReactNode;

type BrowserSidebarSlotContextValue = {
  setSidebarBody: (renderer: BrowserSidebarBodyRenderer | null) => void;
};

const BrowserSidebarSlotContext = createContext<BrowserSidebarSlotContextValue>({
  setSidebarBody: () => undefined,
});

export function useBrowserSidebarSlot(): BrowserSidebarSlotContextValue {
  return useContext(BrowserSidebarSlotContext);
}

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
  const [sidebarBody, setSidebarBodyState] = useState<BrowserSidebarBodyRenderer | null>(null);
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
  const setSidebarBody = useCallback((renderer: BrowserSidebarBodyRenderer | null) => {
    setSidebarBodyState(() => renderer);
  }, []);
  const sidebarSlotValue = useMemo(
    () => ({ setSidebarBody }),
    [setSidebarBody],
  );

  const renderStaticAccountPill = (mode: "icon" | "icon_label") => {
    if (mode === "icon") {
      return (
        <button
          type="button"
          aria-label={`Account context ${selectedLabel}`}
          title={identityLabel ?? selectedLabel}
          className="shell-control inline-flex h-9 w-9 items-center justify-center rounded-lg border"
        >
          <AccountControlIcon className="h-4 w-4" />
        </button>
      );
    }
    return (
      <div
        className={`shell-control inline-flex h-10 ${TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS} items-center gap-2.5 rounded-lg border px-3 text-left ${
          selected ? "" : "shell-muted-text"
        }`}
        title={identityLabel ?? undefined}
      >
        <span className="min-w-0 flex-1 leading-tight">
          <span className="shell-muted-text block truncate text-[10px] font-medium">
            Account
          </span>
          <span className={`mt-0.5 block ${TOPBAR_CONTEXT_SELECTOR_VALUE_WIDTH_CLASS} truncate text-[12px] font-semibold leading-4 text-[var(--shell-text)]`}>{selectedLabel}</span>
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
      estimatedLabelWidth: TOPBAR_CONTEXT_SELECTOR_ESTIMATED_LABEL_WIDTH,
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
            widthClassName={mode === "icon" ? TOPBAR_CONTEXT_SELECTOR_ICON_WIDTH_CLASS : TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS}
            icon={<AccountControlIcon className="h-4 w-4" />}
            triggerMode={mode}
          />
        ) : (
          renderStaticAccountPill(mode)
        ),
    },
  ];

  return (
    <BrowserSidebarSlotContext.Provider value={sidebarSlotValue}>
      <Layout
        headerTitle="Browser"
        sidebarTitle="Browser"
        hideHeader
        hideSidebar={!sidebarBody}
        renderSidebarBody={sidebarBody ?? undefined}
        topbarControlDescriptors={topbarControlDescriptors}
        mainClassName="pb-0"
        disableMainScroll
        fullHeight
      >
        <Outlet key={`${selectedContextId ?? "none"}`} />
      </Layout>
    </BrowserSidebarSlotContext.Provider>
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
