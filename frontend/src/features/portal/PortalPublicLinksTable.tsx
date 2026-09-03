/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";

import type { PortalPublicLink } from "../../api/portalSharing";
import DataTableShell, {
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import type { ListTableStatus } from "../../components/list/listTableStatus";
import {
  tableActionButtonClasses,
  tableDeleteActionClasses,
} from "../../components/tableActionClasses";
import UiBadge from "../../components/ui/UiBadge";
import { useI18n } from "../../i18n";
import {
  portalDateLabel,
  portalDateTimeLabel,
  portalPublicLinkStatusLabel,
} from "./portalI18n";

type PortalPublicLinksTableProps = {
  links: PortalPublicLink[];
  status: ListTableStatus;
  errorMessage?: string;
  emptyMessage: string;
  busyLinkId?: number | null;
  showSpaceColumn?: boolean;
  showCopyForInactive?: boolean;
  expirationFormat?: "date" | "datetime";
  copyLabel?: string;
  onCopy: (link: PortalPublicLink) => void;
  onRevoke: (link: PortalPublicLink) => void;
};

export default function PortalPublicLinksTable({
  links,
  status,
  errorMessage,
  emptyMessage,
  busyLinkId = null,
  showSpaceColumn = false,
  showCopyForInactive = false,
  expirationFormat = "datetime",
  copyLabel,
  onCopy,
  onRevoke,
}: PortalPublicLinksTableProps) {
  const { locale, t } = useI18n();
  const columns = useMemo<DataTableColumn<PortalPublicLink>[]>(
    () => [
      ...(showSpaceColumn
        ? [
            {
              id: "space",
              label: t({ en: "Space", fr: "Espace", de: "Bereich" }),
              primary: true,
              render: (link: PortalPublicLink) => link.storage_space_name,
            },
          ]
        : []),
      {
        id: "file",
        label: t({ en: "File", fr: "Fichier", de: "Datei" }),
        primary: !showSpaceColumn,
        render: (link) => link.object_name,
      },
      {
        id: "status",
        label: t({ en: "Status", fr: "Statut", de: "Status" }),
        render: (link) => (
          <UiBadge tone={link.status === "Active" ? "success" : "neutral"}>
            {portalPublicLinkStatusLabel(link.status, t)}
          </UiBadge>
        ),
      },
      {
        id: "expires",
        label: t({ en: "Expires", fr: "Expire", de: "Läuft ab" }),
        render: (link) =>
          link.expires_at
            ? expirationFormat === "date"
              ? portalDateLabel(link.expires_at, locale)
              : portalDateTimeLabel(link.expires_at, locale)
            : "-",
      },
      {
        id: "url",
        label: t({ en: "URL", fr: "URL", de: "URL" }),
        cellClassName:
          "max-w-[260px] truncate text-primary dark:text-primary-200",
        render: (link) => link.url,
      },
      {
        id: "action",
        label: t({ en: "Action", fr: "Action", de: "Aktion" }),
        align: "right",
        mobileRole: "actions",
        render: (link) => (
          <div className="flex flex-wrap justify-end gap-2 max-md:justify-start">
            {showCopyForInactive || link.status === "Active" ? (
              <button
                type="button"
                onClick={() => onCopy(link)}
                className={tableActionButtonClasses}
              >
                {copyLabel ??
                  t({
                    en: "Copy link",
                    fr: "Copier le lien",
                    de: "Link kopieren",
                  })}
              </button>
            ) : null}
            {link.status === "Active" ? (
              <button
                type="button"
                disabled={busyLinkId === link.id}
                onClick={() => onRevoke(link)}
                className={tableDeleteActionClasses}
              >
                {t({ en: "Revoke", fr: "Révoquer", de: "Widerrufen" })}
              </button>
            ) : null}
          </div>
        ),
      },
    ],
    [
      busyLinkId,
      copyLabel,
      expirationFormat,
      locale,
      onCopy,
      onRevoke,
      showCopyForInactive,
      showSpaceColumn,
      t,
    ],
  );

  return (
    <DataTableShell
      columns={columns}
      rows={links}
      rowKey={(link) => link.id}
      status={status}
      loadingMessage={t({
        en: "Loading links...",
        fr: "Chargement des liens...",
        de: "Links werden geladen...",
      })}
      errorMessage={
        errorMessage ??
        t({
          en: "Unable to load links.",
          fr: "Impossible de charger les liens.",
          de: "Links können nicht geladen werden.",
        })
      }
      emptyMessage={emptyMessage}
      responsiveCards
    />
  );
}
