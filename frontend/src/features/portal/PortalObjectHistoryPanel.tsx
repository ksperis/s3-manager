/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type {
  PortalStorageObjectVersion,
  PortalStorageObjectVersionsResponse,
} from "../../api/portal";
import PageBanner from "../../components/PageBanner";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import { cx, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { formatBytes } from "../../utils/format";
import { portalDateTimeLabel } from "./portalI18n";

type PortalObjectHistoryPanelProps = {
  history: PortalStorageObjectVersionsResponse | null;
  loading: boolean;
  error: string | null;
  restoringVersionId?: string | null;
  onRetry: () => void;
  onLoadMore: () => void;
  onRestore: (version: PortalStorageObjectVersion) => void;
};

export default function PortalObjectHistoryPanel({
  history,
  loading,
  error,
  restoringVersionId = null,
  onRetry,
  onLoadMore,
  onRestore,
}: PortalObjectHistoryPanelProps) {
  const { locale, t } = useI18n();

  return (
    <div className="space-y-4">
      <PageBanner tone="info">
        {t({
          en: "Restoring an older version creates a new current version. The existing history stays available.",
          fr: "Restaurer une ancienne version crée une nouvelle version actuelle. L'historique existant reste disponible.",
          de: "Beim Wiederherstellen einer älteren Version wird eine neue aktuelle Version erstellt. Der Verlauf bleibt erhalten.",
        })}
      </PageBanner>

      <UiCard
        actions={
          <UiButton size="xs" variant="secondary" onClick={onRetry} disabled={loading}>
            {t({ en: "Refresh", fr: "Actualiser", de: "Aktualisieren" })}
          </UiButton>
        }
      >
        {error ? (
          <PageBanner tone="warning">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{error}</span>
              <UiButton size="xs" variant="secondary" onClick={onRetry}>
                {t({ en: "Try again", fr: "Réessayer", de: "Erneut versuchen" })}
              </UiButton>
            </div>
          </PageBanner>
        ) : null}

        {loading && !history ? (
          <div className={cx("py-8 text-center text-sm font-semibold", uiMutedTextClass)}>
            {t({
              en: "Loading file history...",
              fr: "Chargement de l'historique...",
              de: "Dateiverlauf wird geladen...",
            })}
          </div>
        ) : null}

        {history && history.versions.length === 0 && !loading ? (
          <div className="rounded-md border border-dashed border-[color:var(--ui-border)] px-4 py-8 text-center">
            <div className={cx("text-sm font-bold", uiTitleTextClass)}>
              {t({
                en: "No previous version yet",
                fr: "Aucune version précédente",
                de: "Noch keine frühere Version",
              })}
            </div>
            <p className={cx("mt-1 text-xs", uiMutedTextClass)}>
              {t({
                en: "A new entry will appear after the file is replaced or deleted.",
                fr: "Une nouvelle entrée apparaîtra lorsque le fichier sera remplacé ou supprimé.",
                de: "Ein neuer Eintrag erscheint, nachdem die Datei ersetzt oder gelöscht wurde.",
              })}
            </p>
          </div>
        ) : null}

        {history && history.versions.length > 0 ? (
          <ol className="space-y-0" aria-label={t({ en: "File versions", fr: "Versions du fichier", de: "Dateiversionen" })}>
            {history.versions.map((version, index) => {
              const current = version.is_latest && !version.is_delete_marker;
              const restoring = restoringVersionId === version.version_id;
              return (
                <li
                  key={`${version.version_id}-${version.is_delete_marker ? "deleted" : "version"}`}
                  className="relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3 pb-4 last:pb-0"
                >
                  {index < history.versions.length - 1 ? (
                    <span
                      aria-hidden="true"
                      className="absolute bottom-0 left-[0.5625rem] top-5 w-px bg-[color:var(--ui-border)]"
                    />
                  ) : null}
                  <span
                    aria-hidden="true"
                    className={cx(
                      "relative mt-1 h-3 w-3 rounded-full border-2",
                      version.is_delete_marker
                        ? "border-amber-500 bg-amber-100 dark:bg-amber-950"
                        : current
                          ? "border-emerald-500 bg-emerald-100 dark:bg-emerald-950"
                          : "border-primary bg-primary-50 dark:bg-primary-950",
                    )}
                  />
                  <div className="rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface)] p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className={cx("text-sm font-bold", uiTitleTextClass)}>
                            {version.is_delete_marker
                              ? t({
                                  en: "Moved to trash",
                                  fr: "Placé dans la corbeille",
                                  de: "In den Papierkorb verschoben",
                                })
                              : current
                                ? t({
                                    en: "Current version",
                                    fr: "Version actuelle",
                                    de: "Aktuelle Version",
                                  })
                                : t({
                                    en: "Previous version",
                                    fr: "Version précédente",
                                    de: "Frühere Version",
                                  })}
                          </h3>
                          {current ? (
                            <UiBadge tone="success">
                              {t({ en: "Current", fr: "Actuelle", de: "Aktuell" })}
                            </UiBadge>
                          ) : null}
                        </div>
                        <p className={cx("mt-1 text-xs", uiMutedTextClass)}>
                          {portalDateTimeLabel(version.last_modified, locale)}
                          {!version.is_delete_marker && version.size != null
                            ? ` · ${formatBytes(version.size)}`
                            : ""}
                        </p>
                      </div>
                      {!version.is_delete_marker && !current && history.can_restore ? (
                        <UiButton
                          size="xs"
                          variant="secondary"
                          loading={restoring}
                          disabled={Boolean(restoringVersionId)}
                          onClick={() => onRestore(version)}
                        >
                          {t({
                            en: "Restore this version",
                            fr: "Restaurer cette version",
                            de: "Diese Version wiederherstellen",
                          })}
                        </UiButton>
                      ) : null}
                    </div>
                    {version.is_delete_marker ? (
                      <p className={cx("mt-2 text-xs leading-5", uiMutedTextClass)}>
                        {t({
                          en: "The file was deleted at this point, then restored or replaced later.",
                          fr: "Le fichier a été supprimé à ce moment-là, puis restauré ou remplacé par la suite.",
                          de: "Die Datei wurde zu diesem Zeitpunkt gelöscht und später wiederhergestellt oder ersetzt.",
                        })}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}

        {history?.is_truncated ? (
          <div className="mt-4 flex justify-center">
            <UiButton size="sm" variant="secondary" onClick={onLoadMore} disabled={loading}>
              {t({
                en: "Show older versions",
                fr: "Afficher les versions plus anciennes",
                de: "Ältere Versionen anzeigen",
              })}
            </UiButton>
          </div>
        ) : null}

        {history && !history.can_restore ? (
          <p className={cx("mt-4 text-xs font-semibold", uiMutedTextClass)}>
            {t({
              en: "Your access is read-only. You can review history but cannot restore a version.",
              fr: "Votre accès est en lecture seule. Vous pouvez consulter l'historique, mais pas restaurer une version.",
              de: "Ihr Zugriff ist schreibgeschützt. Sie können den Verlauf ansehen, aber keine Version wiederherstellen.",
            })}
          </p>
        ) : null}
      </UiCard>
    </div>
  );
}
