/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export const iconButtonClasses =
  "inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-200";
export const iconButtonDangerClasses =
  "inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-200 text-rose-600 transition hover:bg-rose-50 hover:text-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 disabled:opacity-40 dark:border-rose-500/50 dark:text-rose-200 dark:hover:bg-rose-900/30 dark:hover:text-rose-100";
export const bulkActionClasses =
  "inline-flex items-center gap-2 rounded-full border border-slate-200 px-2.5 py-1 ui-caption font-semibold text-slate-700 transition hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100";
export const bulkDangerClasses =
  "inline-flex items-center gap-2 rounded-full border border-rose-200 px-2.5 py-1 ui-caption font-semibold text-rose-700 transition hover:bg-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 disabled:opacity-50 dark:border-rose-500/50 dark:text-rose-200 dark:hover:bg-rose-900/30";
export const toolbarButtonClasses =
  "inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 ui-caption font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-100";
export const toolbarPrimaryClasses =
  "inline-flex items-center gap-2 rounded-md bg-primary px-2.5 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
export const filterChipClasses =
  "inline-flex items-center gap-2 rounded-full border border-slate-200 px-2.5 py-0.5 ui-caption font-semibold text-slate-600 transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-100";
export const filterChipActiveClasses =
  "border-primary-200 bg-primary-100 text-primary-800 dark:border-primary-600 dark:bg-primary-500/20 dark:text-primary-100";
export const countBadgeClasses =
  "inline-flex w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 px-1 ui-caption font-semibold text-slate-600 tabular-nums dark:bg-slate-800 dark:text-slate-200";
export const operationStopClasses =
  "inline-flex items-center justify-center whitespace-nowrap rounded-full border border-rose-200 px-2 py-0.5 ui-caption font-semibold text-rose-600 transition hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50 dark:border-rose-500/50 dark:text-rose-200 dark:hover:bg-rose-900/30";
export const operationSecondaryClasses =
  "inline-flex items-center justify-center whitespace-nowrap rounded-full border border-slate-200 px-2 py-0.5 ui-caption font-semibold text-slate-600 transition hover:border-primary hover:text-primary disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-100";
export const viewToggleBaseClasses =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-100";
export const viewToggleActiveClasses = "bg-primary-100 text-primary-700 dark:bg-primary-500/20 dark:text-primary-100";
export const formInputClasses =
  "w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 ui-caption text-slate-700 shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
export const breadcrumbIconButtonClasses =
  "inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:border-primary-500 dark:hover:text-primary-200";
export const contextMenuBaseClasses =
  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left ui-caption font-semibold transition";
export const contextMenuItemClasses =
  `${contextMenuBaseClasses} text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800`;
export const contextMenuItemDangerClasses =
  `${contextMenuBaseClasses} text-rose-600 hover:bg-rose-50 dark:text-rose-200 dark:hover:bg-rose-900/30`;
export const contextMenuItemDisabledClasses = "cursor-not-allowed opacity-50";
export const contextMenuSeparatorClasses = "my-1 border-t border-slate-200 dark:border-slate-700";

export const bucketButtonClasses =
  "inline-flex max-w-[220px] items-center gap-1 rounded-md px-1 py-0.5 ui-caption font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 disabled:hover:bg-transparent dark:text-slate-200 dark:hover:bg-slate-800";
export const treeToggleButtonClasses =
  "inline-flex h-4 w-4 items-center justify-center rounded border border-slate-200 ui-caption font-semibold text-slate-500 transition hover:border-primary hover:text-primary disabled:opacity-40 dark:border-slate-700 dark:text-slate-400 dark:hover:border-primary-500 dark:hover:text-primary-200";
export const treeItemBaseClasses =
  "flex min-w-0 flex-1 max-w-full items-center gap-2 overflow-hidden rounded-md px-1.5 py-0.5 text-left ui-caption font-semibold transition";
export const treeItemActiveClasses =
  "bg-primary-100 text-primary-800 dark:bg-primary-500/20 dark:text-primary-100";
export const treeItemInactiveClasses =
  "text-slate-600 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100";

export const storageClassChipClasses: Record<string, string> = {
  STANDARD: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-900/20 dark:text-emerald-200",
  STANDARD_IA: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-900/20 dark:text-sky-200",
  GLACIER: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-900/20 dark:text-indigo-200",
};

export const storageClassOptions = [
  { value: "STANDARD", label: "STANDARD" },
  { value: "STANDARD_IA", label: "STANDARD_IA" },
  { value: "ONEZONE_IA", label: "ONEZONE_IA" },
  { value: "INTELLIGENT_TIERING", label: "INTELLIGENT_TIERING" },
  { value: "GLACIER", label: "GLACIER" },
  { value: "GLACIER_IR", label: "GLACIER_IR" },
  { value: "DEEP_ARCHIVE", label: "DEEP_ARCHIVE" },
];

export const aclOptions = [
  { value: "private", label: "private" },
  { value: "public-read", label: "public-read" },
  { value: "public-read-write", label: "public-read-write" },
  { value: "authenticated-read", label: "authenticated-read" },
  { value: "bucket-owner-read", label: "bucket-owner-read" },
  { value: "bucket-owner-full-control", label: "bucket-owner-full-control" },
  { value: "aws-exec-read", label: "aws-exec-read" },
];

export const MULTIPART_THRESHOLD = 25 * 1024 * 1024;
export const PART_SIZE = 8 * 1024 * 1024;
export const BUCKET_MENU_LIMIT = 50;
export const MULTIPART_CONCURRENCY = 4;
export const DEFAULT_DIRECT_UPLOAD_PARALLELISM = 5;
export const DEFAULT_PROXY_UPLOAD_PARALLELISM = 2;
export const DEFAULT_DIRECT_DOWNLOAD_PARALLELISM = 5;
export const DEFAULT_PROXY_DOWNLOAD_PARALLELISM = 2;
export const DEFAULT_OTHER_OPERATIONS_PARALLELISM = 3;
export const DEFAULT_QUEUED_VISIBLE_COUNT = 10;
export const COMPLETED_OPERATIONS_LIMIT = 20;
export const OBJECTS_PAGE_SIZE = 200;
export const VERSIONS_PAGE_SIZE = 200;
export const MULTIPART_UPLOADS_PAGE_SIZE = 50;
export const TREE_PREFIXES_PAGE_SIZE = 200;
export const OBJECTS_LIST_HARD_LIMIT = 5000;
export const VERSIONS_LIST_HARD_LIMIT = 5000;
export const MULTIPART_UPLOADS_HARD_LIMIT = 2000;
export const TREE_PREFIXES_HARD_LIMIT = 5000;
export const NAME_COLUMN_CONTROLS_MIN_WIDTH = 360;
