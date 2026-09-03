/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";

import type { S3AccountSelector } from "../../api/accountParams";
import {
  revokePortalStorageSpacePublicLink,
  type PortalPublicLink,
} from "../../api/portalSharing";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { copyTextToClipboard } from "../../utils/clipboard";

type UsePortalPublicLinkActionsOptions = {
  accountId: S3AccountSelector;
  onLinksUpdated: (
    links: PortalPublicLink[],
    revokedLink: PortalPublicLink,
  ) => void;
  onMessage: (message: string | null) => void;
  onError: (message: string | null) => void;
  copySuccessMessage?: string;
};

export function usePortalPublicLinkActions({
  accountId,
  onLinksUpdated,
  onMessage,
  onError,
  copySuccessMessage,
}: UsePortalPublicLinkActionsOptions) {
  const { t } = useI18n();
  const [busyLinkId, setBusyLinkId] = useState<number | null>(null);

  const copyLink = useCallback(
    async (link: PortalPublicLink) => {
      onMessage(null);
      onError(null);
      try {
        await copyTextToClipboard(link.url);
        onMessage(
          copySuccessMessage ??
            t({ en: "Link copied.", fr: "Lien copié.", de: "Link kopiert." }),
        );
      } catch {
        onMessage(
          t({
            en: "Clipboard is unavailable in this browser.",
            fr: "Le presse-papiers est indisponible dans ce navigateur.",
            de: "Die Zwischenablage ist in diesem Browser nicht verfügbar.",
          }),
        );
      }
    },
    [copySuccessMessage, onError, onMessage, t],
  );

  const revokeLink = useCallback(
    async (link: PortalPublicLink) => {
      if (accountId == null || busyLinkId != null) return;
      setBusyLinkId(link.id);
      onMessage(null);
      onError(null);
      try {
        const links = await revokePortalStorageSpacePublicLink(
          accountId,
          link.storage_space_id,
          link.id,
        );
        onLinksUpdated(links, link);
        onMessage(
          t({
            en: "Public link revoked.",
            fr: "Lien public révoqué.",
            de: "Öffentlicher Link widerrufen.",
          }),
        );
      } catch (err) {
        console.error(err);
        onError(
          extractApiError(
            err,
            t({
              en: "Unable to revoke public link.",
              fr: "Impossible de révoquer le lien public.",
              de: "Öffentlicher Link kann nicht widerrufen werden.",
            }),
          ),
        );
      } finally {
        setBusyLinkId(null);
      }
    },
    [accountId, busyLinkId, onError, onLinksUpdated, onMessage, t],
  );

  return { busyLinkId, copyLink, revokeLink };
}
