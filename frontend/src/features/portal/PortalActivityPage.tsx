/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Fragment, useMemo, useState } from "react";
import PageHeader from "../../components/PageHeader";
import UiCard from "../../components/ui/UiCard";
import { cx, uiCardMutedClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { resolvePortalWorkspacePageState } from "./portalUi";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

export default function PortalActivityPage() {
  const { t } = useI18n();
  const [actionFilter, setActionFilter] = useState("all");
  const [spaceFilter, setSpaceFilter] = useState("all");
  const [expandedActivityId, setExpandedActivityId] = useState<string | null>(null);
  const { workspace, loading, error, hasAccountContext, accountError, accountLoading } = usePortalWorkspaceData();
  const actionOptions = useMemo(
    () => Array.from(new Set(workspace.activity.map((item) => item.action))).sort(),
    [workspace.activity]
  );
  const rows = useMemo(
    () =>
      workspace.activity.filter((item) => {
        const actionMatch = actionFilter === "all" || item.action === actionFilter;
        const spaceMatch = spaceFilter === "all" || item.spaceName === spaceFilter;
        return actionMatch && spaceMatch;
      }),
    [actionFilter, spaceFilter, workspace.activity]
  );

  const pageState = resolvePortalWorkspacePageState({
    accountLoading,
    loading,
    accountError,
    error,
    hasAccountContext,
    loadingMessage: t({ en: "Loading activity...", fr: "Chargement de l'activité...", de: "Aktivität wird geladen..." }),
    noAccountMessage: t({ en: "Select an account to view activity.", fr: "Sélectionnez un compte pour voir l'activité.", de: "Wählen Sie ein Konto aus, um Aktivität anzuzeigen." }),
  });
  if (pageState) return pageState;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t({ en: "Activity", fr: "Activité", de: "Aktivität" })}
        description={t({ en: "Overview of actions in your account.", fr: "Vue des actions de votre compte.", de: "Übersicht der Aktionen in Ihrem Konto." })}
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "Activity", fr: "Activité", de: "Aktivität" }) })}
        rightContent={<div className={cx(uiCardMutedClass, "px-3 py-2 text-xs font-semibold", uiMutedTextClass)}>{t({ en: "Current period", fr: "Période en cours", de: "Aktueller Zeitraum" })}</div>}
      />

      <UiCard>
        <div className="mb-4 flex flex-wrap gap-3">
          <select className="ui-control h-8 w-44 py-1.5 text-xs" value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
            <option value="all">{t({ en: "All actions", fr: "Toutes les actions", de: "Alle Aktionen" })}</option>
            {actionOptions.map((action) => (
              <option key={action} value={action}>{action}</option>
            ))}
          </select>
          <select className="ui-control h-8 w-52 py-1.5 text-xs" value={spaceFilter} onChange={(event) => setSpaceFilter(event.target.value)}>
            <option value="all">{t({ en: "All storage spaces", fr: "Tous les espaces de stockage", de: "Alle Speicherbereiche" })}</option>
            {workspace.spaces.map((space) => (
              <option key={space.id} value={space.name}>{space.name}</option>
            ))}
          </select>
        </div>
        <div className="overflow-x-auto max-md:overflow-visible">
          <table className="ui-data-table min-w-[760px] max-md:block max-md:w-full max-md:min-w-0">
            <thead className="max-md:hidden">
              <tr>
                <th>{t({ en: "Time", fr: "Heure", de: "Zeit" })}</th>
                <th>{t({ en: "User", fr: "Utilisateur", de: "Benutzer" })}</th>
                <th>{t({ en: "Action", fr: "Action", de: "Aktion" })}</th>
                <th>{t({ en: "Resource", fr: "Ressource", de: "Ressource" })}</th>
                <th>{t({ en: "Storage Space", fr: "Espace de stockage", de: "Speicherbereich" })}</th>
                <th className="text-right">{t({ en: "Details", fr: "Détails", de: "Details" })}</th>
              </tr>
            </thead>
            <tbody className="max-md:block max-md:w-full max-md:space-y-3">
              {rows.map((item) => {
                const expanded = expandedActivityId === item.id;
                return (
                  <Fragment key={item.id}>
                    <tr className="max-md:block max-md:w-full max-md:rounded-md max-md:border max-md:border-[color:var(--ui-border)] max-md:bg-[color:var(--ui-surface)] max-md:p-3">
                      <td className="max-md:block max-md:border-0 max-md:p-0">
                        <span className={cx("hidden text-[11px] font-semibold max-md:block", uiMutedTextClass)}>{t({ en: "Time", fr: "Heure", de: "Zeit" })}</span>
                        {item.timeLabel}
                      </td>
                      <td className={cx("max-md:mt-2 max-md:block max-md:border-0 max-md:p-0", uiTitleTextClass)}>
                        <span className={cx("hidden text-[11px] font-semibold max-md:block", uiMutedTextClass)}>{t({ en: "User", fr: "Utilisateur", de: "Benutzer" })}</span>
                        {item.actor}
                      </td>
                      <td className="max-md:mt-2 max-md:block max-md:border-0 max-md:p-0">
                        <span className={cx("hidden text-[11px] font-semibold max-md:block", uiMutedTextClass)}>{t({ en: "Action", fr: "Action", de: "Aktion" })}</span>
                        {item.action}
                      </td>
                      <td className="max-md:mt-2 max-md:block max-md:border-0 max-md:p-0">
                        <span className={cx("hidden text-[11px] font-semibold max-md:block", uiMutedTextClass)}>{t({ en: "Resource", fr: "Ressource", de: "Ressource" })}</span>
                        {item.target}
                      </td>
                      <td className="max-md:mt-2 max-md:block max-md:border-0 max-md:p-0">
                        <span className={cx("hidden text-[11px] font-semibold max-md:block", uiMutedTextClass)}>{t({ en: "Storage Space", fr: "Espace de stockage", de: "Speicherbereich" })}</span>
                        {item.spaceName}
                      </td>
                      <td className="text-right max-md:mt-3 max-md:block max-md:border-0 max-md:p-0 max-md:text-left">
                        <button
                          type="button"
                          onClick={() => setExpandedActivityId(expanded ? null : item.id)}
                          className="text-xs font-bold text-primary hover:text-primary-600 dark:text-primary-200 dark:hover:text-primary-100"
                        >
                          {expanded ? t({ en: "Hide details", fr: "Masquer les détails", de: "Details ausblenden" }) : t({ en: "Show details", fr: "Afficher les détails", de: "Details anzeigen" })}
                        </button>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="max-md:block max-md:w-full">
                        <td colSpan={6} className="max-md:block max-md:border-0 max-md:p-0">
                          <dl className={cx(uiCardMutedClass, "grid gap-2 px-3 py-2 text-xs sm:grid-cols-[140px_1fr]")}>
                            <dt className={cx("font-semibold", uiMutedTextClass)}>{t({ en: "IP address", fr: "Adresse IP", de: "IP-Adresse" })}</dt>
                            <dd className={uiTitleTextClass}>{item.ipAddress || "-"}</dd>
                          </dl>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {rows.length === 0 ? (
                <tr className="max-md:block max-md:w-full">
                  <td colSpan={6} className={cx("py-6 text-center text-xs font-semibold max-md:block max-md:border-0", uiMutedTextClass)}>
                    {t({ en: "No activity to display.", fr: "Aucune activité à afficher.", de: "Keine Aktivität zum Anzeigen." })}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className={cx("mt-4 flex items-center justify-between text-[11px] font-semibold", uiMutedTextClass)}>
          <span>{rows.length} of {workspace.activity.length}</span>
        </div>
      </UiCard>
    </div>
  );
}
