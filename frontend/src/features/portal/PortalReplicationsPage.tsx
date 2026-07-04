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
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { cx, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { resolvePortalWorkspacePageState } from "./portalUi";
import { usePortalAccountContext } from "./PortalAccountContext";

function storageLocationLabel(space: PortalReplicationStorageSpace): string | null {
  return space.project_account_label ?? space.storage_endpoint_name ?? space.account_name ?? null;
}

function spaceLabel(space: PortalReplicationStorageSpace): string {
  const location = storageLocationLabel(space);
  return location ? `${space.name} (${location})` : space.name;
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

  const unavailableReasonLabel = (reason: string): string => {
    const normalized = reason.toLowerCase();
    if (normalized.includes("no storage space")) {
      return t({
        en: "No Storage Space is available in this workspace.",
        fr: "Aucun espace de stockage n'est disponible dans ce workspace.",
        de: "In diesem Workspace ist kein Speicherbereich verfügbar.",
      });
    }
    if (normalized.includes("portal manager") || normalized.includes("compatible storage")) {
      return t({
        en: "Replication needs manager access and two compatible storage locations in this workspace.",
        fr: "La réplication nécessite un accès manager et deux emplacements de stockage compatibles dans ce workspace.",
        de: "Replikation benötigt Managerzugriff und zwei kompatible Speicherorte in diesem Workspace.",
      });
    }
    return reason;
  };

  const createErrorLabel = (err: unknown): string => {
    const raw = extractApiError(
      err,
      t({ en: "Unable to configure replication.", fr: "Impossible de configurer la réplication.", de: "Replikation kann nicht konfiguriert werden." })
    );
    const normalized = raw.toLowerCase();
    if (normalized.includes("not implemented") || normalized.includes("unsupported") || normalized.includes("not support")) {
      return t({
        en: "This storage platform does not support this replication setup yet. Contact your platform admin.",
        fr: "Cette plateforme de stockage ne prend pas encore en charge cette réplication. Contactez l'administration de la plateforme.",
        de: "Diese Speicherplattform unterstützt diese Replikation noch nicht. Wenden Sie sich an die Plattformadministration.",
      });
    }
    if (normalized.includes("different storage locations")) {
      return t({
        en: "Choose a destination on another storage location.",
        fr: "Choisissez une destination sur un autre emplacement de stockage.",
        de: "Wählen Sie ein Ziel an einem anderen Speicherort.",
      });
    }
    return raw;
  };

  const spaceDetail = (space: PortalReplicationStorageSpace): string => {
    const location = storageLocationLabel(space);
    return location
      ? t({ en: `Storage location: ${location}`, fr: `Emplacement de stockage : ${location}`, de: `Speicherort: ${location}` })
      : t({ en: "Workspace storage", fr: "Stockage du workspace", de: "Workspace-Speicher" });
  };

  const replicationModeLabel = (replication: PortalReplicationSummary): string =>
    replication.mode === "global"
      ? t({ en: "Platform replication", fr: "Réplication plateforme", de: "Plattform-Replikation" })
      : t({ en: "Workspace replication", fr: "Réplication workspace", de: "Workspace-Replikation" });

  const replicationStatusLabel = (replication: PortalReplicationSummary): string => {
    if (replication.status === "error") {
      return replication.message || t({ en: "Needs attention", fr: "À vérifier", de: "Zu prüfen" });
    }
    if (replication.mode === "global") {
      return t({
        en: "Managed by the storage platform.",
        fr: "Gérée par la plateforme de stockage.",
        de: "Von der Speicherplattform verwaltet.",
      });
    }
    if (!replication.target) {
      return t({
        en: "Destination outside this workspace.",
        fr: "Destination hors de ce workspace.",
        de: "Ziel liegt außerhalb dieses Workspace.",
      });
    }
    return replication.message || t({ en: "Active", fr: "Active", de: "Aktiv" });
  };

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
        Boolean(space.storage_endpoint_id) &&
        space.storage_endpoint_id !== source.storage_endpoint_id &&
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
      setError(createErrorLabel(err));
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
  const noCompatibleTarget = Boolean(sourceId && manageableSources.length > 0 && targetOptions.length === 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t({ en: "Replications", fr: "Réplications", de: "Replikationen" })}
        description={t({ en: "Configure and review data copies between the storage locations available in this workspace.", fr: "Configurez et consultez les copies de données entre les emplacements de stockage disponibles dans ce workspace.", de: "Datenkopien zwischen den Speicherorten dieses Workspace konfigurieren und prüfen." })}
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "Replications", fr: "Réplications", de: "Replikationen" }) })}
      />

      {message ? <PageBanner tone="success">{message}</PageBanner> : null}
      {error ? <PageBanner tone="error">{error}</PageBanner> : null}
      {data?.unavailable_reason ? <PageBanner tone={canCreate ? "info" : "warning"}>{unavailableReasonLabel(data.unavailable_reason)}</PageBanner> : null}

      <UiCard
        title={t({ en: "New replication", fr: "Nouvelle réplication", de: "Neue Replikation" })}
        description={t({ en: "Choose a source and destination Storage Space in compatible storage locations. The platform prepares both sides automatically.", fr: "Choisissez un espace source et une destination sur des emplacements de stockage compatibles. La plateforme prépare automatiquement les deux côtés.", de: "Wählen Sie einen Quell- und Zielspeicherbereich an kompatiblen Speicherorten. Die Plattform bereitet beide Seiten automatisch vor." })}
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
        {noCompatibleTarget ? (
          <UiInlineMessage tone="warning" className="mt-3">
            {t({
              en: "No compatible destination is available for the selected source.",
              fr: "Aucune destination compatible n'est disponible pour la source sélectionnée.",
              de: "Für die ausgewählte Quelle ist kein kompatibles Ziel verfügbar.",
            })}
          </UiInlineMessage>
        ) : null}
        <p className={cx("mt-3 ui-caption", uiMutedTextClass)}>
          {t({ en: `${storageSpaces.length} Storage Space(s) visible in this workspace.`, fr: `${storageSpaces.length} espace(s) de stockage visible(s) dans ce workspace.`, de: `${storageSpaces.length} Speicherbereich(e) in diesem Workspace sichtbar.` })}
        </p>
      </UiCard>

      {replications.length === 0 ? (
        <PageEmptyState
          eyebrow={t({ en: "Replication", fr: "Réplication", de: "Replikation" })}
          tone="info"
          title={t({ en: "No replication visible yet", fr: "Aucune réplication visible", de: "Noch keine Replikation sichtbar" })}
          description={t({
            en: "Configured replications for this workspace will appear here, including those managed directly by the storage platform.",
            fr: "Les réplications configurées pour ce workspace apparaîtront ici, y compris celles gérées directement par la plateforme de stockage.",
            de: "Konfigurierte Replikationen dieses Workspace erscheinen hier, einschließlich der direkt von der Speicherplattform verwalteten.",
          })}
        />
      ) : (
        <UiCard title={t({ en: "Current replications", fr: "Réplications actives", de: "Aktuelle Replikationen" })}>
          <div className="overflow-x-auto max-md:overflow-visible">
            <table className="ui-data-table min-w-[820px] max-md:block max-md:w-full max-md:min-w-0">
              <thead className="max-md:hidden">
                <tr>
                  <th>{t({ en: "Type", fr: "Type", de: "Typ" })}</th>
                  <th>{t({ en: "Source", fr: "Source", de: "Quelle" })}</th>
                  <th>{t({ en: "Destination", fr: "Destination", de: "Ziel" })}</th>
                  <th>{t({ en: "Status", fr: "Statut", de: "Status" })}</th>
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
                        <span className={uiMutedTextClass}>
                          {t({ en: "Destination outside this workspace", fr: "Destination hors de ce workspace", de: "Ziel außerhalb dieses Workspace" })}
                        </span>
                      )}
                    </td>
                    <td className={cx("max-md:mt-2 max-md:block max-md:border-0 max-md:p-0", uiMutedTextClass)}>
                      {replicationStatusLabel(replication)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </UiCard>
      )}
    </div>
  );
}
