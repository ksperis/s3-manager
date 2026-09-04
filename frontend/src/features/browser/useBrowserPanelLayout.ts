/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  PANEL_LAYOUT_GAP_PX,
  PANELS_DISABLE_MEDIA_QUERY,
  clampBrowserPanelWidth,
} from "./browserPanelLayout";
import {
  DEFAULT_FOLDERS_PANEL_WIDTH_PX,
  MAX_FOLDERS_PANEL_WIDTH_PX,
  MIN_FOLDERS_PANEL_WIDTH_PX,
  writeBrowserRootUiLayout,
} from "./browserRootUiState";
import { useMediaQuery } from "../../hooks/useMediaQuery";

const MIN_BROWSER_CENTER_WIDTH_PX = 320;

type UseBrowserPanelLayoutOptions = {
  allowFoldersPanel: boolean;
  initialFoldersPanelWidthPx: number;
  initialShowFolders: boolean;
  persistLayout: boolean;
};

export function useBrowserPanelLayout({
  allowFoldersPanel,
  initialFoldersPanelWidthPx,
  initialShowFolders,
  persistLayout,
}: UseBrowserPanelLayoutOptions) {
  const [showFolders, setShowFolders] = useState(initialShowFolders);
  const [foldersPanelWidthPx, setFoldersPanelWidthPx] = useState(
    initialFoldersPanelWidthPx,
  );
  const [layoutContainerWidthPx, setLayoutContainerWidthPx] = useState(0);
  const [foldersPanelResizeActive, setFoldersPanelResizeActive] =
    useState(false);
  const isNarrowViewport = useMediaQuery(PANELS_DISABLE_MEDIA_QUERY);
  const layoutContainerRef = useRef<HTMLDivElement | null>(null);
  const foldersPanelWidthRef = useRef(foldersPanelWidthPx);
  const isFoldersPanelVisibleRef = useRef(false);

  const canUseFoldersPanel = allowFoldersPanel && !isNarrowViewport;
  const isFoldersPanelVisible = canUseFoldersPanel && showFolders;
  foldersPanelWidthRef.current = foldersPanelWidthPx;
  isFoldersPanelVisibleRef.current = isFoldersPanelVisible;

  const resolvedFoldersWidth = useMemo(() => {
    const maximumFromViewport =
      layoutContainerWidthPx > 0
        ? layoutContainerWidthPx -
          PANEL_LAYOUT_GAP_PX -
          MIN_BROWSER_CENTER_WIDTH_PX
        : MAX_FOLDERS_PANEL_WIDTH_PX;
    return clampBrowserPanelWidth(
      foldersPanelWidthPx,
      MIN_FOLDERS_PANEL_WIDTH_PX,
      Math.min(
        MAX_FOLDERS_PANEL_WIDTH_PX,
        Math.max(MIN_FOLDERS_PANEL_WIDTH_PX, maximumFromViewport),
      ),
    );
  }, [foldersPanelWidthPx, layoutContainerWidthPx]);

  const layoutTemplateColumns = isFoldersPanelVisible
    ? `${resolvedFoldersWidth}px minmax(0, 1fr)`
    : "minmax(0, 1fr)";

  useLayoutEffect(() => {
    const updateLayoutContainerWidth = () => {
      setLayoutContainerWidthPx(
        Math.round(
          layoutContainerRef.current?.getBoundingClientRect().width ?? 0,
        ),
      );
    };
    updateLayoutContainerWidth();
    if (typeof window === "undefined") return;
    window.addEventListener("resize", updateLayoutContainerWidth);
    if (typeof ResizeObserver === "undefined" || !layoutContainerRef.current) {
      return () => window.removeEventListener("resize", updateLayoutContainerWidth);
    }
    const observer = new ResizeObserver(updateLayoutContainerWidth);
    observer.observe(layoutContainerRef.current);
    return () => {
      window.removeEventListener("resize", updateLayoutContainerWidth);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (foldersPanelResizeActive || !persistLayout) return;
    writeBrowserRootUiLayout({
      foldersPanelWidthPx,
      showFolders,
    });
  }, [
    foldersPanelResizeActive,
    foldersPanelWidthPx,
    persistLayout,
    showFolders,
  ]);

  useEffect(() => {
    if (!foldersPanelResizeActive) return;
    const handlePointerMove = (event: PointerEvent) => {
      const rect = layoutContainerRef.current?.getBoundingClientRect();
      if (!rect || !isFoldersPanelVisibleRef.current) return;
      setFoldersPanelWidthPx(
        clampBrowserPanelWidth(
          event.clientX - rect.left - PANEL_LAYOUT_GAP_PX / 2,
          MIN_FOLDERS_PANEL_WIDTH_PX,
          Math.max(
            MIN_FOLDERS_PANEL_WIDTH_PX,
            Math.min(
              MAX_FOLDERS_PANEL_WIDTH_PX,
              rect.width - PANEL_LAYOUT_GAP_PX - MIN_BROWSER_CENTER_WIDTH_PX,
            ),
          ),
        ),
      );
    };
    const stopPanelResize = () => setFoldersPanelResizeActive(false);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", stopPanelResize);
    document.addEventListener("pointercancel", stopPanelResize);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", stopPanelResize);
      document.removeEventListener("pointercancel", stopPanelResize);
    };
  }, [foldersPanelResizeActive]);

  const startFoldersPanelResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isFoldersPanelVisibleRef.current) return;
      event.preventDefault();
      setFoldersPanelResizeActive(true);
    },
    [],
  );
  const resetFoldersPanelWidth = useCallback(
    () => setFoldersPanelWidthPx(DEFAULT_FOLDERS_PANEL_WIDTH_PX),
    [],
  );
  const adjustFoldersPanelWidth = useCallback((deltaPx: number) => {
    setFoldersPanelWidthPx((current) =>
      clampBrowserPanelWidth(
        current + deltaPx,
        MIN_FOLDERS_PANEL_WIDTH_PX,
        MAX_FOLDERS_PANEL_WIDTH_PX,
      ),
    );
  }, []);
  const toggleFoldersPanel = useCallback(() => {
    if (!canUseFoldersPanel) return;
    setShowFolders((current) => !current);
  }, [canUseFoldersPanel]);
  return {
    adjustFoldersPanelWidth,
    canUseFoldersPanel,
    foldersPanelResizeActive,
    isFoldersPanelVisible,
    layoutContainerRef,
    layoutTemplateColumns,
    resetFoldersPanelWidth,
    resolvedFoldersWidth,
    showFolders,
    startFoldersPanelResize,
    toggleFoldersPanel,
  };
}
