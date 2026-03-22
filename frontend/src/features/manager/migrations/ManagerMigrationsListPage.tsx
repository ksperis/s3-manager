/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import ListToolbar from "../../../components/ListToolbar";
import PageBanner from "../../../components/PageBanner";
import PageEmptyState from "../../../components/PageEmptyState";
import PageHeader from "../../../components/PageHeader";
import WorkspaceContextStrip from "../../../components/WorkspaceContextStrip";
import { type BucketMigrationStatus } from "../../../api/managerMigrations";
import { useS3AccountContext } from "../S3AccountContext";
import useManagerWorkspaceContextStrip from "../useManagerWorkspaceContextStrip";
import { useManagerContexts, useManagerMigrationsList } from "./hooks";
import {
  computeProgress,
  formatDateTime,
  statusChipClasses,
} from "./shared";

const SORT_PRIORITY: Record<BucketMigrationStatus, number> = {
  running: 0,
  queued: 1,
  pause_requested: 2,
  cancel_requested: 3,
  paused: 4,
  awaiting_cutover: 5,
  draft: 6,
  failed: 7,
  completed_with_errors: 8,
  canceled: 9,
  completed: 10,
  rolled_back: 11,
};

export default function ManagerMigrationsListPage() {
  const navigate = useNavigate();
  const { selectedS3AccountId, requiresS3AccountSelection } = useS3AccountContext();
  const sourceContextId = selectedS3AccountId ?? "";
  const contextStrip = useManagerWorkspaceContextStrip({
    description: "Bucket migrations use the active execution context as the source and let you track operational status for each run.",
  });

  const { contextLabelById, contextsLoading, contextsError } = useManagerContexts();
  const { migrations, migrationsLoading, migrationsError } = useManagerMigrationsList(sourceContextId);

  const sortedMigrations = useMemo(
    () =>
      [...migrations].sort((left, right) => {
      const priorityLeft = SORT_PRIORITY[left.status] ?? 99;
      const priorityRight = SORT_PRIORITY[right.status] ?? 99;
      if (priorityLeft !== priorityRight) return priorityLeft - priorityRight;
      return right.id - left.id;
    }),
    [migrations]
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bucket Migration"
        description="Track migrations and open an operational view for each run."
        breadcrumbs={[{ label: "Manager" }, { label: "Tools" }, { label: "Migration" }]}
        actions={[
          {
            label: "New migration",
            onClick: () => navigate("/manager/migrations/new"),
          },
        ]}
      />
      <WorkspaceContextStrip {...contextStrip} />

      {contextsLoading && <PageBanner tone="info">Loading contexts…</PageBanner>}
      {contextsError && <PageBanner tone="error">{contextsError}</PageBanner>}
      {migrationsError && <PageBanner tone="error">{migrationsError}</PageBanner>}

      {!requiresS3AccountSelection ? (
        <PageEmptyState
          title="Bucket migration is unavailable in session mode"
          description="This tool needs a persistent execution context so it can resolve source and target inventories before launching a migration."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : !sourceContextId ? (
        <PageEmptyState
          title="Select a source context before opening bucket migrations"
          description="Choose an execution context to list migration runs that originate from it and to start a new migration."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : (
        <section className="ui-surface-card">
          <ListToolbar
            title="Migrations"
            description="Operational list of migration runs for the active source context."
            countLabel={`${sortedMigrations.length} result(s)`}
          />
          <div className="max-h-[720px] space-y-2 overflow-auto p-4">
            {migrationsLoading && <p className="ui-caption text-slate-500 dark:text-slate-400">Loading migrations...</p>}
            {!migrationsLoading && sortedMigrations.length === 0 && (
              <p className="ui-caption text-slate-500 dark:text-slate-400">No migrations yet.</p>
            )}

            {sortedMigrations.map((migration) => {
              const done = migration.completed_items + migration.failed_items + migration.skipped_items;
              const percent = computeProgress(done, migration.total_items);
              return (
                <button
                  key={migration.id}
                  type="button"
                  onClick={() => navigate(`/manager/migrations/${migration.id}`)}
                  className="w-full rounded-lg border border-slate-200 p-3 text-left transition hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="ui-caption font-semibold text-slate-800 dark:text-slate-100">Migration #{migration.id}</p>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusChipClasses(migration.status)}`}>
                      {migration.status}
                    </span>
                  </div>

                  <p className="mt-1 ui-caption text-slate-600 dark:text-slate-300">
                    {contextLabelById.get(migration.source_context_id) ?? migration.source_context_id} {"->"}{" "}
                    {contextLabelById.get(migration.target_context_id) ?? migration.target_context_id}
                  </p>

                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                    <p className="ui-caption text-slate-500 dark:text-slate-400">
                      {done}/{migration.total_items} done ({percent}%)
                    </p>
                    <p className="ui-caption text-slate-500 dark:text-slate-400">updated: {formatDateTime(migration.updated_at)}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
