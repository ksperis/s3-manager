/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import PageEmptyState from "../../components/PageEmptyState";
import { tableActionButtonClasses } from "../../components/tableActionClasses";
import UiCard from "../../components/ui/UiCard";
import UiSelect from "../../components/ui/UiSelect";
import {
  cx,
  uiCardMutedClass,
  uiLabelClass,
  uiMutedTextClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import type {
  PortalWorkspaceActivityItem,
  PortalWorkspaceModel,
} from "./portalWorkspaceModel";

function activitySpacePath(item: PortalWorkspaceActivityItem): string | null {
  return item.spaceId ? `/portal/storage-spaces/${encodeURIComponent(item.spaceId)}` : null;
}

type PortalActivityPanelProps = {
  workspace: Pick<PortalWorkspaceModel, "activity" | "spaces">;
};

export default function PortalActivityPanel({ workspace }: PortalActivityPanelProps) {
  const { t } = useI18n();
  const [actionFilter, setActionFilter] = useState("all");
  const [spaceFilter, setSpaceFilter] = useState("all");
  const [expandedActivityId, setExpandedActivityId] = useState<string | null>(null);
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
          en: "No recent governance changes. Create a space, update settings, or manage access to build a history here.",
          fr: "Aucun changement de gouvernance récent. Créez un espace, modifiez des paramètres ou gérez les accès pour construire l'historique.",
          de: "Noch keine Governance-Änderungen. Erstellen Sie einen Bereich, ändern Sie Einstellungen oder verwalten Sie Zugriffe, um hier einen Verlauf aufzubauen.",
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
        id: "details",
        label: t({ en: "Actions", fr: "Actions", de: "Aktionen" }),
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
                  className={tableActionButtonClasses}
                >
                  {t({ en: "Open space", fr: "Ouvrir l'espace", de: "Bereich öffnen" })}
                </Link>
              ) : null}
              <button
                type="button"
                onClick={() => setExpandedActivityId(expanded ? null : item.id)}
                className={tableActionButtonClasses}
                {...dataTableDefaultActionProps}
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
              <dt className={cx("font-semibold", uiMutedTextClass)}>{t({ en: "Resource", fr: "Ressource", de: "Ressource" })}</dt>
              <dd className={cx(uiTitleTextClass, "break-all")}>{item.target}</dd>
              <dt className={cx("font-semibold", uiMutedTextClass)}>{t({ en: "Action", fr: "Action", de: "Aktion" })}</dt>
              <dd className={uiTitleTextClass}>{item.action}</dd>
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

  return (
    <div className="space-y-4">
      {workspace.activity.length === 0 ? (
        <PageEmptyState
          eyebrow={t({ en: "No history yet", fr: "Aucun historique", de: "Noch kein Verlauf" })}
          title={t({ en: "Activity starts with your spaces", fr: "L'activité commence dans vos espaces", de: "Aktivität beginnt in Ihren Bereichen" })}
          description={t({
            en: "Create spaces, manage collaborators and links, or update settings. The latest governance changes will appear here.",
            fr: "Créez des espaces, gérez les collaborateurs et les liens, ou modifiez les paramètres. Les derniers changements de gouvernance apparaîtront ici.",
            de: "Erstellen Sie Bereiche, verwalten Sie Mitwirkende und Links oder ändern Sie Einstellungen. Die letzten Governance-Änderungen erscheinen hier.",
          })}
          primaryAction={{ label: t({ en: "Open spaces", fr: "Ouvrir les espaces", de: "Bereiche öffnen" }), to: "/portal/storage-spaces" }}
        />
      ) : (
        <>
          <UiCard
            muted
            title={t({ en: "Activity overview", fr: "Vue d'ensemble de l'activité", de: "Aktivitätsübersicht" })}
            description={t({
              en: "A quick view of recent governance changes across the spaces you can access.",
              fr: "Une vue rapide des changements de gouvernance récents dans les espaces auxquels vous avez accès.",
              de: "Ein schneller Überblick über aktuelle Governance-Änderungen in Ihren zugänglichen Bereichen.",
            })}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="min-w-0">
                <div className={uiLabelClass}>{t({ en: "Recent changes", fr: "Changements récents", de: "Letzte Änderungen" })}</div>
                <div className={cx("mt-1 text-2xl leading-7", uiTitleTextClass)}>{activitySummary.events}</div>
                <p className={cx("mt-1 text-xs", uiMutedTextClass)}>
                  {t({ en: "Visible access and configuration events", fr: "Événements visibles d'accès et de configuration", de: "Sichtbare Zugriffs- und Konfigurationsereignisse" })}
                </p>
              </div>
              <div className="min-w-0">
                <div className={uiLabelClass}>{t({ en: "People active", fr: "Personnes actives", de: "Aktive Personen" })}</div>
                <div className={cx("mt-1 text-2xl leading-7", uiTitleTextClass)}>{activitySummary.people}</div>
                <p className={cx("mt-1 text-xs", uiMutedTextClass)}>
                  {t({ en: "Collaborators who changed something", fr: "Collaborateurs ayant effectué un changement", de: "Mitwirkende, die etwas geändert haben" })}
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
          </UiCard>
          <UiCard
            title={t({ en: "Recent activity", fr: "Activité récente", de: "Letzte Aktivität" })}
            description={t({
              en: "Filter changes by action or space, then open a row for its technical details.",
              fr: "Filtrez les changements par action ou par espace, puis ouvrez une ligne pour ses détails techniques.",
              de: "Filtern Sie Änderungen nach Aktion oder Bereich und öffnen Sie eine Zeile für technische Details.",
            })}
          >
            {activityFilters}
            {activityTable(activityColumns)}
          </UiCard>
        </>
      )}
    </div>
  );
}
