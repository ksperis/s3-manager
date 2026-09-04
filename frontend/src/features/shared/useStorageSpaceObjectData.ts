/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { S3AccountSelector } from "../../api/accountParams";
import {
  fetchPortalStorageSpaceObjectDetail,
  fetchPortalStorageSpaceObjectVersions,
  type PortalStorageObjectDetail,
  type PortalStorageObjectVersionsResponse,
} from "../../api/portal";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";

type UseStorageSpaceObjectDataOptions = {
  accountId: S3AccountSelector;
  historyActive: boolean;
  isDeleted: boolean;
  objectKey: string;
  spaceId: string;
};

export function useStorageSpaceObjectData({
  accountId,
  historyActive,
  isDeleted,
  objectKey,
  spaceId,
}: UseStorageSpaceObjectDataOptions) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<PortalStorageObjectDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [history, setHistory] =
    useState<PortalStorageObjectVersionsResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const detailRequestIdRef = useRef(0);
  const historyRequestIdRef = useRef(0);
  const historyBusyRef = useRef(false);

  const loadDetail = useCallback(async () => {
    const requestId = ++detailRequestIdRef.current;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const response = await fetchPortalStorageSpaceObjectDetail(
        accountId,
        spaceId,
        objectKey,
      );
      if (requestId === detailRequestIdRef.current) setDetail(response);
      return response;
    } catch (error) {
      console.error(error);
      if (requestId === detailRequestIdRef.current) {
        setDetailError(
          extractApiError(
            error,
            t({
              en: "Unable to load file details.",
              fr: "Impossible de charger les détails du fichier.",
              de: "Dateidetails können nicht geladen werden.",
            }),
          ),
        );
      }
      return null;
    } finally {
      if (requestId === detailRequestIdRef.current) setDetailLoading(false);
    }
  }, [accountId, objectKey, spaceId, t]);

  const loadHistory = useCallback(
    async (
      markers?: { keyMarker?: string | null; versionIdMarker?: string | null },
      append = false,
    ) => {
      if (historyBusyRef.current) return;
      historyBusyRef.current = true;
      const requestId = ++historyRequestIdRef.current;
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const response = await fetchPortalStorageSpaceObjectVersions(
          accountId,
          spaceId,
          objectKey,
          markers,
        );
        if (requestId !== historyRequestIdRef.current) return;
        setHistory((current) => {
          if (!append || !current) return response;
          return {
            ...response,
            versions: [...current.versions, ...response.versions].filter(
              (version, index, all) =>
                all.findIndex(
                  (candidate) =>
                    candidate.version_id === version.version_id &&
                    candidate.is_delete_marker === version.is_delete_marker,
                ) === index,
            ),
          };
        });
      } catch (error) {
        console.error(error);
        if (requestId === historyRequestIdRef.current) {
          setHistoryError(
            extractApiError(
              error,
              t({
                en: "Unable to load file history.",
                fr: "Impossible de charger l’historique du fichier.",
                de: "Der Dateiverlauf kann nicht geladen werden.",
              }),
            ),
          );
        }
      } finally {
        if (requestId === historyRequestIdRef.current) {
          historyBusyRef.current = false;
          setHistoryLoading(false);
        }
      }
    },
    [accountId, objectKey, spaceId, t],
  );

  useEffect(() => {
    setDetail(null);
    setDetailError(null);
    setHistory(null);
    setHistoryError(null);
    historyBusyRef.current = false;
    historyRequestIdRef.current += 1;
    if (isDeleted) {
      detailRequestIdRef.current += 1;
      setDetailLoading(false);
    } else {
      void loadDetail();
    }
    return () => {
      detailRequestIdRef.current += 1;
      historyRequestIdRef.current += 1;
      historyBusyRef.current = false;
    };
  }, [isDeleted, loadDetail]);

  useEffect(() => {
    if (historyActive && !history && !historyBusyRef.current) {
      void loadHistory();
    }
  }, [history, historyActive, loadHistory]);

  const refreshAfterRestore = useCallback(async () => {
    setHistory(null);
    await Promise.all([loadHistory(), loadDetail()]);
  }, [loadDetail, loadHistory]);

  return {
    detail,
    detailError,
    detailLoading,
    history,
    historyError,
    historyLoading,
    loadHistory,
    refreshAfterRestore,
  };
}
