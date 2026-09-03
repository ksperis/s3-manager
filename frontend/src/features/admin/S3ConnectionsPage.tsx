/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Dispatch, FormEvent, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ListPageSection from "../../components/list/ListPageSection";
import PageHeader from "../../components/PageHeader";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import Modal from "../../components/Modal";
import WorkflowPage, { WorkflowActions, workflowPageHostClass } from "../../components/WorkflowPage";
import WorkflowTabs from "../../components/WorkflowTabs";
import PageBanner from "../../components/PageBanner";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
import UiTagBadgeList from "../../components/UiTagBadgeList";
import UiTagEditor from "../../components/UiTagEditor";
import UiButton from "../../components/ui/UiButton";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import {
  cx,
  uiMutedTextClass,
  uiPanelMutedClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { useTagCatalog } from "../../hooks/useTagCatalog";
import { AssociationPrincipalStack, type AssociationPrincipalItem } from "./AssociationSummary";
import UserAvatar from "../../components/UserAvatar";
import {
  S3ConnectionAdminItem,
  createAdminS3Connection,
  deleteAdminS3Connection,
  listAdminS3Connections,
  updateAdminS3Connection,
  validateAdminS3ConnectionCredentials,
} from "../../api/s3ConnectionsAdmin";
import { listMinimalGroups, type UiGroupSummary } from "../../api/groups";
import { listMinimalUsers, type UserSummary } from "../../api/users";
import { listStorageEndpoints, StorageEndpoint } from "../../api/storageEndpoints";
import ActiveFiltersBar from "../../components/ActiveFiltersBar";
import { extractApiError } from "../../utils/apiError";
import { matchesExactTextCandidate, type TextMatchMode } from "../../utils/textMatch";
import { buildUiTagItems, extractUiTagLabels, normalizeUiTags } from "../../utils/uiTags";
import {
  AdminAssociationCheckboxOptions,
  AdminAssociationPickerPanel,
  AdminAssociationSectionHeader,
  adminAssociationTableClass as associationTableClass,
  adminAssociationTableActionCellClass,
  adminAssociationTableBodyClass,
  adminAssociationTableContainerClass as associationTableContainerClass,
  adminAssociationTableEmptyCellClass,
  adminAssociationTableHeaderClass,
  adminAssociationTableHeadClass,
  adminAssociationTableHeaderRightClass,
  adminAssociationTableLabelCellClass,
} from "./AdminAssociationPicker";
import S3ConnectionEndpointFields from "../shared/S3ConnectionEndpointFields";
import S3ConnectionCredentialFields from "../shared/S3ConnectionCredentialFields";
import S3CredentialsValidationMessage from "../shared/S3CredentialsValidationMessage";
import { useLiveS3CredentialsValidation } from "../shared/useLiveS3CredentialsValidation";
import {
  buildCreateS3ConnectionSignature,
  buildEditAdminS3ConnectionSignature,
  buildS3CredentialsValidationPayload,
  createDefaultAdminS3ConnectionForm,
  normalizeS3ConnectionLinkedIds,
  parseS3ConnectionCredentialOwnerType,
  prepareCreateAdminS3ConnectionPayload,
  prepareUpdateAdminS3ConnectionPayload,
  type EditAdminS3ConnectionForm,
  type S3ConnectionEndpointMode,
} from "../shared/s3ConnectionFormModel";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";

const credentialOwnerTypeOptions = [
  { value: "", label: "(none)" },
  { value: "iam_user", label: "IAM user" },
  { value: "account_user", label: "Account user" },
  { value: "s3_user", label: "S3 user" },
];
type EditTab = "general" | "users" | "groups";

function getConnectionSearchCandidates(connection: S3ConnectionAdminItem): Array<string | number | null | undefined> {
  return [
    connection.name,
    connection.endpoint_url,
    connection.created_by_email,
    ...(connection.user_details ?? []).flatMap((user) => [user.email, user.full_name]),
    ...(connection.group_details ?? []).map((group) => group.name),
    ...extractUiTagLabels(connection.tags),
  ];
}

const selectionCheckboxClass = "h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary";

export default function S3ConnectionsPage() {
  const [items, setItems] = useState<S3ConnectionAdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState("");
  const [quickFilterMode, setQuickFilterMode] = useState<TextMatchMode>("contains");

  const [storageEndpoints, setStorageEndpoints] = useState<StorageEndpoint[]>([]);
  const [loadingEndpoints, setLoadingEndpoints] = useState(false);
  const [portalUsers, setPortalUsers] = useState<UserSummary[]>([]);
  const [uiGroups, setUiGroups] = useState<UiGroupSummary[]>([]);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createEndpointMode, setCreateEndpointMode] = useState<S3ConnectionEndpointMode>("custom");
  const [createEndpointPresetId, setCreateEndpointPresetId] = useState("");
  const [createPresetTouched, setCreatePresetTouched] = useState(false);
  const [createForm, setCreateForm] = useState(createDefaultAdminS3ConnectionForm);
  const [createInitialSignature, setCreateInitialSignature] = useState("");

  const [editing, setEditing] = useState<S3ConnectionAdminItem | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editEndpointMode, setEditEndpointMode] = useState<S3ConnectionEndpointMode>("custom");
  const [editEndpointPresetId, setEditEndpointPresetId] = useState("");
  const [editForm, setEditForm] = useState<EditAdminS3ConnectionForm>({
    name: "",
    tags: [],
    provider_hint: "",
    credential_owner_type: "",
    credential_owner_identifier: "",
    endpoint_url: "",
    region: "",
    force_path_style: false,
    verify_tls: true,
  });
  const [editCredentials, setEditCredentials] = useState({
    access_key_id: "",
    secret_access_key: "",
  });
  const [editInitialSignature, setEditInitialSignature] = useState("");
  const [editTab, setEditTab] = useState<EditTab>("general");
  const [editLinkedUserIds, setEditLinkedUserIds] = useState<number[]>([]);
  const [editLinkedGroupIds, setEditLinkedGroupIds] = useState<number[]>([]);
  const [editUserSearch, setEditUserSearch] = useState("");
  const [editGroupSearch, setEditGroupSearch] = useState("");
  const [showEditUserPanel, setShowEditUserPanel] = useState(false);
  const [showEditGroupPanel, setShowEditGroupPanel] = useState(false);
  const [editUserSelections, setEditUserSelections] = useState<number[]>([]);
  const [editGroupSelections, setEditGroupSelections] = useState<number[]>([]);
  const maxLinkOptions = 10;

  const [deleteTarget, setDeleteTarget] = useState<S3ConnectionAdminItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkActivateBusy, setBulkActivateBusy] = useState(false);
  const [bulkDisableBusy, setBulkDisableBusy] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const [selectAllFilteredBusy, setSelectAllFilteredBusy] = useState(false);
  const [allFilteredSelectableIds, setAllFilteredSelectableIds] = useState<number[] | null>(null);
  const [allFilteredSelectableIdsKey, setAllFilteredSelectableIdsKey] = useState<string | null>(null);
  const selectionHeaderRef = useRef<HTMLInputElement | null>(null);

  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const showEditGeneralTab = editTab === "general";
  const showEditUsersTab = editTab === "users";
  const showEditGroupsTab = editTab === "groups";
  const {
    catalog: adminTagCatalog,
    loading: adminTagCatalogLoading,
    error: adminTagCatalogError,
  } = useTagCatalog(
    { kind: "admin", domain: "admin_managed" },
    Boolean(showCreateModal || editing)
  );

  const extractError = (err: unknown) => extractApiError(err, "Unexpected error");
  const resetEditUsersState = useCallback(() => {
    setEditTab("general");
    setEditLinkedUserIds([]);
    setEditLinkedGroupIds([]);
    setEditUserSearch("");
    setEditGroupSearch("");
    setShowEditUserPanel(false);
    setShowEditGroupPanel(false);
    setEditUserSelections([]);
    setEditGroupSelections([]);
  }, []);
  const closeEditModal = useCallback(() => {
    setEditing(null);
    setEditError(null);
    setEditCredentials({ access_key_id: "", secret_access_key: "" });
    setEditInitialSignature("");
    resetEditUsersState();
  }, [resetEditUsersState]);

  const resetCreateForm = () => {
    const nextForm = createDefaultAdminS3ConnectionForm();
    setCreateEndpointMode("custom");
    setCreateEndpointPresetId("");
    setCreatePresetTouched(false);
    setCreateError(null);
    setCreateForm(nextForm);
    setCreateInitialSignature(
      buildCreateS3ConnectionSignature(nextForm, "custom", ""),
    );
  };

  const openCreateModal = () => {
    const nextForm = createDefaultAdminS3ConnectionForm();
    let nextEndpointMode: S3ConnectionEndpointMode = "custom";
    let nextEndpointPresetId = "";
    if (defaultEndpoint) {
      nextEndpointMode = "preset";
      nextEndpointPresetId = String(defaultEndpoint.id);
      Object.assign(nextForm, {
        endpoint_url: defaultEndpoint.endpoint_url,
        region: defaultEndpoint.region || "",
        force_path_style: false,
        verify_tls: true,
      });
    }
    setCreateEndpointMode(nextEndpointMode);
    setCreateEndpointPresetId(nextEndpointPresetId);
    setCreatePresetTouched(false);
    setCreateError(null);
    setCreateForm(nextForm);
    setCreateInitialSignature(
      buildCreateS3ConnectionSignature(
        nextForm,
        nextEndpointMode,
        nextEndpointPresetId,
      ),
    );
    setShowCreateModal(true);
  };

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const quick = filter.trim();
      if (quick && quickFilterMode === "exact") {
        const allMatches: S3ConnectionAdminItem[] = [];
        let nextPage = 1;
        while (true) {
          const response = await listAdminS3Connections({
            page: nextPage,
            page_size: 200,
            search: quick,
          });
          allMatches.push(...response.items);
          if (!response.has_next) break;
          nextPage += 1;
        }

        const exactMatches = allMatches.filter((connection) =>
          matchesExactTextCandidate(getConnectionSearchCandidates(connection), quick)
        );
        const totalExact = exactMatches.length;
        const totalPages = Math.max(1, Math.ceil(totalExact / pageSize));
        if (totalExact > 0 && page > totalPages) {
          setPage(totalPages);
          return;
        }
        const start = (page - 1) * pageSize;
        setItems(exactMatches.slice(start, start + pageSize));
        setTotal(totalExact);
      } else {
        const response = await listAdminS3Connections({
          page,
          page_size: pageSize,
          search: quick || undefined,
        });
        const totalPages = Math.max(1, Math.ceil((response.total || 0) / pageSize));
        if (response.total > 0 && page > totalPages) {
          setPage(totalPages);
          return;
        }
        setItems(response.items);
        setTotal(response.total);
      }
      setAllFilteredSelectableIds(null);
      setAllFilteredSelectableIdsKey(null);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }, [filter, page, pageSize, quickFilterMode]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    const loadEndpoints = async () => {
      setLoadingEndpoints(true);
      try {
        const data = await listStorageEndpoints();
        setStorageEndpoints(data);
      } catch {
        setStorageEndpoints([]);
      } finally {
        setLoadingEndpoints(false);
      }
    };
    loadEndpoints();
  }, []);

  useEffect(() => {
    const loadPortalUsers = async () => {
      try {
        const data = await listMinimalUsers();
        setPortalUsers(data);
      } catch {
        setPortalUsers([]);
      }
    };
    loadPortalUsers();
  }, []);

  useEffect(() => {
    const loadGroups = async () => {
      try {
        const data = await listMinimalGroups();
        setUiGroups(data);
      } catch {
        setUiGroups([]);
      }
    };
    loadGroups();
  }, []);

  const createValidationPayload = useMemo(
    () =>
      buildS3CredentialsValidationPayload(
        createForm,
        createEndpointMode,
        createEndpointPresetId,
      ),
    [createEndpointMode, createEndpointPresetId, createForm],
  );

  const createCredentialsValidation = useLiveS3CredentialsValidation({
    enabled: showCreateModal,
    payload: createValidationPayload,
    validate: validateAdminS3ConnectionCredentials,
  });

  const defaultEndpoint = storageEndpoints.find((ep) => ep.is_default);
  const endpointNameById = useMemo(() => {
    const map = new Map<number, string>();
    storageEndpoints.forEach((ep) => map.set(ep.id, ep.name));
    return map;
  }, [storageEndpoints]);
  const portalUserLabelById = useMemo(() => {
    const map = new Map<number, string>();
    portalUsers.forEach((user) => map.set(user.id, user.email));
    return map;
  }, [portalUsers]);
  const groupLabelById = useMemo(() => {
    const map = new Map<number, string>();
    uiGroups.forEach((group) => map.set(group.id, group.name));
    return map;
  }, [uiGroups]);
  const renderConnectionAssociations = (connection: S3ConnectionAdminItem) => {
    const userItems: AssociationPrincipalItem[] = (connection.user_details ?? []).map((user) => {
      return {
        id: user.id,
        kind: "user",
        label: user.full_name || user.email || `User #${user.id}`,
        email: user.email,
        avatar: user.avatar,
      };
    });
    const groupItems: AssociationPrincipalItem[] = (connection.group_details ?? []).map((group) => ({
      id: group.id,
      kind: "group" as const,
      label: group.name,
      avatar: group.avatar,
    }));
    return <AssociationPrincipalStack items={[...userItems, ...groupItems]} />;
  };
  const linkedEditUsers = useMemo(
    () =>
      editLinkedUserIds.map((id) => ({
        id,
        label: portalUserLabelById.get(id) ?? `User #${id}`,
      })),
    [editLinkedUserIds, portalUserLabelById]
  );
  const linkedEditGroups = useMemo(
    () =>
      editLinkedGroupIds.map((id) => ({
        id,
        label: groupLabelById.get(id) ?? `Group #${id}`,
      })),
    [editLinkedGroupIds, groupLabelById]
  );
  const availableEditUsers = useMemo(() => {
    const query = editUserSearch.trim().toLowerCase();
    const selectedIds = new Set(editLinkedUserIds);
    return portalUsers
      .filter((user) => !selectedIds.has(user.id))
      .filter((user) => !query || user.email.toLowerCase().includes(query))
      .map((user) => ({ id: user.id, label: user.email }));
  }, [editLinkedUserIds, editUserSearch, portalUsers]);
  const availableEditGroups = useMemo(() => {
    const query = editGroupSearch.trim().toLowerCase();
    const selectedIds = new Set(editLinkedGroupIds);
    return uiGroups
      .filter((group) => !selectedIds.has(group.id))
      .filter((group) => !query || group.name.toLowerCase().includes(query));
  }, [editGroupSearch, editLinkedGroupIds, uiGroups]);
  const visibleAvailableEditUsers = useMemo(() => availableEditUsers.slice(0, maxLinkOptions), [availableEditUsers, maxLinkOptions]);
  const visibleAvailableEditGroups = useMemo(() => availableEditGroups.slice(0, maxLinkOptions), [availableEditGroups, maxLinkOptions]);
  const createCurrentSignature = useMemo(
    () =>
      buildCreateS3ConnectionSignature(
        createForm,
        createEndpointMode,
        createEndpointPresetId,
      ),
    [createEndpointMode, createEndpointPresetId, createForm]
  );
  const createCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: Boolean(createInitialSignature) && createCurrentSignature !== createInitialSignature,
    disabled: creating,
    onClose: () => setShowCreateModal(false),
  });
  const editCurrentSignature = useMemo(
    () =>
      buildEditAdminS3ConnectionSignature({
        credentialDraft: editCredentials,
        endpointId: editEndpointPresetId,
        endpointMode: editEndpointMode,
        form: editForm,
        linkedGroupIds: editLinkedGroupIds,
        linkedUserIds: editLinkedUserIds,
      }),
    [editCredentials, editEndpointMode, editEndpointPresetId, editForm, editLinkedGroupIds, editLinkedUserIds]
  );
  const editCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: Boolean(editing && editInitialSignature && editCurrentSignature !== editInitialSignature),
    disabled: editBusy,
    onClose: closeEditModal,
  });
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: items.length,
  });
  const quickFilterActive = filter.trim().length > 0;
  const selectionQueryKey = useMemo(
    () =>
      JSON.stringify({
        filter: filter.trim() || null,
        matchMode: quickFilterMode,
      }),
    [filter, quickFilterMode]
  );
  const selectableOnPageIds = useMemo(
    () => items.map((item) => item.id),
    [items]
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedOnPageIds = useMemo(
    () => selectableOnPageIds.filter((connectionId) => selectedIdSet.has(connectionId)),
    [selectableOnPageIds, selectedIdSet]
  );
  const allSelectedOnPage = selectableOnPageIds.length > 0 && selectedOnPageIds.length === selectableOnPageIds.length;
  const hasResolvedFilteredSelectableIds =
    allFilteredSelectableIdsKey === selectionQueryKey && Array.isArray(allFilteredSelectableIds);
  const selectedOnFilteredCount = hasResolvedFilteredSelectableIds
    ? allFilteredSelectableIds.reduce((count, connectionId) => count + (selectedIdSet.has(connectionId) ? 1 : 0), 0)
    : selectedOnPageIds.length;
  const allSelectedOnFiltered =
    hasResolvedFilteredSelectableIds && allFilteredSelectableIds.length > 0 && selectedOnFilteredCount === allFilteredSelectableIds.length;
  const hiddenSelectedCount = Math.max(selectedIds.length - selectedOnPageIds.length, 0);
  const headerChecked = hasResolvedFilteredSelectableIds ? allSelectedOnFiltered : allSelectedOnPage;
  const headerIndeterminate = hasResolvedFilteredSelectableIds
    ? selectedOnFilteredCount > 0 && !allSelectedOnFiltered
    : selectedOnPageIds.length > 0 && !allSelectedOnPage;

  useEffect(() => {
    if (!selectionHeaderRef.current) return;
    selectionHeaderRef.current.indeterminate = headerIndeterminate;
  }, [headerIndeterminate]);

  useEffect(() => {
    setAllFilteredSelectableIds(null);
    setAllFilteredSelectableIdsKey(null);
  }, [selectionQueryKey]);

  useEffect(() => {
    setSelectedIds([]);
  }, [page, pageSize]);

  useEffect(() => {
    if (!showCreateModal) return;
    if (createPresetTouched || createEndpointPresetId) return;
    if (!defaultEndpoint) return;
    if (createForm.endpoint_url.trim()) return;
    const defaultId = String(defaultEndpoint.id);
    setCreateEndpointMode("preset");
    setCreateEndpointPresetId(defaultId);
    setCreateForm((prev) => ({
      ...prev,
      endpoint_url: defaultEndpoint.endpoint_url,
      region: defaultEndpoint.region || "",
      force_path_style: false,
      verify_tls: true,
    }));
  }, [createEndpointPresetId, createForm.endpoint_url, createPresetTouched, defaultEndpoint, showCreateModal]);

  const handleFilterChange = (value: string) => {
    setFilter(value);
    setSelectedIds([]);
    setPage(1);
  };
  const toggleQuickFilterMode = () => {
    setQuickFilterMode((prev) => (prev === "contains" ? "exact" : "contains"));
    setSelectedIds([]);
    setPage(1);
  };
  const clearAllFilters = () => {
    setFilter("");
    setQuickFilterMode("contains");
    setSelectedIds([]);
    setPage(1);
  };
  const handlePageChange = (nextPage: number) => {
    if (nextPage === page) return;
    setPage(Math.max(1, nextPage));
  };
  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };
  const toggleRowSelection = (connectionId: number) => {
    setSelectedIds((prev) => (prev.includes(connectionId) ? prev.filter((id) => id !== connectionId) : [...prev, connectionId]));
  };
  const toggleEditUserSelection = (userId: number) => {
    setEditUserSelections((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  };
  const toggleEditGroupSelection = (groupId: number) => {
    setEditGroupSelections((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };
  const loadAllSelectableFilteredIds = useCallback(async () => {
    if (allFilteredSelectableIdsKey === selectionQueryKey && allFilteredSelectableIds) {
      return allFilteredSelectableIds;
    }
    const ids = new Set<number>();
    let nextPage = 1;
    while (true) {
      const response = await listAdminS3Connections({
        page: nextPage,
        page_size: 200,
        search: filter.trim() || undefined,
      });
      response.items.forEach((item) => {
        if (!filter.trim() || quickFilterMode === "contains" || matchesExactTextCandidate(getConnectionSearchCandidates(item), filter)) {
          ids.add(item.id);
        }
      });
      if (!response.has_next) {
        break;
      }
      nextPage += 1;
    }
    const resolved = Array.from(ids.values());
    setAllFilteredSelectableIds(resolved);
    setAllFilteredSelectableIdsKey(selectionQueryKey);
    return resolved;
  }, [allFilteredSelectableIds, allFilteredSelectableIdsKey, filter, quickFilterMode, selectionQueryKey]);

  const setSelectionForFilteredResults = useCallback(
    async (checked: boolean) => {
      setSelectAllFilteredBusy(true);
      setError(null);
      try {
        const selectableFilteredIds = await loadAllSelectableFilteredIds();
        setSelectedIds(checked ? selectableFilteredIds : []);
      } catch (err) {
        setError(extractApiError(err, "Unexpected error"));
      } finally {
        setSelectAllFilteredBusy(false);
      }
    },
    [loadAllSelectableFilteredIds]
  );

  const openEdit = (conn: S3ConnectionAdminItem) => {
    const presetMatch =
      conn.storage_endpoint_id != null
        ? storageEndpoints.find((ep) => ep.id === conn.storage_endpoint_id)
        : storageEndpoints.find((ep) => ep.endpoint_url === conn.endpoint_url);
    const nextEndpointMode: S3ConnectionEndpointMode =
      conn.storage_endpoint_id != null ? "preset" : presetMatch ? "preset" : "custom";
    const nextEndpointPresetId =
      conn.storage_endpoint_id != null ? String(conn.storage_endpoint_id) : presetMatch ? String(presetMatch.id) : "";
    const nextForm: EditAdminS3ConnectionForm = {
      name: conn.name,
      tags: normalizeUiTags(conn.tags),
      provider_hint: conn.provider_hint || "",
      credential_owner_type: conn.credential_owner_type || "",
      credential_owner_identifier: conn.credential_owner_identifier || "",
      endpoint_url: conn.endpoint_url,
      region: conn.region || "",
      force_path_style: Boolean(conn.force_path_style),
      verify_tls: conn.verify_tls !== false,
    };
    const nextLinkedUserIds = normalizeS3ConnectionLinkedIds(conn.user_details?.map((user) => user.id));
    const nextLinkedGroupIds = normalizeS3ConnectionLinkedIds(conn.group_details?.map((group) => group.id));
    setEditing(conn);
    setEditEndpointMode(nextEndpointMode);
    setEditEndpointPresetId(nextEndpointPresetId);
    setEditForm(nextForm);
    setEditTab("general");
    setEditLinkedUserIds(nextLinkedUserIds);
    setEditLinkedGroupIds(nextLinkedGroupIds);
    setEditUserSearch("");
    setEditGroupSearch("");
    setShowEditUserPanel(false);
    setShowEditGroupPanel(false);
    setEditUserSelections([]);
    setEditGroupSelections([]);
    const nextCredentialDraft = { access_key_id: "", secret_access_key: "" };
    setEditCredentials(nextCredentialDraft);
    setEditInitialSignature(
      buildEditAdminS3ConnectionSignature({
        credentialDraft: nextCredentialDraft,
        endpointId: nextEndpointPresetId,
        endpointMode: nextEndpointMode,
        form: nextForm,
        linkedGroupIds: nextLinkedGroupIds,
        linkedUserIds: nextLinkedUserIds,
      }),
    );
    setEditError(null);
  };

  type ConnectionEndpointForm = {
    endpoint_url: string;
    region: string;
  };

  const applyEndpointPreset = <T extends ConnectionEndpointForm>(
    endpointId: string,
    setForm: Dispatch<SetStateAction<T>>
  ) => {
    const endpoint = storageEndpoints.find((ep) => String(ep.id) === endpointId);
    if (!endpoint) return;
    setForm((prev) => ({
      ...prev,
      endpoint_url: endpoint.endpoint_url,
      region: endpoint.region || "",
    }));
  };

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    const prepared = prepareCreateAdminS3ConnectionPayload(
      createForm,
      createEndpointMode,
      createEndpointPresetId,
    );
    if (prepared.error !== null) {
      setCreateError(prepared.error);
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await createAdminS3Connection(prepared.payload);
      setShowCreateModal(false);
      resetCreateForm();
      setActionMessage("Connection created.");
      await fetchItems();
    } catch (err) {
      setCreateError(extractError(err));
    } finally {
      setCreating(false);
    }
  };

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const prepared = prepareUpdateAdminS3ConnectionPayload({
      credentialDraft: editCredentials,
      endpointId: editEndpointPresetId,
      endpointMode: editEndpointMode,
      form: editForm,
      linkedGroupIds: editLinkedGroupIds,
      linkedUserIds: editLinkedUserIds,
    });
    if (prepared.error !== null) {
      setEditError(prepared.error);
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      await updateAdminS3Connection(editing.id, prepared.payload);
      setEditCredentials({ access_key_id: "", secret_access_key: "" });
      setActionMessage("Connection updated.");
      await fetchItems();
      closeEditModal();
    } catch (err) {
      setEditError(extractError(err));
    } finally {
      setEditBusy(false);
    }
  };

  const submitDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteAdminS3Connection(deleteTarget.id);
      setDeleteTarget(null);
      setSelectedIds((prev) => prev.filter((connectionId) => connectionId !== deleteTarget.id));
      setActionMessage("Connection deleted.");
      await fetchItems();
    } catch (err) {
      setDeleteError(extractError(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  const submitToggleConnectionStatus = async (conn: S3ConnectionAdminItem) => {
    if (conn.execution_status === "remediation_required") {
      setStatusBusyId(conn.id);
      setError(null);
      try {
        await updateAdminS3Connection(conn.id, {
          remediation_action: "activate_manager",
        });
        setActionMessage("Connection remediated and activated for Manager.");
        await fetchItems();
      } catch (err) {
        setError(extractError(err));
      } finally {
        setStatusBusyId(null);
      }
      return;
    }
    const nextIsActive = conn.is_active !== false ? false : true;
    setStatusBusyId(conn.id);
    setError(null);
    setActionMessage(null);
    try {
      await updateAdminS3Connection(conn.id, { is_active: nextIsActive });
      setActionMessage(nextIsActive ? "Connection activated." : "Connection disabled.");
      await fetchItems();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setStatusBusyId(null);
    }
  };

  const submitBulkDisable = async () => {
    if (selectedIds.length === 0) return;
    setBulkDisableBusy(true);
    setError(null);
    setActionMessage(null);
    const results = await Promise.allSettled(
      selectedIds.map((connectionId) => updateAdminS3Connection(connectionId, { is_active: false }))
    );
    const failedIds = selectedIds.filter((_, index) => results[index].status === "rejected");
    const successCount = selectedIds.length - failedIds.length;
    setSelectedIds(failedIds);
    if (successCount > 0) {
      await fetchItems();
    }
    if (failedIds.length > 0) {
      setError(`${failedIds.length} connection${failedIds.length > 1 ? "s" : ""} could not be disabled.`);
    }
    setActionMessage(
      `${successCount} connection${successCount > 1 ? "s" : ""} disabled.` +
        (failedIds.length > 0 ? ` ${failedIds.length} failed.` : "")
    );
    setBulkDisableBusy(false);
  };

  const submitBulkActivate = async () => {
    if (selectedIds.length === 0) return;
    setBulkActivateBusy(true);
    setError(null);
    setActionMessage(null);
    const results = await Promise.allSettled(
      selectedIds.map((connectionId) => {
        const connection = items.find((item) => item.id === connectionId);
        return connection?.execution_status === "remediation_required"
          ? updateAdminS3Connection(connectionId, {
              remediation_action: "activate_manager",
            })
          : updateAdminS3Connection(connectionId, { is_active: true });
      })
    );
    const failedIds = selectedIds.filter((_, index) => results[index].status === "rejected");
    const successCount = selectedIds.length - failedIds.length;
    setSelectedIds(failedIds);
    if (successCount > 0) {
      await fetchItems();
    }
    if (failedIds.length > 0) {
      setError(`${failedIds.length} connection${failedIds.length > 1 ? "s" : ""} could not be activated.`);
    }
    setActionMessage(
      `${successCount} connection${successCount > 1 ? "s" : ""} activated.` +
        (failedIds.length > 0 ? ` ${failedIds.length} failed.` : "")
    );
    setBulkActivateBusy(false);
  };

  const submitBulkDelete = async () => {
    if (selectedIds.length === 0) {
      setBulkDeleteOpen(false);
      return;
    }
    setBulkDeleteBusy(true);
    setError(null);
    setActionMessage(null);
    const results = await Promise.allSettled(
      selectedIds.map((connectionId) => deleteAdminS3Connection(connectionId))
    );
    const failedIds = selectedIds.filter((_, index) => results[index].status === "rejected");
    const successCount = selectedIds.length - failedIds.length;
    setSelectedIds(failedIds);
    setBulkDeleteOpen(false);
    if (successCount > 0) {
      await fetchItems();
    }
    if (failedIds.length > 0) {
      setError(`${failedIds.length} connection${failedIds.length > 1 ? "s" : ""} could not be deleted.`);
    }
    setActionMessage(
      `${successCount} connection${successCount > 1 ? "s" : ""} deleted.` +
        (failedIds.length > 0 ? ` ${failedIds.length} failed.` : "")
    );
    setBulkDeleteBusy(false);
  };

  const connectionTableColumns: Array<DataTableColumn<S3ConnectionAdminItem>> = [
    {
      id: "select",
      label: "Select",
      headerClassName: "w-10 px-3",
      cellClassName: "w-10 px-3 py-4",
      header: (
        <input
          ref={selectionHeaderRef}
          type="checkbox"
          aria-label="Select all filtered connections"
          checked={headerChecked}
          onChange={(e) => {
            void setSelectionForFilteredResults(e.target.checked);
          }}
          disabled={loading || selectAllFilteredBusy || total === 0 || bulkActivateBusy || bulkDisableBusy || bulkDeleteBusy}
          className={selectionCheckboxClass}
        />
      ),
      render: (connection) => (
        <input
          type="checkbox"
          aria-label={`Select connection ${connection.name}`}
          checked={selectedIdSet.has(connection.id)}
          onChange={() => toggleRowSelection(connection.id)}
          disabled={bulkActivateBusy || bulkDisableBusy || bulkDeleteBusy || selectAllFilteredBusy}
          className={selectionCheckboxClass}
        />
      ),
    },
    {
      id: "name",
      label: "Name",
      primary: true,
      cellClassName: "min-w-[240px]",
      render: (connection) => {
        const tagItems = buildUiTagItems(connection.tags);
        return (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="min-w-0 flex-1 truncate">{connection.name}</p>
            {tagItems.length > 0 && (
              <UiTagBadgeList
                items={tagItems}
                variant="listing-compact"
                layout="inline-compact"
                className="ml-auto max-w-full"
                maxVisible={4}
              />
            )}
          </div>
        );
      },
    },
    {
      id: "endpoint",
      label: "Endpoint",
      cellClassName: "min-w-[220px]",
      render: (connection) =>
        connection.storage_endpoint_id != null ? (
          <span>{endpointNameById.get(connection.storage_endpoint_id) || `Endpoint #${connection.storage_endpoint_id}`}</span>
        ) : (
          <span className="ui-mono">{connection.endpoint_url || "-"}</span>
        ),
    },
    {
      id: "status",
      label: "Status",
      render: (connection) => {
        const remediationRequired = connection.execution_status === "remediation_required";
        const isActive = connection.is_active !== false && !remediationRequired;
        return (
          <span
            className={`rounded-full px-2 py-1 ui-caption font-semibold ${
              remediationRequired
                ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                : isActive
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
            }`}
          >
            {remediationRequired ? "Remediation required" : isActive ? "Active" : "Inactive"}
          </span>
        );
      },
    },
    {
      id: "created-by",
      label: "Created by",
      render: (connection) => (
        <UserAvatar
          avatar={connection.created_by_avatar}
          name={connection.created_by_full_name || connection.created_by_email || `User #${connection.created_by_user_id}`}
          email={connection.created_by_email}
          size="sm"
          title={[connection.created_by_full_name, connection.created_by_email].filter(Boolean).join(" · ") || `User #${connection.created_by_user_id}`}
        />
      ),
    },
    {
      id: "associations",
      label: "UI Users / Groups",
      cellClassName: "min-w-[180px] max-w-[240px] align-middle",
      render: renderConnectionAssociations,
    },
    {
      id: "actions",
      label: "Actions",
      align: "right",
      mobileRole: "actions",
      cellClassName: "min-w-[260px]",
      render: (connection) => {
        const remediationRequired = connection.execution_status === "remediation_required";
        const isActive = connection.is_active !== false;
        return (
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className={tableActionButtonClasses}
              onClick={() => void submitToggleConnectionStatus(connection)}
              disabled={
                statusBusyId === connection.id ||
                bulkActivateBusy ||
                bulkDisableBusy ||
                bulkDeleteBusy ||
                selectAllFilteredBusy
              }
            >
              {statusBusyId === connection.id
                ? "Saving..."
                : remediationRequired
                  ? "Activate in Manager"
                  : isActive
                    ? "Deactivate"
                    : "Activate"}
            </button>
            <button
              type="button"
              className={tableActionButtonClasses}
              onClick={() => openEdit(connection)}
              {...dataTableDefaultActionProps}
            >
              Edit
            </button>
            <button
              type="button"
              className={tableDeleteActionClasses}
              onClick={() => setDeleteTarget(connection)}
            >
              Delete
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div className={workflowPageHostClass(showCreateModal || Boolean(editing))}>
      <PageHeader
        title="Shared S3 Connections"
        description="Admin-managed S3 connections shared with linked UI users."
        breadcrumbs={adminPageBreadcrumbs("shared-connections")}
        actions={[{ label: "Add connection", onClick: openCreateModal }]}
      />

      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {error && <PageBanner tone="error">{error}</PageBanner>}

      <ListPageSection
          title="Shared S3 Connections"
          description="Search matches all records."
          countLabel={`${total} entr${total === 1 ? "y" : "ies"}`}
          search={
            <ToolbarSearchInput
              value={filter}
              onChange={handleFilterChange}
              placeholder="Search name, endpoint, created by, group, or tag..."
              className="w-full sm:w-64"
              active={quickFilterActive}
              matchMode={quickFilterMode}
              onToggleMatchMode={toggleQuickFilterMode}
            />
          }
          secondaryContent={
            quickFilterActive ? (
              <ActiveFiltersBar
                label="Active filters summary"
                items={[
                  {
                    id: "search",
                    label: `Search ${quickFilterMode === "exact" ? "exact" : "contains"}: ${filter.trim()}`,
                  },
                ]}
                onClearAll={clearAllFilters}
              />
            ) : null
          }
      >
        {selectedIds.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/50">
            <span className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
              {selectedIds.length} selected
              {hiddenSelectedCount > 0 ? ` (${hiddenSelectedCount} not visible)` : ""}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={tableActionButtonClasses}
                onClick={() => void submitBulkActivate()}
                disabled={bulkActivateBusy || bulkDisableBusy || bulkDeleteBusy || selectAllFilteredBusy}
              >
                {bulkActivateBusy ? "Activating..." : "Activate selected"}
              </button>
              <button
                type="button"
                className={tableActionButtonClasses}
                onClick={() => void submitBulkDisable()}
                disabled={bulkActivateBusy || bulkDisableBusy || bulkDeleteBusy || selectAllFilteredBusy}
              >
                {bulkDisableBusy ? "Disabling..." : "Disable selected"}
              </button>
              <button
                type="button"
                className={tableDeleteActionClasses}
                onClick={() => setBulkDeleteOpen(true)}
                disabled={bulkActivateBusy || bulkDisableBusy || bulkDeleteBusy || selectAllFilteredBusy}
              >
                Delete selected
              </button>
            </div>
          </div>
        )}
        <DataTableShell
          columns={connectionTableColumns}
          rows={items}
          rowKey={(connection) => connection.id}
          status={tableStatus}
          loadingMessage="Loading connections..."
          errorMessage="Unable to load connections."
          emptyMessage="No connections."
          primaryColumnId="name"
          responsiveCards
          tableClassName="compact-table"
          pagination={{
            page,
            pageSize,
            total,
            onPageChange: handlePageChange,
            onPageSizeChange: handlePageSizeChange,
            disabled: loading,
          }}
        />
      </ListPageSection>

      {/* Create modal */}
      {showCreateModal && (
        <WorkflowPage
          title="Add S3 connection"
          description="Configure endpoint access, credentials, and workspace availability for this shared connection."
          breadcrumbs={adminPageBreadcrumbs("shared-connections", { label: "Create" })}
          backLabel="Back to connections"
          onBack={createCloseGuard.requestClose}
          width="wide"
        >
          {createError && (
            <UiInlineMessage tone="error" className="mb-3">
              {createError}
            </UiInlineMessage>
          )}
          <form className="space-y-4" onSubmit={submitCreate}>
              <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <UiInput
                label="Name *"
                value={createForm.name}
                onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))}
                required
              />
              <div className="space-y-3">
                {adminTagCatalogError && <PageBanner tone="warning">{adminTagCatalogError}</PageBanner>}
                <UiTagEditor
                  label="Tags"
                  tags={createForm.tags}
                  catalog={adminTagCatalog}
                  onChange={(tags) => setCreateForm((current) => ({ ...current, tags }))}
                  placeholder="Add a tag for this shared connection"
                  hint={adminTagCatalogLoading ? "Loading existing tag catalog..." : undefined}
                  compact
                />
              </div>
              <div className="sm:col-span-2">
                <S3ConnectionEndpointFields
                  mode={createEndpointMode}
                  onModeChange={(mode) => {
                    setCreatePresetTouched(true);
                    setCreateEndpointMode(mode);
                  }}
                  modeInputName="create-admin-s3-connection-endpoint-mode"
                  endpointId={createEndpointPresetId}
                  onEndpointIdChange={(endpointId) => {
                    setCreateEndpointPresetId(endpointId);
                    setCreatePresetTouched(true);
                    if (endpointId) {
                      applyEndpointPreset(endpointId, setCreateForm);
                    }
                  }}
                  endpoints={storageEndpoints}
                  loadingEndpoints={loadingEndpoints}
                  form={createForm}
                  onFormChange={(field, value) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      [field]: value,
                    }))
                  }
                />
              </div>
              <div className={cx("px-3 py-2 sm:col-span-2", uiPanelMutedClass)}>
                <div className="ui-body text-[var(--ui-text)]">
                  Visibility: <span className="font-semibold">Shared</span>
                </div>
                <p className={cx("ui-caption", uiMutedTextClass)}>
                  Admin connections are always shared with linked UI users.
                </p>
              </div>
              <div className={cx("px-3 py-2 sm:col-span-2", uiPanelMutedClass)}>
                <div className="ui-body font-semibold text-[var(--ui-text)]">Manager-only execution</div>
                <p className={cx("ui-caption", uiMutedTextClass)}>
                  Shared connections are never exposed to Browser. Browser users must create a private connection.
                </p>
              </div>
            </div>
            <S3ConnectionCredentialFields
              accessKeyId={createForm.access_key_id}
              secretAccessKey={createForm.secret_access_key}
              onAccessKeyIdChange={(value) => setCreateForm((p) => ({ ...p, access_key_id: value }))}
              onSecretAccessKeyChange={(value) => setCreateForm((p) => ({ ...p, secret_access_key: value }))}
              required
            />
            <S3CredentialsValidationMessage validation={createCredentialsValidation} />
              </>
            <div className="flex items-center justify-end gap-3">
              <UiButton variant="secondary" onClick={createCloseGuard.requestClose} disabled={creating}>
                Cancel
              </UiButton>
              <UiButton type="submit" disabled={creating}>
                {creating ? "Creating..." : "Create"}
              </UiButton>
            </div>
          </form>
          {createCloseGuard.confirmationDialog}
        </WorkflowPage>
      )}

      {/* Edit modal */}
      {editing && (
        <WorkflowPage
          title={`Edit connection · ${editing.name}`}
          description="Manage endpoint access, credentials, workspace availability, and UI associations for this shared connection."
          breadcrumbs={adminPageBreadcrumbs("shared-connections", { label: "Edit" })}
          backLabel="Back to connections"
          onBack={editCloseGuard.requestClose}
          contentVariant="plain"
          width="wide"
        >
          {editError && (
            <UiInlineMessage tone="error" className="mb-3">
              {editError}
            </UiInlineMessage>
          )}
          <form className="space-y-4" onSubmit={submitEdit}>
            <WorkflowTabs<EditTab>
              activeTab={editTab}
              onTabChange={setEditTab}
              ariaLabel="Shared connection configuration sections"
              idPrefix="admin-shared-connection-edit"
              tabs={[
                { id: "general", label: "General" },
                { id: "users", label: "Linked UI users" },
                { id: "groups", label: "Linked UI groups" },
              ]}
            >

            {showEditGeneralTab && (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <UiInput
                    label="Name *"
                    value={editForm.name}
                    onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                    required
                  />
                  <div className="space-y-3">
                    {adminTagCatalogError && <PageBanner tone="warning">{adminTagCatalogError}</PageBanner>}
                    <UiTagEditor
                      label="Tags"
                      tags={editForm.tags}
                      catalog={adminTagCatalog}
                      onChange={(tags) => setEditForm((current) => ({ ...current, tags }))}
                      placeholder="Add a tag for this shared connection"
                      hint={adminTagCatalogLoading ? "Loading existing tag catalog..." : undefined}
                      compact
                    />
                  </div>
                </div>

                <S3ConnectionEndpointFields
                  mode={editEndpointMode}
                  onModeChange={setEditEndpointMode}
                  modeInputName={`edit-admin-s3-connection-endpoint-mode-${editing.id}`}
                  endpointId={editEndpointPresetId}
                  onEndpointIdChange={(endpointId) => {
                    setEditEndpointPresetId(endpointId);
                    if (endpointId) {
                      applyEndpointPreset(endpointId, setEditForm);
                    }
                  }}
                  endpoints={storageEndpoints}
                  loadingEndpoints={loadingEndpoints}
                  form={editForm}
                  onFormChange={(field, value) =>
                    setEditForm((prev) => ({
                      ...prev,
                      [field]: value,
                    }))
                  }
                />

                <div className={cx("px-3 py-2", uiPanelMutedClass)}>
                  <div className="ui-body text-[var(--ui-text)]">
                    Visibility: <span className="font-semibold">Shared</span>
                  </div>
                  <div className={cx("ui-caption", uiMutedTextClass)}>
                    {`Created by: ${editing.created_by_email || editing.created_by_user_id}`}
                  </div>
                </div>

                <div className={cx("space-y-3 px-3 py-3", uiPanelMutedClass)}>
                  <div>
                    <div className={cx("ui-body", uiTitleTextClass)}>Credentials</div>
                    <div className={cx("ui-caption", uiMutedTextClass)}>Leave blank to keep the current keys.</div>
                  </div>
                  <S3ConnectionCredentialFields
                    accessKeyId={editCredentials.access_key_id}
                    secretAccessKey={editCredentials.secret_access_key}
                    onAccessKeyIdChange={(value) => setEditCredentials((p) => ({ ...p, access_key_id: value }))}
                    onSecretAccessKeyChange={(value) => setEditCredentials((p) => ({ ...p, secret_access_key: value }))}
                  />
                </div>

                <div className={cx("space-y-3 px-3 py-3", uiPanelMutedClass)}>
                  <div>
                    <div className={cx("ui-body", uiTitleTextClass)}>Access and credential metadata</div>
                    <div className={cx("ui-caption", uiMutedTextClass)}>
                      Store owner context for keys imported from manager/ceph-admin flows.
                    </div>
                  </div>
                  <div className={cx("rounded-md px-3 py-2", uiPanelMutedClass)}>
                    <div className="ui-body font-semibold text-[var(--ui-text)]">Manager-only execution</div>
                    <div className={cx("ui-caption", uiMutedTextClass)}>
                      Browser access is disabled for all shared connections.
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <UiSelect
                      label="Owner type"
                      value={editForm.credential_owner_type}
                      onChange={(e) =>
                        setEditForm((previous) => ({
                          ...previous,
                          credential_owner_type:
                            parseS3ConnectionCredentialOwnerType(e.target.value),
                        }))
                      }
                    >
                      {credentialOwnerTypeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </UiSelect>
                    <UiInput
                      label="Owner identifier"
                      value={editForm.credential_owner_identifier}
                      onChange={(e) => setEditForm((p) => ({ ...p, credential_owner_identifier: e.target.value }))}
                      placeholder="account-id / user-id"
                    />
                  </div>
                </div>
              </>
            )}

            {showEditUsersTab && (
              <div className={cx("space-y-3 px-3 py-3", uiPanelMutedClass)}>
                <AdminAssociationSectionHeader
                  title="Linked UI users"
                  countLabel={`${linkedEditUsers.length} linked`}
                  actionLabel={showEditUserPanel ? "Close" : "Add UI users"}
                  onAction={() => setShowEditUserPanel((prev) => !prev)}
                />
                <div className={associationTableContainerClass}>
                  <table className={associationTableClass}>
                    <thead className={adminAssociationTableHeadClass}>
                      <tr>
                        <th className={adminAssociationTableHeaderClass}>
                          User
                        </th>
                        <th className={adminAssociationTableHeaderRightClass}>
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className={adminAssociationTableBodyClass}>
                      {linkedEditUsers.length === 0 ? (
                        <tr>
                          <td colSpan={2} className={adminAssociationTableEmptyCellClass}>
                            No linked users yet.
                          </td>
                        </tr>
                      ) : (
                        linkedEditUsers.map((user) => (
                          <tr key={user.id}>
                            <td className={adminAssociationTableLabelCellClass}>{user.label}</td>
                            <td className={adminAssociationTableActionCellClass}>
                              <button
                                type="button"
                                onClick={() => setEditLinkedUserIds((prev) => prev.filter((id) => id !== user.id))}
                                className={tableDeleteActionClasses}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {showEditUserPanel && (
                  <AdminAssociationPickerPanel
                    title="Add UI users"
                    hint="(filter by email)"
                    search={editUserSearch}
                    onSearchChange={setEditUserSearch}
                    searchAriaLabel="Search UI users"
                    loading={false}
                    availableCount={availableEditUsers.length}
                    maxVisibleOptions={maxLinkOptions}
                    selectedCount={editUserSelections.length}
                    loadingLabel="Loading UI users..."
                    onCancel={() => {
                      setShowEditUserPanel(false);
                      setEditUserSelections([]);
                      setEditUserSearch("");
                    }}
                    onAdd={() => {
                      if (editUserSelections.length === 0) return;
                      setEditLinkedUserIds((prev) =>
                        normalizeS3ConnectionLinkedIds([...prev, ...editUserSelections]),
                      );
                      setEditUserSelections([]);
                      setEditUserSearch("");
                      setShowEditUserPanel(false);
                    }}
                    addDisabled={editUserSelections.length === 0}
                  >
                    <AdminAssociationCheckboxOptions
                      options={visibleAvailableEditUsers}
                      selectedIds={editUserSelections}
                      onToggle={toggleEditUserSelection}
                      getLabel={(option) => option.label}
                    />
                  </AdminAssociationPickerPanel>
                )}
              </div>
            )}

            {showEditGroupsTab && (
              <div className={cx("space-y-3 px-3 py-3", uiPanelMutedClass)}>
                <AdminAssociationSectionHeader
                  title="Linked UI groups"
                  countLabel={`${linkedEditGroups.length} linked`}
                  actionLabel={showEditGroupPanel ? "Close" : "Add UI groups"}
                  onAction={() => setShowEditGroupPanel((prev) => !prev)}
                />
                <div className={associationTableContainerClass}>
                  <table className={associationTableClass}>
                    <thead className={adminAssociationTableHeadClass}>
                      <tr>
                        <th className={adminAssociationTableHeaderClass}>
                          Group
                        </th>
                        <th className={adminAssociationTableHeaderRightClass}>
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className={adminAssociationTableBodyClass}>
                      {linkedEditGroups.length === 0 ? (
                        <tr>
                          <td colSpan={2} className={adminAssociationTableEmptyCellClass}>
                            No linked groups yet.
                          </td>
                        </tr>
                      ) : (
                        linkedEditGroups.map((group) => (
                          <tr key={group.id}>
                            <td className={adminAssociationTableLabelCellClass}>{group.label}</td>
                            <td className={adminAssociationTableActionCellClass}>
                              <button
                                type="button"
                                onClick={() => setEditLinkedGroupIds((prev) => prev.filter((id) => id !== group.id))}
                                className={tableDeleteActionClasses}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {showEditGroupPanel && (
                  <AdminAssociationPickerPanel
                    title="Add UI groups"
                    hint="(filter by name)"
                    search={editGroupSearch}
                    onSearchChange={setEditGroupSearch}
                    searchAriaLabel="Search UI groups"
                    loading={false}
                    availableCount={availableEditGroups.length}
                    maxVisibleOptions={maxLinkOptions}
                    selectedCount={editGroupSelections.length}
                    loadingLabel="Loading UI groups..."
                    onCancel={() => {
                      setShowEditGroupPanel(false);
                      setEditGroupSelections([]);
                      setEditGroupSearch("");
                    }}
                    onAdd={() => {
                      if (editGroupSelections.length === 0) return;
                      setEditLinkedGroupIds((prev) =>
                        normalizeS3ConnectionLinkedIds([...prev, ...editGroupSelections]),
                      );
                      setEditGroupSelections([]);
                      setEditGroupSearch("");
                      setShowEditGroupPanel(false);
                    }}
                    addDisabled={editGroupSelections.length === 0}
                  >
                    <AdminAssociationCheckboxOptions
                      options={visibleAvailableEditGroups}
                      selectedIds={editGroupSelections}
                      onToggle={toggleEditGroupSelection}
                      getLabel={(group) => group.name}
                    />
                  </AdminAssociationPickerPanel>
                )}
              </div>
            )}
            </WorkflowTabs>

            <WorkflowActions>
              <UiButton variant="secondary" onClick={editCloseGuard.requestClose} disabled={editBusy}>
                Close
              </UiButton>
              <UiButton type="submit" disabled={editBusy}>
                {editBusy ? "Saving..." : "Save"}
              </UiButton>
            </WorkflowActions>
          </form>
          {editCloseGuard.confirmationDialog}

        </WorkflowPage>
      )}

      {/* Bulk delete modal */}
      {bulkDeleteOpen && (
        <Modal title={`Delete selected (${selectedIds.length})`} onClose={() => (!bulkDeleteBusy ? setBulkDeleteOpen(false) : null)}>
          <div className="space-y-4">
            <p className="ui-body">
              This will permanently delete {selectedIds.length} selected connection{selectedIds.length > 1 ? "s" : ""}.
            </p>
            <div className="flex justify-end gap-2">
              <UiButton variant="secondary" onClick={() => setBulkDeleteOpen(false)} disabled={bulkDeleteBusy}>
                Cancel
              </UiButton>
              <UiButton variant="danger" onClick={() => void submitBulkDelete()} disabled={bulkDeleteBusy}>
                {bulkDeleteBusy ? "Deleting..." : "Delete selected connections"}
              </UiButton>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete modal */}
      {deleteTarget && (
        <Modal title={`Delete: ${deleteTarget.name}`} onClose={() => (!deleteBusy ? setDeleteTarget(null) : null)}>
          <div className="space-y-4">
            {deleteError && <PageBanner tone="error">{deleteError}</PageBanner>}
            <p className="ui-body">This will permanently delete the connection and its credentials.</p>
            <div className="flex justify-end gap-2">
              <UiButton variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>
                Cancel
              </UiButton>
              <UiButton variant="danger" onClick={submitDelete} disabled={deleteBusy}>
                {deleteBusy ? "Deleting..." : "Delete"}
              </UiButton>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
