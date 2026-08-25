/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { OperationItem } from "./browserTypes";

type OperationStatusPillOptions = {
  hasFailed: boolean;
  isCompleted: boolean;
  queuedOnly: boolean;
  status: OperationItem["status"];
  completionStatus?: OperationItem["completionStatus"];
};

type OperationStatusPill = {
  label: string;
  classes: string;
};

const queuedOperationStatusClasses = "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";

export function operationInProgressStatusClasses(status: OperationItem["status"]) {
  if (status === "uploading") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200";
  if (status === "downloading") return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200";
  if (status === "copying") return "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-200";
  if (status === "deleting") return "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200";
  return queuedOperationStatusClasses;
}

export function operationCompletionLabel(status?: OperationItem["completionStatus"]) {
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";
  return "Completed";
}

function operationCompletionStatusClasses(status?: OperationItem["completionStatus"]) {
  if (status === "failed") return "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200";
  if (status === "cancelled") return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200";
  return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200";
}

export function buildOperationStatusPill(options: OperationStatusPillOptions): OperationStatusPill {
  if (options.hasFailed) {
    return { label: operationCompletionLabel("failed"), classes: operationCompletionStatusClasses("failed") };
  }
  if (options.isCompleted) {
    return {
      label: operationCompletionLabel(options.completionStatus),
      classes: operationCompletionStatusClasses(options.completionStatus),
    };
  }
  if (options.queuedOnly) {
    return { label: "Queued", classes: queuedOperationStatusClasses };
  }
  return { label: "In progress", classes: operationInProgressStatusClasses(options.status) };
}
