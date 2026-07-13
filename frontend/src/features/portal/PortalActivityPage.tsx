/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import UiCard from "../../components/ui/UiCard";
import UiSelect from "../../components/ui/UiSelect";
import {
  cx,
  uiCardMutedClass,
  uiDividerClass,
  uiLabelClass,
  uiMutedTextClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import type { PortalWorkspaceActivityItem } from "./portalWorkspaceModel";
import { resolvePortalWorkspacePageState } from "./portalUi";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

function activitySpacePath(item: PortalWorkspaceActivityItem): string | null {
  return item.spaceId ? `/portal/storage-spaces/${encodeURIComponent(item.spaceId)}` : null;
}

export default function PortalActivityPage() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState("timeline");
  const [actionFilter, setActionFilter] = useState("all");
  const [spaceFilter, setSpaceFilter] = useState("all");
  const [expandedActivityId, setExpandedActivityId] = useState<string | null>(null);
  const { workspace, loading, error, hasAccountContext, accountError, accountLoading } = usePortalWorkspaceData({ includeActivity: true });
  const actionOptions = useMemo(
    () => Array.from(new Set(workspace.activity.map((item) => item.action))).sort(),
    [workspace.activity]
  );
  const activitySummary = useMemo(() => {
    const people = new Set(workspace.activity.map((item) => item.actor).filter(Boolean));
    const spaces = new Set(workspace.activity.map((item) => item.spaceName).filter(Boolean));
    return {
      events: workspace.activity.length,
      people: people.size,
      spaces: spaces.size,
    };
  }, [workspace.activity]);
  const rows = useMemo(
    () =>
      workspace.activity.filter((item) => {
        const actionMatch = actionFilter === "all" || item.action === actionFilter;
        const spaceMatch = spaceFilter === "all" || item.spaceName === spaceFilter;
        return actionMatch && spaceMatch;
      }),
    [actionFilter, spaceFilter, workspace.activity]
  );
  const tableStatus = rows.length === 0 ? "empty" : "ready";
  const emptyActivityMessage =
    workspace.activity.length === 0
      ? t({
          en: "No recent changes yet. Add files, invite collaborators, or create spaces to build a history here.",
          fr: "Aucun changement récent. Ajoutez des fichiers, invitez des collaborateurs ou créez des espaces pour construire l'historique.",
          de: "Noch keine letzten Änderungen. Fügen Sie Dateien hinzu, laden Sie Mitwirkende ein oder erstellen Sie Bereiche, um hier einen Verlauf aufzubauen.",
        })
      : t({
          en: "No matching activity. Adjust the filters to see more changes.",
          fr: "Aucune activité ne correspond. Ajustez les filtres pour voir plus de changements.",
          de: "Keine passende Aktivität. Passen Sie die Filter an, um mehr Änderungen zu sehen.",
        });
  const activityColumns = useMemo<DataTableColumn<PortalWorkspaceActivityItem>[]>(
    () => [
      {
        id: "event",
        label: t({ en: "Change", fr: "Changement", de: "Änderung" }),
        primary: true,
        cellClassName: "break-words",
        render: (item) => (
          <div className="min-w-0">
            <div className={cx("font-semibold", uiTitleTextClass)}>
              {item.actor}
            </div>
            <div className={cx("mt-0.5 text-xs", uiMutedTextClass)}>
              {item.action} · {item.target}
            </div>
          </div>
        ),
      },
      {
        id: "time",
        label: t({ en: "When", fr: "Quand", de: "Wann" }),
        render: (item) => item.timeLabel,
      },
      {
        id: "space",
        label: t({ en: "Space", fr: "Espace", de: "Bereich" }),
        cellClassName: "break-words",
        render: (item) => item.spaceName,
      },
      {
        id: "target",
        label: t({ en: "File or item", fr: "Fichier ou élément", de: "Datei oder Element" }),
        cellClassName: "break-words",
        render: (item) => item.target,
      },
      {
        id: "action",
        label: t({ en: "Action", fr: "Action", de: "Aktion" }),
        render: (item) => item.action,
      },
      {
        id: "details",
        label: t({ en: "Next step", fr: "Suite", de: "Nächster Schritt" }),
        align: "right",
        mobileRole: "actions",
        render: (item) => {
          const expanded = expandedActivityId === item.id;
          const spacePath = activitySpacePath(item);
          return (
            <div className="flex flex-wrap items-center justify-end gap-2 max-md:justify-start">
              {spacePath ? (
                <Link
                  to={spacePath}
                  className="text-xs font-bold text-primary hover:text-primary-600 dark:text-primary-200 dark:hover:text-primary-100"
                >
                  {t({ en: "Open space", fr: "Ouvrir l'espace", de: "Bereich öffnen" })}
                </Link>
              ) : null}
              <button
                type="button"
                onClick={() => setExpandedActivityId(expanded ? null : item.id)}
                className="text-xs font-bold text-primary hover:text-primary-600 dark:text-primary-200 dark:hover:text-primary-100"
              >
                {expanded ? t({ en: "Hide details", fr: "Masquer les détails", de: "Details ausblenden" }) : t({ en: "Show details", fr: "Afficher les détails", de: "Details anzeigen" })}
              </button>
            </div>
          );
        },
      },
    ],
    [expandedActivityId, t]
  );
  const timelineColumns = useMemo<DataTableColumn<PortalWorkspaceActivityItem>[]>(
    () => activityColumns.filter((column) => ["event", "time", "space", "details"].includes(column.id)),
    [activityColumns]
  );
  const activityFilters = (
    <div className="mb-4 flex flex-wrap gap-3">
      <UiSelect
        label={t({ en: "Action", fr: "Action", de: "Aktion" })}
        size="compact"
        fieldClassName="w-44"
        className="h-8"
        value={actionFilter}
        onChange={(event) => setActionFilter(event.target.value)}
      >
        <option value="all">{t({ en: "All actions", fr: "Toutes les actions", de: "Alle Aktionen" })}</option>
        {actionOptions.map((action) => (
          <option key={action} value={action}>{action}</option>
        ))}
      </UiSelect>
      <UiSelect
        label={t({ en: "Space", fr: "Espace", de: "Bereich" })}
        size="compact"
        fieldClassName="w-52"
        className="h-8"
        value={spaceFilter}
        onChange={(event) => setSpaceFilter(event.target.value)}
      >
        <option value="all">{t({ en: "All spaces", fr: "Tous les espaces", de: "Alle Bereiche" })}</option>
        {workspace.spaces.map((space) => (
          <option key={space.id} value={space.name}>{space.name}</option>
        ))}
      </UiSelect>
    </div>
  );
  const activityTable = (columns: DataTableColumn<PortalWorkspaceActivityItem>[]) => (
    <>
      <DataTableShell
        columns={columns}
        rows={rows}
        rowKey={(item) => item.id}
        status={tableStatus}
        loadingMessage={t({ en: "Loading activity...", fr: "Chargement de l'activité...", de: "Aktivität wird geladen..." })}
        errorMessage={t({ en: "Unable to load activity.", fr: "Impossible de charger l'activité.", de: "Aktivität kann nicht geladen werden." })}
        emptyMessage={emptyActivityMessage}
        expandedRow={(item) =>
          expandedActivityId === item.id ? (
            <dl className={cx(uiCardMutedClass, "grid gap-2 px-3 py-2 text-xs sm:grid-cols-[140px_1fr]")}>
              <dt className={cx("font-semibold", uiMutedTextClass)}>{t({ en: "IP address", fr: "Adresse IP", de: "IP-Adresse" })}</dt>
              <dd className={uiTitleTextClass}>{item.ipAddress || "-"}</dd>
            </dl>
          ) : null
        }
        responsiveCards
      />
      <div className={cx("mt-4 flex items-center justify-between text-[11px] font-semibold", uiMutedTextClass)}>
        <span>
          {t({
            en: `${rows.length} of ${workspace.activity.length}`,
            fr: `${rows.length} sur ${workspace.activity.length}`,
            de: `${rows.length} von ${workspace.activity.length}`,
          })}
        </span>
      </div>
    </>
  );

  const pageState = resolvePortalWorkspacePageState({
    accountLoading,
    loading,
    accountError,
    error,
    hasAccountContext,
    loadingMessage: t({ en: "Loading activity...", fr: "Chargement de l'activité...", de: "Aktivität wird geladen..." }),
    noAccountMessage: t({ en: "Select a project to view activity.", fr: "Sélectionnez un projet pour voir l'activité.", de: "Wählen Sie ein Projekt aus, um Aktivität anzuzeigen." }),
  });
  if (pageState) return pageState;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t({ en: "Activity", fr: "Activité", de: "Aktivität" })}
        description={t({
          en: "See who changed files, spaces, and sharing settings you can access.",
          fr: "Voyez qui a modifié les fichiers, les espaces et les partages auxquels vous avez accès.",
          de: "Sehen Sie, wer Dateien, Bereiche und Freigaben geändert hat, auf die Sie zugreifen können.",
        })}
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "Activity", fr: "Activité", de: "Aktivität" }) })}
        actions={[{ label: t({ en: "Open spaces", fr: "Ouvrir les espaces", de: "Bereiche öffnen" }), to: "/portal/storage-spaces", variant: "secondary" }]}
        rightContent={<div className={cx(uiCardMutedClass, "px-3 py-2 text-xs font-semibold", uiMutedTextClass)}>{t({ en: "Visible spaces only", fr: "Espaces visibles uniquement", de: "Nur sichtbare Bereiche" })}</div>}
      />

      {workspace.activity.length === 0 ? (
        <PageEmptyState
          eyebrow={t({ en: "No history yet", fr: "Aucun historique", de: "Noch kein Verlauf" })}
          title={t({ en: "Activity starts with your spaces", fr: "L'activité commence dans vos espaces", de: "Aktivität beginnt in Ihren Bereichen" })}
          description={t({
            en: "Upload files, create folders, or invite collaborators from a space. The most recent changes will appear here.",
            fr: "Ajoutez des fichiers, créez des dossiers ou invitez des collaborateurs depuis un espace. Les changements récents apparaîtront ici.",
            de: "Laden Sie Dateien hoch, erstellen Sie Ordner oder laden Sie Mitwirkende aus einem Bereich ein. Die letzten Änderungen erscheinen hier.",
          })}
          primaryAction={{ label: t({ en: "Open spaces", fr: "Ouvrir les espaces", de: "Bereiche öffnen" }), to: "/portal/storage-spaces" }}
        />
      ) : (
        <PageTabs
          activeTab={activeTab}
          onChange={setActiveTab}
          tabs={[
            {
              id: "timeline",
              label: t({ en: "Timeline", fr: "Fil d'activité", de: "Verlauf" }),
              content: (
                <UiCard
                  title={t({ en: "Recent changes", fr: "Changements récents", de: "Letzte Änderungen" })}
                  description={t({
                    en: "Follow work across your spaces without the audit-only fields.",
                    fr: "Suivez le travail dans vos espaces sans les champs réservés à l'audit.",
                    de: "Verfolgen Sie Arbeit in Ihren Bereichen ohne reine Audit-Felder.",
                  })}
                >
                  {activityFilters}
                  {activityTable(timelineColumns)}
                </UiCard>
              ),
            },
            {
              id: "audit",
              label: t({ en: "Audit details", fr: "Détails d'audit", de: "Auditdetails" }),
              content: (
                <div className="space-y-4">
                  <UiCard
                    muted
                    title={t({ en: "Recent workspace history", fr: "Historique récent de l'espace de travail", de: "Letzter Arbeitsbereichsverlauf" })}
                    description={t({
                      en: "Use this view when you need a fuller trace of collaboration across visible spaces.",
                      fr: "Utilisez cette vue quand vous avez besoin d'une trace plus complète de la collaboration dans les espaces visibles.",
                      de: "Nutzen Sie diese Ansicht, wenn Sie eine vollständigere Spur der Zusammenarbeit in sichtbaren Bereichen benötigen.",
                    })}
                  >
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="min-w-0">
                        <div className={uiLabelClass}>{t({ en: "Recent changes", fr: "Changements récents", de: "Letzte Änderungen" })}</div>
                        <div className={cx("mt-1 text-2xl leading-7", uiTitleTextClass)}>{activitySummary.events}</div>
                        <p className={cx("mt-1 text-xs", uiMutedTextClass)}>
                          {t({ en: "Visible file and sharing events", fr: "Événements visibles de fichiers et partages", de: "Sichtbare Datei- und Freigabeereignisse" })}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <div className={uiLabelClass}>{t({ en: "People active", fr: "Personnes actives", de: "Aktive Personen" })}</div>
                        <div className={cx("mt-1 text-2xl leading-7", uiTitleTextClass)}>{activitySummary.people}</div>
                        <p className={cx("mt-1 text-xs", uiMutedTextClass)}>
                          {t({ en: "Collaborators who changed something", fr: "Collaborateurs ayant changé quelque chose", de: "Mitwirkende, die etwas geändert haben" })}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <div className={uiLabelClass}>{t({ en: "Spaces touched", fr: "Espaces concernés", de: "Betroffene Bereiche" })}</div>
                        <div className={cx("mt-1 text-2xl leading-7", uiTitleTextClass)}>{activitySummary.spaces}</div>
                        <p className={cx("mt-1 text-xs", uiMutedTextClass)}>
                          {t({ en: "Spaces with recent changes", fr: "Espaces avec des changements récents", de: "Bereiche mit letzten Änderungen" })}
                        </p>
                      </div>
                    </div>
                    <div className={cx("mt-4 border-t pt-3 text-xs", uiDividerClass, uiMutedTextClass)}>
                      {t({
                        en: "IP addresses and detailed fields stay here, away from the everyday timeline.",
                        fr: "Les adresses IP et les champs détaillés restent ici, à l'écart du fil quotidien.",
                        de: "IP-Adressen und Detailfelder bleiben hier, getrennt vom täglichen Verlauf.",
                      })}
                    </div>
                  </UiCard>
                  <UiCard
                    title={t({ en: "Detailed activity", fr: "Activité détaillée", de: "Detaillierte Aktivität" })}
                    description={t({
                      en: "Filter changes by action or space when you need to investigate a specific event.",
                      fr: "Filtrez les changements par action ou par espace quand vous devez examiner un événement précis.",
                      de: "Filtern Sie Änderungen nach Aktion oder Bereich, wenn Sie ein bestimmtes Ereignis prüfen müssen.",
                    })}
                  >
                    {activityFilters}
                    {activityTable(activityColumns)}
                  </UiCard>
                </div>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
