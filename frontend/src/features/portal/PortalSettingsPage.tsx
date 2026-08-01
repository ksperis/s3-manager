/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { fetchCurrentUser, type User } from "../../api/users";
import PageBanner from "../../components/PageBanner";
import PageShell from "../../components/PageShell";
import UiBadge from "../../components/ui/UiBadge";
import UiCard from "../../components/ui/UiCard";
import { cx, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { formatBytes } from "../../utils/format";
import { usePortalAccountContext } from "./PortalAccountContext";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

const labelClasses = "ui-caption font-semibold uppercase tracking-wide text-[var(--ui-text-muted)]";

type WorkspaceAccessLabel = "limited" | "manager" | "user";

function resolveWorkspaceAccess(user: User | null, selectedAccountId: string | null): WorkspaceAccessLabel {
  if (!user || !selectedAccountId) return "limited";
  const numericId = Number(selectedAccountId);
  const link = user.account_links?.find((item) => Number(item.account_id) === numericId);
  if (!link?.role) return "limited";
  if (link.role === "portal_manager" || link.role === "account_administrator") return "manager";
  if (link.role === "portal_user") return "user";
  return "limited";
}

export default function PortalSettingsPage() {
  const { t } = useI18n();
  const { selectedAccount, selectedAccountId, loading: accountsLoading } = usePortalAccountContext();
  const { workspace, loading: workspaceLoading } = usePortalWorkspaceData();
  const [user, setUser] = useState<User | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedWorkspaceAccess = useMemo(
    () => resolveWorkspaceAccess(user, selectedAccountId),
    [selectedAccountId, user]
  );
  const activeSpaces = workspace.spaces.filter((space) => space.status !== "Archived");

  useEffect(() => {
    let cancelled = false;
    setAccessLoading(true);
    setError(null);
    fetchCurrentUser()
      .then((currentUser) => {
        if (!cancelled) setUser(currentUser);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setError(
            extractApiError(
              err,
              t({
                en: "Unable to load your project access.",
                fr: "Impossible de charger votre accès au projet.",
                de: "Ihr Projektzugriff konnte nicht geladen werden.",
              })
            )
          );
        }
      })
      .finally(() => {
        if (!cancelled) setAccessLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId, t]);

  return (
    <PageShell
      title={t({ en: "Settings", fr: "Paramètres", de: "Einstellungen" })}
      description={t({
        en: "Review information for the project currently selected in the Portal.",
        fr: "Consultez les informations du projet actuellement sélectionné dans le Portal.",
        de: "Prüfen Sie die Informationen für das aktuell im Portal ausgewählte Projekt.",
      })}
      breadcrumbs={portalBreadcrumbs({ label: t({ en: "Settings", fr: "Paramètres", de: "Einstellungen" }) })}
    >

      {accessLoading || accountsLoading ? (
        <PageBanner tone="info">
          {t({ en: "Loading project settings...", fr: "Chargement des paramètres du projet...", de: "Projekteinstellungen werden geladen..." })}
        </PageBanner>
      ) : null}
      {error ? <PageBanner tone="warning">{error}</PageBanner> : null}

      <UiCard
        title={t({ en: "Project", fr: "Projet", de: "Projekt" })}
        description={t({
          en: "Read-only context for the project currently selected in the Portal.",
          fr: "Contexte en lecture seule pour le projet actuellement sélectionné dans le Portal.",
          de: "Schreibgeschützter Kontext für das aktuell im Portal ausgewählte Projekt.",
        })}
      >
        <dl className="grid gap-4 text-xs md:grid-cols-2 xl:grid-cols-3">
          <div>
            <dt className={labelClasses}>{t({ en: "Selected project", fr: "Projet sélectionné", de: "Ausgewähltes Projekt" })}</dt>
            <dd className={cx("mt-1 font-bold", uiTitleTextClass)}>{selectedAccount?.name ?? "-"}</dd>
          </div>
          <div>
            <dt className={labelClasses}>{t({ en: "Workspace access", fr: "Accès à l'espace de travail", de: "Arbeitsbereichszugriff" })}</dt>
            <dd className="mt-1">
              <UiBadge tone="primary">
                {selectedWorkspaceAccess === "manager"
                  ? t({ en: "Manager", fr: "Gestionnaire", de: "Manager" })
                  : selectedWorkspaceAccess === "user"
                    ? t({ en: "User", fr: "Utilisateur", de: "Benutzer" })
                    : t({ en: "Limited access", fr: "Accès limité", de: "Eingeschränkter Zugriff" })}
              </UiBadge>
            </dd>
          </div>
          <div>
            <dt className={labelClasses}>{t({ en: "Storage service", fr: "Service de stockage", de: "Speicherdienst" })}</dt>
            <dd className={cx("mt-1 break-words font-semibold", uiTitleTextClass)}>
              {selectedAccount?.storage_endpoint_name ?? selectedAccount?.storage_endpoint_url ?? "-"}
            </dd>
          </div>
          <div>
            <dt className={labelClasses}>{t({ en: "Storage Spaces", fr: "Espaces de stockage", de: "Speicherbereiche" })}</dt>
            <dd className={cx("mt-1 font-bold", uiTitleTextClass)}>
              {workspaceLoading
                ? t({ en: "Loading...", fr: "Chargement...", de: "Wird geladen..." })
                : t({ en: `${activeSpaces.length} active / ${workspace.spaces.length} total`, fr: `${activeSpaces.length} actifs / ${workspace.spaces.length} au total`, de: `${activeSpaces.length} aktiv / ${workspace.spaces.length} gesamt` })}
            </dd>
          </div>
          <div>
            <dt className={labelClasses}>{t({ en: "Storage used", fr: "Stockage utilisé", de: "Genutzter Speicher" })}</dt>
            <dd className={cx("mt-1 font-bold", uiTitleTextClass)}>{formatBytes(workspace.usedBytes)}</dd>
          </div>
        </dl>
      </UiCard>
    </PageShell>
  );
}
