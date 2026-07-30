/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import type { PortalTrashItem, PortalTrashResponse } from "../../api/portal";
import PageBanner from "../../components/PageBanner";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import UiInput from "../../components/ui/UiInput";
import { cx, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { formatBytes } from "../../utils/format";
import { portalDateTimeLabel } from "./portalI18n";

type PortalTrashPanelProps = {
  trash: PortalTrashResponse | null;
  loading: boolean;
  error: string | null;
  restoringKey?: string | null;
  onRefresh: () => void;
  onLoadMore: () => void;
  onRestore: (item: PortalTrashItem) => void;
};

export default function PortalTrashPanel({
  trash,
  loading,
  error,
  restoringKey = null,
  onRefresh,
  onLoadMore,
  onRestore,
}: PortalTrashPanelProps) {
  const { locale, t } = useI18n();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleItems = useMemo(
    () =>
      normalizedQuery
        ? (trash?.items ?? []).filter((item) =>
            item.key.toLocaleLowerCase().includes(normalizedQuery),
          )
        : (trash?.items ?? []),
    [normalizedQuery, trash?.items],
  );

  return (
    <section className="space-y-4">
      <PageBanner tone="info">
        {t({
          en: "Deleted files stay here while their history is retained. Restoring puts the file back in its original location without removing older history.",
          fr: "Les fichiers supprimés restent ici tant que leur historique est conservé. La restauration replace le fichier à son emplacement d'origine sans effacer les anciennes versions.",
          de: "Gelöschte Dateien bleiben hier, solange ihr Verlauf aufbewahrt wird. Beim Wiederherstellen wird die Datei an ihren ursprünglichen Ort zurückgelegt, ohne ältere Versionen zu entfernen.",
        })}
      </PageBanner>

      <UiCard
        title={t({
          en: "Deleted files",
          fr: "Fichiers supprimés",
          de: "Gelöschte Dateien",
        })}
        actions={
          <UiButton size="xs" variant="secondary" onClick={onRefresh} disabled={loading}>
            {t({ en: "Refresh", fr: "Actualiser", de: "Aktualisieren" })}
          </UiButton>
        }
      >
        <div className="mb-4 max-w-md">
          <UiInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t({
              en: "Search deleted files",
              fr: "Rechercher dans la corbeille",
              de: "Gelöschte Dateien suchen",
            })}
            aria-label={t({
              en: "Search deleted files",
              fr: "Rechercher dans la corbeille",
              de: "Gelöschte Dateien suchen",
            })}
          />
        </div>

        {error ? (
          <PageBanner tone="warning">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{error}</span>
              <UiButton size="xs" variant="secondary" onClick={onRefresh}>
                {t({ en: "Try again", fr: "Réessayer", de: "Erneut versuchen" })}
              </UiButton>
            </div>
          </PageBanner>
        ) : null}

        {loading && !trash ? (
          <div className={cx("py-10 text-center text-sm font-semibold", uiMutedTextClass)}>
            {t({
              en: "Loading trash...",
              fr: "Chargement de la corbeille...",
              de: "Papierkorb wird geladen...",
            })}
          </div>
        ) : null}

        {trash && trash.items.length === 0 && !loading ? (
          <div className="rounded-md border border-dashed border-[color:var(--ui-border)] px-4 py-10 text-center">
            <div className={cx("text-sm font-bold", uiTitleTextClass)}>
              {t({
                en: "Trash is empty",
                fr: "La corbeille est vide",
                de: "Der Papierkorb ist leer",
              })}
            </div>
            <p className={cx("mt-1 text-xs", uiMutedTextClass)}>
              {t({
                en: "Deleted files will appear here when file history is enabled.",
                fr: "Les fichiers supprimés apparaîtront ici lorsque l'historique est actif.",
                de: "Gelöschte Dateien werden hier angezeigt, wenn der Dateiverlauf aktiviert ist.",
              })}
            </p>
          </div>
        ) : null}

        {trash && trash.items.length > 0 && visibleItems.length === 0 ? (
          <div className={cx("py-8 text-center text-sm font-semibold", uiMutedTextClass)}>
            {t({
              en: "No deleted file matches this search.",
              fr: "Aucun fichier supprimé ne correspond à cette recherche.",
              de: "Keine gelöschte Datei entspricht dieser Suche.",
            })}
          </div>
        ) : null}

        {visibleItems.length > 0 ? (
          <ul className="divide-y divide-[color:var(--ui-border-soft)]">
            {visibleItems.map((item) => {
              const restoring = restoringKey === item.key;
              return (
                <li
                  key={item.delete_marker_version_id}
                  className="grid gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                >
                  <div className="min-w-0">
                    <div className={cx("break-all text-sm font-bold", uiTitleTextClass)}>
                      {item.name}
                    </div>
                    <div className={cx("mt-1 break-all text-xs", uiMutedTextClass)}>
                      {item.key}
                    </div>
                    <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px]">
                      <div>
                        <dt className={cx("inline font-semibold", uiMutedTextClass)}>
                          {t({ en: "Deleted", fr: "Supprimé", de: "Gelöscht" })}:{" "}
                        </dt>
                        <dd className="inline font-semibold">
                          {portalDateTimeLabel(item.deleted_at, locale)}
                        </dd>
                      </div>
                      {item.size != null ? (
                        <div>
                          <dt className={cx("inline font-semibold", uiMutedTextClass)}>
                            {t({ en: "Last size", fr: "Dernière taille", de: "Letzte Größe" })}:{" "}
                          </dt>
                          <dd className="inline font-semibold">{formatBytes(item.size)}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>
                  {trash?.can_restore ? (
                    <UiButton
                      size="sm"
                      variant="secondary"
                      loading={restoring}
                      disabled={Boolean(restoringKey)}
                      onClick={() => onRestore(item)}
                    >
                      {t({
                        en: "Restore",
                        fr: "Restaurer",
                        de: "Wiederherstellen",
                      })}
                    </UiButton>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        {trash?.is_truncated ? (
          <div className="mt-4 flex justify-center">
            <UiButton size="sm" variant="secondary" onClick={onLoadMore} disabled={loading}>
              {t({
                en: "Show more deleted files",
                fr: "Afficher plus de fichiers supprimés",
                de: "Weitere gelöschte Dateien anzeigen",
              })}
            </UiButton>
          </div>
        ) : null}

        {trash && !trash.can_restore ? (
          <p className={cx("mt-4 text-xs font-semibold", uiMutedTextClass)}>
            {t({
              en: "Your access is read-only. You can review deleted files but cannot restore them.",
              fr: "Votre accès est en lecture seule. Vous pouvez consulter les fichiers supprimés, mais pas les restaurer.",
              de: "Ihr Zugriff ist schreibgeschützt. Sie können gelöschte Dateien ansehen, aber nicht wiederherstellen.",
            })}
          </p>
        ) : null}
      </UiCard>
    </section>
  );
}
