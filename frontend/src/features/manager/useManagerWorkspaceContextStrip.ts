/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import type { ReactNode } from "react";
import type { ExecutionContext } from "../../api/executionContexts";
import { getContextAccessModeVisual } from "../../components/TopbarContextAccountSelector";
import type { WorkspaceContextStripAlert, WorkspaceContextStripItem } from "../../components/WorkspaceContextStrip";
import { formatAccountLabel, useDefaultStorageEndpoint } from "../shared/storageEndpointLabel";
import { useS3AccountContext } from "./S3AccountContext";

type ManagerWorkspaceContextStripOptions = {
  description: ReactNode;
  extraItems?: WorkspaceContextStripItem[];
  extraAlerts?: WorkspaceContextStripAlert[];
  title?: ReactNode;
};

function getContextTypeLabel(selectedContext: ExecutionContext | undefined, requiresS3AccountSelection: boolean): string {
  if (!requiresS3AccountSelection) {
    return "Session";
  }
  if (selectedContext?.kind === "connection") {
    return "S3 connection";
  }
  if (selectedContext?.kind === "legacy_user") {
    return "Legacy S3 user";
  }
  if (selectedContext?.kind === "account") {
    return "RGW account";
  }
  return "Unavailable";
}

export default function useManagerWorkspaceContextStrip({
  description,
  extraItems = [],
  extraAlerts = [],
  title,
}: ManagerWorkspaceContextStripOptions) {
  const {
    accounts = [],
    selectedS3AccountId = null,
    requiresS3AccountSelection = true,
    sessionS3AccountName = null,
    iamIdentity = null,
    accessMode = null,
    accessError = null,
  } = useS3AccountContext();
  const { defaultEndpointId, defaultEndpointName } = useDefaultStorageEndpoint();

  return useMemo(() => {
    const selectedContext = accounts.find((account) => account.id === selectedS3AccountId);
    const accessVisual = getContextAccessModeVisual(accessMode);
    const resolvedTitle =
      title ??
      (selectedContext
        ? formatAccountLabel(selectedContext, defaultEndpointId, defaultEndpointName)
        : requiresS3AccountSelection
          ? "No account selected"
          : sessionS3AccountName ?? "Session context");
    const resolvedIdentity = iamIdentity ?? sessionS3AccountName ?? "Unavailable";

    return {
      label: "Execution context",
      title: resolvedTitle,
      description,
      items: [
        {
          label: "Context type",
          value: getContextTypeLabel(selectedContext, requiresS3AccountSelection),
        },
        {
          label: "Endpoint",
          value: selectedContext?.endpoint_name ?? defaultEndpointName ?? "Default endpoint",
        },
        {
          label: "Execution mode",
          value: accessVisual.label,
          tone: accessMode === "admin" ? "warning" : accessMode === "connection" ? "primary" : "neutral",
        },
        {
          label: "IAM identity",
          value: resolvedIdentity,
          mono: Boolean(iamIdentity),
        },
        ...extraItems,
      ],
      alerts: [
        ...(requiresS3AccountSelection && !selectedContext
          ? [{ tone: "warning" as const, message: "Select an account before loading data or applying configuration." }]
          : []),
        ...(accessError ? [{ tone: "danger" as const, message: accessError }] : []),
        ...extraAlerts,
      ],
    };
  }, [
    accessMode,
    accounts,
    defaultEndpointId,
    defaultEndpointName,
    description,
    extraAlerts,
    extraItems,
    accessError,
    iamIdentity,
    requiresS3AccountSelection,
    selectedS3AccountId,
    sessionS3AccountName,
    title,
  ]);
}
