/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { S3AccountSelector } from "../../api/accountParams";
import {
  createPortalStorageSpacePublicLink,
  listPortalStorageSpacePublicLinks,
  type PortalPublicLink,
} from "../../api/portalSharing";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { copyTextToClipboard } from "../../utils/clipboard";
import { usePortalPublicLinkActions } from "../portal/usePortalPublicLinkActions";

type UseStorageSpaceObjectSharingOptions = {
  accountId: S3AccountSelector;
  active: boolean;
  canCreate: boolean;
  canManage: boolean;
  createRequestToken: number;
  objectKey: string;
  objectName: string;
  onCreateRequestHandled?: () => void;
  onMessage: (message: string | null) => void;
  onPublicLinkCreated?: (link: PortalPublicLink) => void;
  spaceId: string;
};

export function useStorageSpaceObjectSharing({
  accountId,
  active,
  canCreate,
  canManage,
  createRequestToken,
  objectKey,
  objectName,
  onCreateRequestHandled,
  onMessage,
  onPublicLinkCreated,
  spaceId,
}: UseStorageSpaceObjectSharingOptions) {
  const { t } = useI18n();
  const [links, setLinks] = useState<PortalPublicLink[]>([]);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linksError, setLinksError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [expiration, setExpiration] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdLink, setCreatedLink] = useState<PortalPublicLink | null>(null);
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const linksRequestIdRef = useRef(0);
  const linksBusyRef = useRef(false);

  const loadLinks = useCallback(async () => {
    if (!canManage || linksBusyRef.current) return;
    linksBusyRef.current = true;
    const requestId = ++linksRequestIdRef.current;
    setLinksLoading(true);
    setLinksError(null);
    try {
      const response = await listPortalStorageSpacePublicLinks(accountId, spaceId, {
        objectKey,
        includeRevoked: true,
      });
      if (requestId === linksRequestIdRef.current) setLinks(response);
    } catch (error) {
      console.error(error);
      if (requestId === linksRequestIdRef.current) {
        setLinksError(
          extractApiError(
            error,
            t({
              en: "Unable to load public links.",
              fr: "Impossible de charger les liens publics.",
              de: "Öffentliche Links können nicht geladen werden.",
            }),
          ),
        );
      }
    } finally {
      if (requestId === linksRequestIdRef.current) {
        linksBusyRef.current = false;
        setLinksLoading(false);
      }
    }
  }, [accountId, canManage, objectKey, spaceId, t]);

  useEffect(() => {
    linksRequestIdRef.current += 1;
    linksBusyRef.current = false;
    setLinks([]);
    setLinksError(null);
    setCreateOpen(false);
    setExpiration("");
    setCreateError(null);
    setCreatedLink(null);
    setCreateMessage(null);
    return () => {
      linksRequestIdRef.current += 1;
      linksBusyRef.current = false;
    };
  }, [accountId, objectKey, spaceId]);

  useEffect(() => {
    if (active && canManage) void loadLinks();
  }, [active, canManage, loadLinks]);

  const openCreate = useCallback(() => {
    if (!canCreate) return;
    setExpiration("");
    setCreateError(null);
    setCreatedLink(null);
    setCreateMessage(null);
    setCreateOpen(true);
  }, [canCreate]);

  useEffect(() => {
    if (createRequestToken <= 0 || !canCreate) return;
    openCreate();
    onCreateRequestHandled?.();
  }, [canCreate, createRequestToken, onCreateRequestHandled, openCreate]);

  const closeCreate = useCallback(() => {
    if (createBusy) return;
    setCreateOpen(false);
    setExpiration("");
    setCreateError(null);
    setCreatedLink(null);
    setCreateMessage(null);
  }, [createBusy]);

  const createLink = useCallback(async () => {
    if (!canCreate || createBusy) return;
    let expiresAt: string | null = null;
    if (expiration) {
      const expirationDate = new Date(expiration);
      if (Number.isNaN(expirationDate.getTime())) {
        setCreateError(
          t({
            en: "Choose a valid expiration date.",
            fr: "Choisissez une date d'expiration valide.",
            de: "Wählen Sie ein gültiges Ablaufdatum.",
          }),
        );
        return;
      }
      expiresAt = expirationDate.toISOString();
    }
    setCreateBusy(true);
    setCreateError(null);
    setCreateMessage(null);
    try {
      const link = await createPortalStorageSpacePublicLink(accountId, spaceId, {
        object_key: objectKey,
        label: objectName,
        expires_at: expiresAt,
      });
      setCreatedLink(link);
      onPublicLinkCreated?.(link);
      onMessage(
        t({
          en: "Public link created.",
          fr: "Lien public créé.",
          de: "Öffentlicher Link erstellt.",
        }),
      );
      await loadLinks();
    } catch (error) {
      console.error(error);
      setCreateError(
        extractApiError(
          error,
          t({
            en: "Unable to create public link.",
            fr: "Impossible de créer le lien public.",
            de: "Öffentlicher Link kann nicht erstellt werden.",
          }),
        ),
      );
    } finally {
      setCreateBusy(false);
    }
  }, [
    accountId,
    canCreate,
    createBusy,
    expiration,
    loadLinks,
    objectKey,
    objectName,
    onMessage,
    onPublicLinkCreated,
    spaceId,
    t,
  ]);

  const copyCreatedLink = useCallback(async () => {
    if (!createdLink?.url) return;
    try {
      await copyTextToClipboard(createdLink.url);
      setCreateMessage(
        t({ en: "Link copied.", fr: "Lien copié.", de: "Link kopiert." }),
      );
    } catch {
      setCreateMessage(
        t({
          en: "Clipboard is unavailable in this browser.",
          fr: "Le presse-papiers est indisponible dans ce navigateur.",
          de: "Die Zwischenablage ist in diesem Browser nicht verfügbar.",
        }),
      );
    }
  }, [createdLink?.url, t]);

  const { busyLinkId, copyLink, revokeLink } = usePortalPublicLinkActions({
    accountId,
    onLinksUpdated: setLinks,
    onMessage,
    onError: setLinksError,
  });

  return {
    busyLinkId,
    closeCreate,
    copyCreatedLink,
    copyLink,
    createBusy,
    createError,
    createLink,
    createMessage,
    createOpen,
    createdLink,
    expiration,
    links,
    linksError,
    linksLoading,
    openCreate,
    revokeLink,
    setExpiration,
  };
}
