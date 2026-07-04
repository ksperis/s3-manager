/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import {
  createPortalReplication,
  listPortalReplications,
  type PortalReplicationList,
  type PortalReplicationStorageSpace,
  type PortalReplicationSummary,
} from "../../api/portal";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import { cx, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { resolvePortalWorkspacePageState } from "./portalUi";
import { usePortalAccountContext } from "./PortalAccountContext";

function spaceLabel(space: PortalReplicationStorageSpace): string {
  const location = space.project_account_label ?? space.storage_endpoint_name;
  return location ? `${space.name} (${location})` : space.name;
}

function spaceDetail(space: PortalReplicationStorageSpace): string {
  const parts = [space.bucket_name, space.storage_endpoint_zonegroup, space.storage_endpoint_name].filter(Boolean);
  return parts.join(" - ");
}

function replicationModeLabel(replication: PortalReplicationSummary): string {
  return replication.mode === "global" ? "Global" : "Bucket level";
}

function replicationTone(replication: PortalReplicationSummary) {
  if (replication.status === "error") return "danger" as const;
  if (replication.mode === "global") return "primary" as const;
  return "success" as const;
}

export default function PortalReplicationsPage() {
  const { t } = useI18n();
  const { accountIdForApi, hasAccountContext, loading: accountLoading, error: accountError } = usePortalAccountContext();
  const [data, setData] = useState<PortalReplicationList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [creating, setCreating] = useState(false);

  const loadReplications = async () => {
    if (!accountIdForApi) return;
    setLoading(true);
    setError(null);
    try {
      setData(await listPortalReplications(accountIdForApi));
    } catch (err) {
      console.error(err);
      setData(null);
      setError(extractApiError(err, t({ en: "Unable to load replications.", fr: "Impossible de charger les réplications.", de: "Replikationen können nicht geladen werden." })));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (!hasAccountContext || !accountIdForApi) {
      setData(null);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    setError(null);
    listPortalReplications(accountIdForApi)
      .then((nextData) => {
        if (!cancelled) setData(nextData);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setData(null);
          setError(extractApiError(err, t({ en: "Unable to load replications.", fr: "Impossible de charger les réplications.", de: "Replikationen können nicht geladen werden." })));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, hasAccountContext, t]);

  const manageableSources = useMemo(
    () => (data?.storage_spaces ?? []).filter((space) => space.can_manage && space.bucket_replication_allowed && space.storage_endpoint_zonegroup),
    [data?.storage_spaces]
  );
  const targetOptions = useMemo(() => {
    const source = manageableSources.find((space) => space.id === sourceId);
    if (!source) return [];
    return (data?.storage_spaces ?? []).filter(
      (space) =>
        space.id !== source.id &&
        space.bucket_replication_allowed &&
        Boolean(space.storage_endpoint_zonegroup) &&
        space.storage_endpoint_zonegroup === source.storage_endpoint_zonegroup
    );
  }, [data?.storage_spaces, manageableSources, sourceId]);

  useEffect(() => {
    if (!sourceId && manageableSources.length > 0) {
      setSourceId(manageableSources[0].id);
      return;
    }
    if (sourceId && !manageableSources.some((space) => space.id === sourceId)) {
      setSourceId(manageableSources[0]?.id ?? "");
    }
  }, [manageableSources, sourceId]);

  useEffect(() => {
    if (!targetId && targetOptions.length > 0) {
      setTargetId(targetOptions[0].id);
      return;
    }
    if (targetId && !targetOptions.some((space) => space.id === targetId)) {
      setTargetId(targetOptions[0]?.id ?? "");
    }
  }, [targetId, targetOptions]);

  const handleCreate = async () => {
    if (!accountIdForApi || !sourceId || !targetId) return;
    setCreating(true);
    setError(null);
    setMessage(null);
    try {
      const created = await createPortalReplication(accountIdForApi, {
        source_storage_space_id: sourceId,
        target_storage_space_id: targetId,
      });
      setMessage(t({ en: `Replication configured from ${created.source.name}.`, fr: `Réplication configurée depuis ${created.source.name}.`, de: `Replikation von ${created.source.name} konfiguriert.` }));
      await loadReplications();
    } catch (err) {
      console.error(err);
      setError(extractApiError(err, t({ en: "Unable to configure replication.", fr: "Impossible de configurer la réplication.", de: "Replikation kann nicht konfiguriert werden." })));
    } finally {
      setCreating(false);
    }
  };

  const pageState = resolvePortalWorkspacePageState({
    accountLoading,
    loading,
    accountError,
    error,
    hasAccountContext,
    loadingMessage: t({ en: "Loading replications...", fr: "Chargement des réplications...", de: "Replikationen werden geladen..." }),
    noAccountMessage: t({ en: "Select a project to view replications.", fr: "Sélectionnez un projet pour voir les réplications.", de: "Wählen Sie ein Projekt aus, um Replikationen anzuzeigen." }),
  });
  if (pageState) return pageState;

  const replications = data?.replications ?? [];
  const storageSpaces = data?.storage_spaces ?? [];
  const canCreate = Boolean(data?.can_create && manageableSources.length > 0 && targetOptions.length > 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t({ en: "Replications", fr: "Réplications", de: "Replikationen" })}
        description={t({ en: "Configure and review Ceph bucket-level and global replications for this Portal workspace.", fr: "Configurez et consultez les réplications Ceph bucket-level et globales de ce workspace Portal.", de: "Ceph-Bucket- und globale Replikationen dieses Portal-Workspace verwalten." })}
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "Replications", fr: "Réplications", de: "Replikationen" }) })}
      />

      {message ? <PageBanner tone="success">{message}</PageBanner> : null}
      {error ? <PageBanner tone="error">{error}</PageBanner> : null}
      {data?.unavailable_reason ? <PageBanner tone={canCreate ? "info" : "warning"}>{data.unavailable_reason}</PageBanner> : null}

      <UiCard
        title={t({ en: "New bucket-level replication", fr: "Nouvelle réplication bucket-level", de: "Neue Bucket-Replikation" })}
        description={t({ en: "Choose two Storage Spaces in the same Ceph zonegroup. Versioning and the replication rule are configured automatically.", fr: "Choisissez deux espaces de stockage dans la même zonegroup Ceph. Le versioning et la règle de réplication sont configurés automatiquement.", de: "Wählen Sie zwei Speicherbereiche in derselben Ceph-Zonegroup. Versionierung und Replikationsregel werden automatisch konfiguriert." })}
      >
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
          <label className="flex flex-col gap-1">
            <span className={cx("text-[11px] font-semibold uppercase tracking-wide", uiMutedTextClass)}>{t({ en: "Source storage", fr: "Stockage source", de: "Quellspeicher" })}</span>
            <select className="ui-control h-9 py-1.5 text-xs" value={sourceId} onChange={(event) => setSourceId(event.target.value)} disabled={manageableSources.length === 0}>
              {manageableSources.map((space) => (
                <option key={space.id} value={space.id}>
                  {spaceLabel(space)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={cx("text-[11px] font-semibold uppercase tracking-wide", uiMutedTextClass)}>{t({ en: "Destination storage", fr: "Stockage destination", de: "Zielspeicher" })}</span>
            <select className="ui-control h-9 py-1.5 text-xs" value={targetId} onChange={(event) => setTargetId(event.target.value)} disabled={targetOptions.length === 0}>
              {targetOptions.map((space) => (
                <option key={space.id} value={space.id}>
                  {spaceLabel(space)}
                </option>
              ))}
            </select>
          </label>
          <UiButton size="sm" className="h-9 lg:self-end" loading={creating} disabled={!canCreate} onClick={handleCreate}>
            {creating ? t({ en: "Configuring...", fr: "Configuration...", de: "Wird konfiguriert..." }) : t({ en: "Configure", fr: "Configurer", de: "Konfigurieren" })}
          </UiButton>
        </div>
        <p className={cx("mt-3 ui-caption", uiMutedTextClass)}>
          {t({ en: `${storageSpaces.length} Storage Space(s) visible in this workspace.`, fr: `${storageSpaces.length} espace(s) de stockage visible(s) dans ce workspace.`, de: `${storageSpaces.length} Speicherbereich(e) in diesem Workspace sichtbar.` })}
        </p>
      </UiCard>

      <UiCard title={t({ en: "Configured replications", fr: "Réplications configurées", de: "Konfigurierte Replikationen" })}>
        <div className="overflow-x-auto max-md:overflow-visible">
          <table className="ui-data-table min-w-[820px] max-md:block max-md:w-full max-md:min-w-0">
            <thead className="max-md:hidden">
              <tr>
                <th>{t({ en: "Mode", fr: "Mode", de: "Modus" })}</th>
                <th>{t({ en: "Source", fr: "Source", de: "Quelle" })}</th>
                <th>{t({ en: "Destination", fr: "Destination", de: "Ziel" })}</th>
                <th>{t({ en: "Zonegroup", fr: "Zonegroup", de: "Zonegroup" })}</th>
                <th>{t({ en: "Rule", fr: "Règle", de: "Regel" })}</th>
              </tr>
            </thead>
            <tbody className="max-md:block max-md:w-full max-md:space-y-3">
              {replications.map((replication) => (
                <tr key={replication.id} className="max-md:block max-md:w-full max-md:rounded-md max-md:border max-md:border-[color:var(--ui-border)] max-md:bg-[color:var(--ui-surface)] max-md:p-3">
                  <td className="max-md:block max-md:border-0 max-md:p-0">
                    <UiBadge tone={replicationTone(replication)}>{replicationModeLabel(replication)}</UiBadge>
                  </td>
                  <td className="max-md:mt-2 max-md:block max-md:border-0 max-md:p-0">
                    <p className={cx("font-semibold", uiTitleTextClass)}>{spaceLabel(replication.source)}</p>
                    <p className={cx("text-[11px]", uiMutedTextClass)}>{spaceDetail(replication.source)}</p>
                  </td>
                  <td className="max-md:mt-2 max-md:block max-md:border-0 max-md:p-0">
                    {replication.target ? (
                      <>
                        <p className={cx("font-semibold", uiTitleTextClass)}>{spaceLabel(replication.target)}</p>
                        <p className={cx("text-[11px]", uiMutedTextClass)}>{spaceDetail(replication.target)}</p>
                      </>
                    ) : (
                      <span className={uiMutedTextClass}>{replication.target_bucket_name ?? "-"}</span>
                    )}
                  </td>
                  <td className="max-md:mt-2 max-md:block max-md:border-0 max-md:p-0">{replication.zonegroup ?? "-"}</td>
                  <td className={cx("max-md:mt-2 max-md:block max-md:border-0 max-md:p-0", uiMutedTextClass)}>
                    {replication.rule_id || replication.message || "-"}
                  </td>
                </tr>
              ))}
              {replications.length === 0 ? (
                <tr>
                  <td colSpan={5} className={cx("py-8 text-center", uiMutedTextClass)}>
                    {t({ en: "No replication is currently visible for this workspace.", fr: "Aucune réplication n'est actuellement visible pour ce workspace.", de: "Für diesen Workspace ist derzeit keine Replikation sichtbar." })}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </UiCard>
    </div>
  );
}
