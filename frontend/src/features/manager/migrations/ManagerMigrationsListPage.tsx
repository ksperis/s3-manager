/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import PageHeader from "../../../components/PageHeader";
import { type BucketMigrationStatus } from "../../../api/managerMigrations";
import { useS3AccountContext } from "../S3AccountContext";
import { useManagerContexts, useManagerMigrationsList } from "./hooks";
import {
  computeProgress,
  formatDateTime,
  isActiveMigrationStatus,
  isNeedsAttentionMigrationStatus,
  statusChipClasses,
} from "./shared";

type MigrationListFilter = "all" | "active" | "needs_attention";

const SORT_PRIORITY: Record<BucketMigrationStatus, number> = {
  running: 0,
  queued: 1,
  pause_requested: 2,
  paused: 3,
  awaiting_cutover: 4,
  draft: 5,
  failed: 6,
  completed_with_errors: 7,
  canceled: 8,
  completed: 9,
  rolled_back: 10,
  cancel_requested: 11,
};

export default function ManagerMigrationsListPage() {
  const navigate = useNavigate();
  const { selectedS3AccountId } = useS3AccountContext();
  const sourceContextId = selectedS3AccountId ?? "";

  const { contextLabelById, contextsLoading, contextsError } = useManagerContexts();
  const { migrations, migrationsLoading, migrationsError } = useManagerMigrationsList(sourceContextId);

  const [migrationListFilter, setMigrationListFilter] = useState<MigrationListFilter>("all");

  const summary = useMemo(() => {
    let active = 0;
    let requiringAttention = 0;
    for (const migration of migrations) {
      if (isActiveMigrationStatus(migration.status)) active += 1;
      if (isNeedsAttentionMigrationStatus(migration.status)) requiringAttention += 1;
    }
    return {
      total: migrations.length,
      active,
      requiringAttention,
    };
  }, [migrations]);

  const filteredMigrations = useMemo(() => {
    const base = [...migrations].sort((left, right) => {
      const priorityLeft = SORT_PRIORITY[left.status] ?? 99;
      const priorityRight = SORT_PRIORITY[right.status] ?? 99;
      if (priorityLeft !== priorityRight) return priorityLeft - priorityRight;
      return right.id - left.id;
    });

    if (migrationListFilter === "all") return base;
    if (migrationListFilter === "active") return base.filter((migration) => isActiveMigrationStatus(migration.status));
    return base.filter((migration) => isNeedsAttentionMigrationStatus(migration.status));
  }, [migrations, migrationListFilter]);

  return (
    <div className="space-y-6">
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

      {contextsLoading && <p className="ui-caption text-slate-500 dark:text-slate-400">Loading contexts...</p>}
      {contextsError && <p className="ui-caption text-rose-600 dark:text-rose-300">{contextsError}</p>}
      {migrationsError && <p className="ui-caption text-rose-600 dark:text-rose-300">{migrationsError}</p>}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setMigrationListFilter("all")}
            className={`rounded-lg border px-3 py-2 text-left transition ${
              migrationListFilter === "all"
                ? "border-primary bg-primary/5"
                : "border-slate-200 bg-slate-50 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-slate-600"
            }`}
          >
            <p className="ui-caption text-slate-500 dark:text-slate-400">Total</p>
            <p className="ui-caption font-semibold text-slate-800 dark:text-slate-100">{summary.total}</p>
          </button>
          <button
            type="button"
            onClick={() => setMigrationListFilter("active")}
            className={`rounded-lg border px-3 py-2 text-left transition ${
              migrationListFilter === "active"
                ? "border-sky-300 bg-sky-100 dark:border-sky-700 dark:bg-sky-950/40"
                : "border-sky-200 bg-sky-50 hover:border-sky-300 dark:border-sky-900/40 dark:bg-sky-950/20 dark:hover:border-sky-800/60"
            }`}
          >
            <p className="ui-caption text-sky-700 dark:text-sky-300">Active</p>
            <p className="ui-caption font-semibold text-sky-800 dark:text-sky-200">{summary.active}</p>
          </button>
          <button
            type="button"
            onClick={() => setMigrationListFilter("needs_attention")}
            className={`rounded-lg border px-3 py-2 text-left transition ${
              migrationListFilter === "needs_attention"
                ? "border-rose-300 bg-rose-100 dark:border-rose-700 dark:bg-rose-950/40"
                : "border-rose-200 bg-rose-50 hover:border-rose-300 dark:border-rose-900/40 dark:bg-rose-950/20 dark:hover:border-rose-800/60"
            }`}
          >
            <p className="ui-caption text-rose-700 dark:text-rose-300">Needs attention</p>
            <p className="ui-caption font-semibold text-rose-800 dark:text-rose-200">{summary.requiringAttention}</p>
          </button>
        </div>

        <div className="mt-3 max-h-[720px] space-y-2 overflow-auto">
          {migrationsLoading && <p className="ui-caption text-slate-500 dark:text-slate-400">Loading migrations...</p>}
          {!migrationsLoading && filteredMigrations.length === 0 && (
            <p className="ui-caption text-slate-500 dark:text-slate-400">No migrations for current filter.</p>
          )}

          {filteredMigrations.map((migration) => {
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
    </div>
  );
}
