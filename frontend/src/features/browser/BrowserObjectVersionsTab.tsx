/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { BrowserObjectVersion } from "../../api/browserContracts";
import BrowserObjectVersionsList from "./BrowserObjectVersionsList";
import { toolbarButtonClasses } from "./browserConstants";

type BrowserObjectVersionsTabProps = {
  canLoadMore: boolean;
  error: string | null;
  loading: boolean;
  onDeleteVersion: (version: BrowserObjectVersion) => void;
  onLoadMore: () => void;
  onRefresh: () => void;
  onRestoreVersion: (version: BrowserObjectVersion) => void;
  readOnly: boolean;
  savingAction: boolean;
  versions: BrowserObjectVersion[];
};

export default function BrowserObjectVersionsTab({
  canLoadMore,
  error,
  loading,
  onDeleteVersion,
  onLoadMore,
  onRefresh,
  onRestoreVersion,
  readOnly,
  savingAction,
  versions,
}: BrowserObjectVersionsTabProps) {
  const busy = loading || savingAction;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="ui-caption text-slate-500 dark:text-slate-400">
          Inspect previous object states, delete markers, and restore the latest
          state when needed.
        </p>
        <button
          type="button"
          className={toolbarButtonClasses}
          onClick={onRefresh}
          disabled={busy}
        >
          Refresh
        </button>
      </div>
      <BrowserObjectVersionsList
        title="Versions"
        versions={versions}
        loading={busy}
        error={error}
        canLoadMore={canLoadMore}
        onLoadMore={onLoadMore}
        onRestoreVersion={onRestoreVersion}
        onDeleteVersion={onDeleteVersion}
        readOnly={readOnly}
      />
    </div>
  );
}
