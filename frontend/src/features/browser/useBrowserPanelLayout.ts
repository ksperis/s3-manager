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
  resolveBrowserPanelWidths,
} from "./browserPanelLayout";
import type { BrowserLayoutMode } from "./browserActions";
import { resolveBrowserPanelVisibility } from "./browserResponsivePanels";
import {
  DEFAULT_FOLDERS_PANEL_WIDTH_PX,
  DEFAULT_INSPECTOR_PANEL_WIDTH_PX,
  writeBrowserRootUiLayout,
} from "./browserRootUiState";
import { useMediaQuery } from "../../hooks/useMediaQuery";

type PanelSide = "folders" | "inspector";

type UseBrowserPanelLayoutOptions = {
  allowFoldersPanel: boolean;
  allowInspectorPanel: boolean;
  initialFoldersPanelWidthPx: number;
  initialInspectorPanelWidthPx: number;
  layoutMode: BrowserLayoutMode;
  persistWidths: boolean;
  showFolders: boolean;
  showInspector: boolean;
};

export function useBrowserPanelLayout({
  allowFoldersPanel,
  allowInspectorPanel,
  initialFoldersPanelWidthPx,
  initialInspectorPanelWidthPx,
  layoutMode,
  persistWidths,
  showFolders,
  showInspector,
}: UseBrowserPanelLayoutOptions) {
  const [foldersPanelWidthPx, setFoldersPanelWidthPx] = useState(
    initialFoldersPanelWidthPx,
  );
  const [inspectorPanelWidthPx, setInspectorPanelWidthPx] = useState(
    initialInspectorPanelWidthPx,
  );
  const [layoutContainerWidthPx, setLayoutContainerWidthPx] = useState(0);
  const [activePanelResize, setActivePanelResize] =
    useState<PanelSide | null>(null);
  const isNarrowViewport = useMediaQuery(PANELS_DISABLE_MEDIA_QUERY);
  const layoutContainerRef = useRef<HTMLDivElement | null>(null);
  const foldersPanelWidthRef = useRef(foldersPanelWidthPx);
  const inspectorPanelWidthRef = useRef(inspectorPanelWidthPx);
  const isFoldersPanelVisibleRef = useRef(false);
  const isInspectorPanelVisibleRef = useRef(false);

  const {
    canUseFoldersPanel,
    canUseInspectorPanel,
    isFoldersPanelVisible,
    isInspectorPanelVisible,
  } = resolveBrowserPanelVisibility({
    allowFoldersPanel,
    allowInspectorPanel,
    isNarrowViewport,
    showFolders,
    showInspector,
  });
  foldersPanelWidthRef.current = foldersPanelWidthPx;
  inspectorPanelWidthRef.current = inspectorPanelWidthPx;
  isFoldersPanelVisibleRef.current = isFoldersPanelVisible;
  isInspectorPanelVisibleRef.current = isInspectorPanelVisible;

  const { resolvedFoldersWidth, resolvedInspectorWidth } = useMemo(
    () =>
      resolveBrowserPanelWidths({
        containerWidth: layoutContainerWidthPx,
        foldersPanelWidthPx,
        inspectorPanelWidthPx,
        isFoldersPanelVisible,
        isInspectorPanelVisible,
      }),
    [
      foldersPanelWidthPx,
      inspectorPanelWidthPx,
      isFoldersPanelVisible,
      isInspectorPanelVisible,
      layoutContainerWidthPx,
    ],
  );
  const layoutTemplateColumns = useMemo(() => {
    if (isFoldersPanelVisible && isInspectorPanelVisible) {
      return `${resolvedFoldersWidth}px minmax(0, 1fr) ${resolvedInspectorWidth}px`;
    }
    if (isFoldersPanelVisible) {
      return `${resolvedFoldersWidth}px minmax(0, 1fr)`;
    }
    if (isInspectorPanelVisible) {
      return `minmax(0, 1fr) ${resolvedInspectorWidth}px`;
    }
    return "minmax(0, 1fr)";
  }, [
    isFoldersPanelVisible,
    isInspectorPanelVisible,
    resolvedFoldersWidth,
    resolvedInspectorWidth,
  ]);

  useLayoutEffect(() => {
    const updateLayoutContainerWidth = () => {
      setLayoutContainerWidthPx(
        Math.round(layoutContainerRef.current?.getBoundingClientRect().width ?? 0),
      );
    };
    updateLayoutContainerWidth();
    if (typeof window === "undefined") return;
    window.addEventListener("resize", updateLayoutContainerWidth);
    if (typeof ResizeObserver === "undefined" || !layoutContainerRef.current) {
      return () => {
        window.removeEventListener("resize", updateLayoutContainerWidth);
      };
    }
    const observer = new ResizeObserver(updateLayoutContainerWidth);
    observer.observe(layoutContainerRef.current);
    return () => {
      window.removeEventListener("resize", updateLayoutContainerWidth);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (activePanelResize || !persistWidths) return;
    writeBrowserRootUiLayout(
      { foldersPanelWidthPx, inspectorPanelWidthPx },
      layoutMode,
    );
  }, [
    activePanelResize,
    foldersPanelWidthPx,
    inspectorPanelWidthPx,
    layoutMode,
    persistWidths,
  ]);

  useEffect(() => {
    if (!activePanelResize) return;
    const handlePointerMove = (event: PointerEvent) => {
      const rect = layoutContainerRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (activePanelResize === "folders") {
        if (!isFoldersPanelVisibleRef.current) return;
        const nextWidth = event.clientX - rect.left - PANEL_LAYOUT_GAP_PX / 2;
        const { resolvedFoldersWidth: nextFoldersWidth } =
          resolveBrowserPanelWidths({
            containerWidth: rect.width,
            foldersPanelWidthPx: nextWidth,
            inspectorPanelWidthPx: inspectorPanelWidthRef.current,
            isFoldersPanelVisible: isFoldersPanelVisibleRef.current,
            isInspectorPanelVisible: isInspectorPanelVisibleRef.current,
          });
        setFoldersPanelWidthPx(nextFoldersWidth);
        return;
      }
      if (!isInspectorPanelVisibleRef.current) return;
      const nextWidth = rect.right - event.clientX - PANEL_LAYOUT_GAP_PX / 2;
      const { resolvedInspectorWidth: nextInspectorWidth } =
        resolveBrowserPanelWidths({
          containerWidth: rect.width,
          foldersPanelWidthPx: foldersPanelWidthRef.current,
          inspectorPanelWidthPx: nextWidth,
          isFoldersPanelVisible: isFoldersPanelVisibleRef.current,
          isInspectorPanelVisible: isInspectorPanelVisibleRef.current,
        });
      setInspectorPanelWidthPx(nextInspectorWidth);
    };
    const stopPanelResize = () => setActivePanelResize(null);
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
  }, [activePanelResize]);

  const startPanelResize = useCallback(
    (side: PanelSide) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (
        (side === "folders" && !isFoldersPanelVisibleRef.current) ||
        (side === "inspector" && !isInspectorPanelVisibleRef.current)
      ) {
        return;
      }
      event.preventDefault();
      setActivePanelResize(side);
    },
    [],
  );
  const setPanelWidths = useCallback(
    (foldersWidthPx: number, inspectorWidthPx: number) => {
      setFoldersPanelWidthPx(foldersWidthPx);
      setInspectorPanelWidthPx(inspectorWidthPx);
    },
    [],
  );
  const resetFoldersPanelWidth = useCallback(
    () => setFoldersPanelWidthPx(DEFAULT_FOLDERS_PANEL_WIDTH_PX),
    [],
  );
  const resetInspectorPanelWidth = useCallback(
    () => setInspectorPanelWidthPx(DEFAULT_INSPECTOR_PANEL_WIDTH_PX),
    [],
  );

  return {
    activePanelResize,
    canUseFoldersPanel,
    canUseInspectorPanel,
    isFoldersPanelVisible,
    isInspectorPanelVisible,
    layoutContainerRef,
    layoutTemplateColumns,
    resolvedFoldersWidth,
    resolvedInspectorWidth,
    resetFoldersPanelWidth,
    resetInspectorPanelWidth,
    setPanelWidths,
    startPanelResize,
  };
}
