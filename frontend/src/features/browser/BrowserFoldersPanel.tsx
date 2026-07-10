/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { cx, uiCardClass } from "../../components/ui/styles";
import type { BrowserBucket } from "../../api/browser";
import { FolderIcon, RefreshIcon } from "./browserIcons";
import {
  treeItemActiveClasses,
  treeItemBaseClasses,
  treeItemInactiveClasses,
  treeToggleButtonClasses,
} from "./browserConstants";
import type { TreeNode } from "./browserTypes";
import type { BucketAccessEntry } from "./browserBucketsPanelHelpers";

type BrowserFoldersPanelProps = {
  currentBucket: BrowserBucket | null;
  activePrefix: string;
  currentBucketAccess: BucketAccessEntry;
  treeRootNode: TreeNode | null;
  workspaceNoun?: string;
  onRefresh: () => void;
  onSelectPrefix: (prefix: string) => void;
  onToggleTreeNode: (node: TreeNode) => void;
};

const panelSectionTitleClasses =
  "ui-caption font-semibold text-slate-500 dark:text-slate-400";
const panelIconButtonClasses =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--ui-muted-text)] transition hover:bg-[var(--ui-surface-muted)] hover:text-[var(--ui-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50";

function renderTreeNodes(
  nodes: TreeNode[],
  activePrefix: string,
  depth: number,
  onSelectPrefix: (prefix: string) => void,
  onToggleTreeNode: (node: TreeNode) => void,
): JSX.Element {
  return (
    <ul className="w-full min-w-0 space-y-1">
      {nodes.map((node) => {
        const isActive = activePrefix === node.prefix;
        const canToggle = node.isLoaded ? node.children.length > 0 : true;
        const labelClasses = `${treeItemBaseClasses} min-h-8 rounded-md px-2 py-1 ${
          isActive ? treeItemActiveClasses : treeItemInactiveClasses
        }`;
        return (
          <li key={node.id}>
            <div className="flex min-w-0 items-start gap-1" style={{ paddingLeft: depth * 12 }}>
              <button
                type="button"
                className={`${treeToggleButtonClasses} mt-1 h-5 w-5 rounded-md`}
                onClick={() => onToggleTreeNode(node)}
                disabled={!canToggle}
                aria-label={node.isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
                title={node.isExpanded ? "Collapse" : "Expand"}
              >
                {canToggle ? (node.isExpanded ? "-" : "+") : ""}
              </button>
              <button
                type="button"
                className={labelClasses}
                onClick={() => onSelectPrefix(node.prefix)}
                title={node.name}
              >
                <FolderIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{node.name}</span>
              </button>
            </div>
            {node.isExpanded && (node.isLoading || node.children.length > 0) && (
              <div className="mt-1">
                {node.isLoading ? (
                  <div className="pl-8 ui-caption text-slate-400 dark:text-slate-500">Loading folders...</div>
                ) : (
                  renderTreeNodes(node.children, activePrefix, depth + 1, onSelectPrefix, onToggleTreeNode)
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function BrowserFoldersPanel({
  currentBucket,
  activePrefix,
  currentBucketAccess,
  treeRootNode,
  workspaceNoun = "bucket",
  onRefresh,
  onSelectPrefix,
  onToggleTreeNode,
}: BrowserFoldersPanelProps) {
  const currentBucketChildren = treeRootNode?.children ?? [];
  const currentBucketLoading = Boolean(currentBucket && treeRootNode?.isLoading);
  const currentBucketHasFolders = currentBucketChildren.length > 0;
  const currentBucketUnavailable = currentBucketAccess.status === "unavailable";
  const normalizedWorkspaceNoun = workspaceNoun.trim() || "bucket";

  return (
    <div className={cx(uiCardClass, "flex h-full min-h-0 min-w-0 flex-col p-3")}>
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={panelSectionTitleClasses}>Folders</p>
        </div>
        <button
          type="button"
          className={panelIconButtonClasses}
          onClick={onRefresh}
          disabled={!currentBucket}
          aria-label="Refresh folders"
          title="Refresh folders"
        >
          <RefreshIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      <section className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1" aria-label={`Current ${normalizedWorkspaceNoun}`}>
        <div className="min-w-0">
          <button
            type="button"
            className={`${treeItemBaseClasses} min-h-8 rounded-md px-2 py-1 ${
              activePrefix === "" ? treeItemActiveClasses : treeItemInactiveClasses
            }`}
            onClick={() => onSelectPrefix("")}
            disabled={!currentBucket}
          >
            <FolderIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Root</span>
          </button>

          <div className="mt-2 min-w-0">
            {!currentBucket && (
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                {`Select a ${normalizedWorkspaceNoun} to browse folders.`}
              </p>
            )}
            {currentBucket && currentBucketUnavailable && (
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                Folder tree unavailable with current credentials.
              </p>
            )}
            {currentBucketLoading && !currentBucketUnavailable && (
              <p className="ui-caption text-slate-500 dark:text-slate-400">Loading folders...</p>
            )}
            {currentBucket && !currentBucketUnavailable && !currentBucketLoading && !currentBucketHasFolders && (
              <p className="ui-caption text-slate-500 dark:text-slate-400">No folders at this level.</p>
            )}
            {!currentBucketUnavailable && currentBucketHasFolders &&
              renderTreeNodes(currentBucketChildren, activePrefix, 0, onSelectPrefix, onToggleTreeNode)}
          </div>
        </div>
      </section>
    </div>
  );
}
