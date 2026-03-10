/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  PortalAccountRole,
  PortalIamComplianceReport,
  PortalState,
  PortalUserSummary,
  addPortalUser,
  applyPortalIamCompliance,
  deletePortalUser,
  fetchPortalIamCompliance,
  fetchPortalState,
  grantPortalUserBucket,
  listPortalUserBuckets,
  listPortalUsers,
  revokePortalUserBucket,
  updatePortalUserRole,
} from "../../api/portal";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import SortableHeader from "../../components/SortableHeader";
import TableEmptyState from "../../components/TableEmptyState";
import ListSectionCard from "../../components/list/ListSectionCard";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { useI18n } from "../../i18n";
import { confirmAction } from "../../utils/confirm";
import { extractApiError } from "../../utils/apiError";
import { usePortalAccountContext } from "./PortalAccountContext";

type SortField = "email" | "iam_username" | "role";

type SortState = {
  field: SortField;
  direction: "asc" | "desc";
};

function getUserEmail(): string | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { email?: string | null };
    return parsed.email ?? null;
  } catch {
    return null;
  }
}

const normalizePortalRole = (role?: string | null): PortalAccountRole => {
  if (role === "portal_manager") return "portal_manager";
  return "portal_user";
};

const hasPortalBucketRole = (role?: string | null) =>
  role === "portal_manager" || role === "portal_user";

const portalRoleBadgeClasses = (role?: string | null, iamOnly?: boolean | null) => {
  if (iamOnly) {
    return "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
  }
  if (role === "portal_manager") {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-100";
  }
  if (role === "portal_none") {
    return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-100";
  }
  return "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-100";
};

export default function PortalManagePage() {
  const { t } = useI18n();
  const { accountIdForApi, selectedAccount, hasAccountContext, loading: accountLoading, error: accountError } =
    usePortalAccountContext();
  const [portalState, setPortalState] = useState<PortalState | null>(null);
  const [stateLoading, setStateLoading] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);
  const [users, setUsers] = useState<PortalUserSummary[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [iamReport, setIamReport] = useState<PortalIamComplianceReport | null>(null);
  const [iamLoading, setIamLoading] = useState(false);
  const [iamApplying, setIamApplying] = useState(false);
  const [iamError, setIamError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState<PortalUserSummary | null>(null);
  const [editRole, setEditRole] = useState<PortalAccountRole>("portal_user");
  const [editBuckets, setEditBuckets] = useState<string[]>([]);
  const [editLoading, setEditLoading] = useState(false);
  const [editBucketAction, setEditBucketAction] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const [editBucketFilter, setEditBucketFilter] = useState("");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortState>({ field: "email", direction: "asc" });
  const userEmail = useMemo(() => getUserEmail(), []);
  const accountName = selectedAccount?.name ?? t({ en: "selected account", fr: "compte selectionne", de: "ausgewahltes Konto" });
  const userTableColumns: { label: string; field?: SortField | null; align?: "left" | "right" }[] = [
    { label: t({ en: "Email", fr: "Email", de: "E-Mail" }), field: "email" },
    { label: t({ en: "IAM user", fr: "Utilisateur IAM", de: "IAM-Benutzer" }), field: "iam_username" },
    { label: t({ en: "Role", fr: "Role", de: "Rolle" }), field: "role" },
    { label: t({ en: "Actions", fr: "Actions", de: "Aktionen" }), field: null, align: "right" },
  ];
  const portalRoleLabel = (role?: string | null, iamOnly?: boolean | null) => {
    if (iamOnly) return t({ en: "IAM only", fr: "IAM (hors portail)", de: "Nur IAM" });
    if (role === "portal_manager") {
      return t({ en: "Portal manager", fr: "Portal manager", de: "Portal-Manager" });
    }
    if (role === "portal_user") {
      return t({ en: "Portal user", fr: "Portal user", de: "Portal-Benutzer" });
    }
    if (role === "portal_none") {
      return t({ en: "No portal access", fr: "Pas d'acces portail", de: "Kein Portalzugriff" });
    }
    return t({ en: "Unknown role", fr: "Role inconnu", de: "Unbekannte Rolle" });
  };

  const canManagePortalUsers = Boolean(portalState?.can_manage_portal_users) || portalState?.account_role === "portal_manager";

  useEffect(() => {
    if (!accountIdForApi) {
      setPortalState(null);
      setStateError(null);
      setStateLoading(false);
      return;
    }
    setStateLoading(true);
    setStateError(null);
    fetchPortalState(accountIdForApi)
      .then((data) => {
        setPortalState(data);
      })
      .catch((err) => {
        console.error(err);
        setPortalState(null);
        setStateError(
          extractApiError(
            err,
            t({ en: "Unable to load portal context.", fr: "Impossible de charger le contexte portail.", de: "Portal-Kontext kann nicht geladen werden." })
          )
        );
      })
      .finally(() => setStateLoading(false));
  }, [accountIdForApi, t]);

  useEffect(() => {
    setUsers([]);
    setUsersError(null);
    setUsersLoading(false);
    if (!accountIdForApi || !canManagePortalUsers) return;
    setUsersLoading(true);
    listPortalUsers(accountIdForApi)
      .then((data) => {
        setUsers(data);
      })
      .catch((err) => {
        console.error(err);
        setUsersError(
          extractApiError(
            err,
            t({ en: "Unable to load portal users.", fr: "Impossible de charger les utilisateurs du portail.", de: "Portal-Benutzer konnen nicht geladen werden." })
          )
        );
      })
      .finally(() => setUsersLoading(false));
  }, [accountIdForApi, canManagePortalUsers, t]);

  useEffect(() => {
    setActionError(null);
    setActionMessage(null);
    setIamReport(null);
    setIamError(null);
    setIamLoading(false);
    setIamApplying(false);
    setShowCreateModal(false);
    setShowEditModal(false);
    setEditingUser(null);
    setEditBuckets([]);
    setEditRole("portal_user");
    setEditError(null);
    setEditMessage(null);
    setEditBucketAction(null);
    setEditBucketFilter("");
  }, [accountIdForApi]);

  const toggleSort = (field: SortField) => {
    setSort((prev) => {
      if (prev.field === field) {
        return { field, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { field, direction: "asc" };
    });
  };

  const filteredUsers = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const items = query
      ? users.filter((u) => u.email.toLowerCase().includes(query) || (u.iam_username ?? "").toLowerCase().includes(query))
      : users;
    const sorted = [...items].sort((a, b) => {
      const aValue =
        sort.field === "iam_username"
          ? a.iam_username ?? ""
          : sort.field === "role"
            ? portalRoleLabel(a.role, a.iam_only)
            : a.email;
      const bValue =
        sort.field === "iam_username"
          ? b.iam_username ?? ""
          : sort.field === "role"
            ? portalRoleLabel(b.role, b.iam_only)
            : b.email;
      if (aValue === bValue) return 0;
      return sort.direction === "asc" ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
    });
    return sorted;
  }, [filter, sort.direction, sort.field, users]);

  const canRenderUsers =
    !accountLoading &&
    !accountError &&
    !stateError &&
    hasAccountContext &&
    !stateLoading &&
    canManagePortalUsers;
  const userCountLabel = canRenderUsers
    ? t({
        en: `${filteredUsers.length} user(s)`,
        fr: `${filteredUsers.length} utilisateur(s)`,
        de: `${filteredUsers.length} Benutzer`,
      })
    : "-";
  const usersTableStatus = resolveListTableStatus({
    loading: usersLoading,
    error: usersError,
    rowCount: filteredUsers.length,
  });
  const usersContextState =
    accountLoading
      ? {
          message: t({ en: "Loading context...", fr: "Chargement du contexte...", de: "Kontext wird geladen..." }),
          tone: "neutral" as const,
        }
      : accountError
        ? { message: accountError, tone: "error" as const }
        : stateError
          ? {
              message: t({ en: "Unable to load portal context.", fr: "Impossible de charger le contexte portail.", de: "Portal-Kontext kann nicht geladen werden." }),
              tone: "error" as const,
            }
          : !hasAccountContext
            ? {
                message: t({ en: "Select an account to continue.", fr: "Selectionnez un compte pour continuer.", de: "Wahlen Sie ein Konto, um fortzufahren." }),
                tone: "neutral" as const,
              }
            : stateLoading
              ? {
                  message: t({ en: "Loading permissions...", fr: "Chargement des permissions...", de: "Berechtigungen werden geladen..." }),
                  tone: "neutral" as const,
                }
              : !canManagePortalUsers
                ? {
                    message: t({ en: "Access reserved for portal managers.", fr: "Acces reserve aux managers du portail.", de: "Zugriff nur fur Portal-Manager." }),
                    tone: "neutral" as const,
                  }
                : null;
  const bucketAccessRows = useMemo(() => {
    const available = portalState?.buckets || [];
    const query = editBucketFilter.trim().toLowerCase();
    const filtered = query
      ? available.filter((bucket) => bucket.name.toLowerCase().includes(query))
      : available;
    return filtered
      .map((bucket) => ({
        name: bucket.name,
        hasAccess: editBuckets.includes(bucket.name),
      }))
      .sort((a, b) => {
        if (a.hasAccess !== b.hasAccess) return a.hasAccess ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [editBucketFilter, editBuckets, portalState?.buckets]);

  const openEditModal = (user: PortalUserSummary) => {
    if (!user.id || user.iam_only || !accountIdForApi || !canManagePortalUsers) return;
    setEditingUser(user);
    setEditRole(normalizePortalRole(user.role));
    setEditBuckets([]);
    setEditError(null);
    setEditMessage(null);
    setEditBucketAction(null);
    setEditBucketFilter("");
    setEditLoading(true);
    setShowEditModal(true);
    listPortalUserBuckets(accountIdForApi, user.id)
      .then((resp) => {
        const buckets = resp.buckets || [];
        setEditBuckets(buckets);
      })
      .catch((err) => {
        setEditError(
          extractApiError(
            err,
            t({ en: "Unable to load bucket permissions.", fr: "Impossible de charger les droits buckets.", de: "Bucket-Berechtigungen konnen nicht geladen werden." })
          )
        );
      })
      .finally(() => setEditLoading(false));
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setEditingUser(null);
    setEditBuckets([]);
    setEditError(null);
    setEditMessage(null);
    setEditLoading(false);
    setEditBucketAction(null);
    setEditBucketFilter("");
  };

  const handleCreatePortalUser = async (event: FormEvent) => {
    event.preventDefault();
    if (!accountIdForApi || !canManagePortalUsers || !newUserEmail.trim()) return;
    setActionError(null);
    setActionMessage(null);
    setCreatingUser(true);
    try {
      const created = await addPortalUser(accountIdForApi, newUserEmail.trim());
      setUsers((prev) => [created, ...prev.filter((u) => u.id !== created.id)]);
      setActionMessage(t({ en: "User added to portal.", fr: "Utilisateur ajoute au portail.", de: "Benutzer zum Portal hinzugefugt." }));
      setNewUserEmail("");
      setShowCreateModal(false);
    } catch (err) {
      console.error(err);
      setActionError(t({ en: "Unable to add user. Check email and permissions.", fr: "Ajout impossible. Verifiez l'email et les droits.", de: "Benutzer konnte nicht hinzugefugt werden. Prufen Sie E-Mail und Berechtigungen." }));
    } finally {
      setCreatingUser(false);
    }
  };

  const handleRemovePortalUser = async (user: PortalUserSummary) => {
    if (!accountIdForApi || !canManagePortalUsers || !user.id) return;
    if (userEmail && user.email === userEmail) {
      setActionError(t({ en: "You cannot remove your own access.", fr: "Vous ne pouvez pas retirer votre propre acces.", de: "Sie konnen Ihren eigenen Zugriff nicht entfernen." }));
      return;
    }
    if (
      !confirmAction(
        t({
          en: `Remove ${user.email} from portal?`,
          fr: `Retirer ${user.email} du portail ?`,
          de: `${user.email} aus dem Portal entfernen?`,
        })
      )
    )
      return;
    setActionError(null);
    setActionMessage(null);
    setBusyUserId(user.id);
    try {
      await deletePortalUser(accountIdForApi, user.id);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      setActionMessage(t({ en: "User removed from portal.", fr: "Utilisateur retire du portail.", de: "Benutzer aus dem Portal entfernt." }));
      if (editingUser?.id === user.id) {
        closeEditModal();
      }
    } catch (err) {
      console.error(err);
      setActionError(t({ en: "Unable to remove user. Check your permissions.", fr: "Suppression impossible. Verifiez vos droits.", de: "Benutzer konnte nicht entfernt werden. Prufen Sie Ihre Berechtigungen." }));
    } finally {
      setBusyUserId(null);
    }
  };

  const handleUpdatePortalRole = async () => {
    if (!accountIdForApi || !canManagePortalUsers || !editingUser?.id) return;
    const currentRole = normalizePortalRole(editingUser.role);
    if (editRole === currentRole) return;
    if (editRole === "portal_user" && editingUser.email === userEmail) {
      setEditError(t({ en: "You cannot remove your own manager rights.", fr: "Vous ne pouvez pas retirer vos propres droits de manager.", de: "Sie konnen Ihre eigenen Manager-Rechte nicht entfernen." }));
      return;
    }
    setEditError(null);
    setEditMessage(null);
    setBusyUserId(editingUser.id);
    try {
      const updated = await updatePortalUserRole(accountIdForApi, editingUser.id, editRole);
      setUsers((prev) => prev.map((u) => (u.id === editingUser.id ? { ...u, role: updated.role ?? editRole } : u)));
      setEditingUser((prev) => (prev ? { ...prev, role: updated.role ?? editRole } : prev));
      setEditMessage(t({ en: "Role updated.", fr: "Role mis a jour.", de: "Rolle aktualisiert." }));
    } catch (err) {
      console.error(err);
      setEditError(t({ en: "Update failed. Check your permissions.", fr: "Mise a jour impossible. Verifiez vos droits.", de: "Aktualisierung fehlgeschlagen. Prufen Sie Ihre Berechtigungen." }));
    } finally {
      setBusyUserId(null);
    }
  };

  const handleGrantPortalBucket = async (bucketName: string) => {
    if (!accountIdForApi || !editingUser?.id || !bucketName) return;
    if (!hasPortalBucketRole(editingUser.role)) {
      setEditError(
        t({
          en: "Assign a portal role before managing bucket permissions.",
          fr: "Attribuez un role portail avant de gerer les droits bucket.",
          de: "Weisen Sie zuerst eine Portal-Rolle zu, bevor Sie Bucket-Rechte verwalten.",
        })
      );
      return;
    }
    setEditBucketAction(bucketName);
    setEditError(null);
    setEditMessage(null);
    try {
      const resp = await grantPortalUserBucket(accountIdForApi, editingUser.id, bucketName);
      const buckets = resp.buckets || [];
      setEditBuckets(buckets);
      setEditMessage(
        t({
          en: `Access granted to bucket ${bucketName}.`,
          fr: `Acces ajoute au bucket ${bucketName}.`,
          de: `Zugriff auf Bucket ${bucketName} gewahrt.`,
        })
      );
    } catch (err) {
      console.error(err);
      setEditError(t({ en: "Unable to grant access. Check your permissions.", fr: "Ajout impossible. Verifiez vos droits.", de: "Zugriff konnte nicht gewahrt werden. Prufen Sie Ihre Berechtigungen." }));
    } finally {
      setEditBucketAction(null);
    }
  };

  const handleRevokePortalBucket = async (bucketName: string) => {
    if (!accountIdForApi || !editingUser?.id || !bucketName) return;
    if (!hasPortalBucketRole(editingUser.role)) {
      setEditError(
        t({
          en: "Assign a portal role before managing bucket permissions.",
          fr: "Attribuez un role portail avant de gerer les droits bucket.",
          de: "Weisen Sie zuerst eine Portal-Rolle zu, bevor Sie Bucket-Rechte verwalten.",
        })
      );
      return;
    }
    setEditBucketAction(bucketName);
    setEditError(null);
    setEditMessage(null);
    try {
      const resp = await revokePortalUserBucket(accountIdForApi, editingUser.id, bucketName);
      const buckets = resp.buckets || [];
      setEditBuckets(buckets);
      setEditMessage(
        t({
          en: `Access removed from bucket ${bucketName}.`,
          fr: `Acces retire du bucket ${bucketName}.`,
          de: `Zugriff auf Bucket ${bucketName} entfernt.`,
        })
      );
    } catch (err) {
      console.error(err);
      setEditError(t({ en: "Unable to revoke access. Check your permissions.", fr: "Retrait impossible. Verifiez vos droits.", de: "Zugriff konnte nicht entzogen werden. Prufen Sie Ihre Berechtigungen." }));
    } finally {
      setEditBucketAction(null);
    }
  };

  const handleCheckIamCompliance = async () => {
    if (!accountIdForApi || !canManagePortalUsers) return;
    setIamLoading(true);
    setIamError(null);
    try {
      const report = await fetchPortalIamCompliance(accountIdForApi);
      setIamReport(report);
    } catch (err) {
      console.error(err);
      setIamError(t({ en: "Unable to check IAM compliance.", fr: "Impossible de verifier la conformite IAM.", de: "IAM-Konformitat kann nicht gepruft werden." }));
      setIamReport(null);
    } finally {
      setIamLoading(false);
    }
  };

  const handleApplyIamCompliance = async () => {
    if (!accountIdForApi || !canManagePortalUsers || !iamReport || iamReport.ok) return;
    if (
      !confirmAction(
        t({
          en: "Reapply IAM permissions from portal settings?",
          fr: "Reappliquer les droits IAM selon les settings du portail ?",
          de: "IAM-Berechtigungen gemass Portal-Einstellungen erneut anwenden?",
        })
      )
    )
      return;
    setIamApplying(true);
    setIamError(null);
    try {
      const report = await applyPortalIamCompliance(accountIdForApi);
      setIamReport(report);
      setActionMessage(t({ en: "IAM permissions reapplied.", fr: "Droits IAM reappliques.", de: "IAM-Berechtigungen erneut angewendet." }));
    } catch (err) {
      console.error(err);
      setIamError(t({ en: "Unable to reapply IAM permissions.", fr: "Impossible de reappliquer les droits IAM.", de: "IAM-Berechtigungen konnen nicht erneut angewendet werden." }));
    } finally {
      setIamApplying(false);
    }
  };

  const pageDescription = selectedAccount
    ? t({
        en: `Manage users and bucket permissions for ${accountName}.`,
        fr: `Gerez les utilisateurs et leurs droits buckets pour ${accountName}.`,
        de: `Verwalten Sie Benutzer und Bucket-Rechte fur ${accountName}.`,
      })
    : t({
        en: "Manage portal users and bucket permissions.",
        fr: "Gerez les utilisateurs et leurs droits buckets du portail.",
        de: "Verwalten Sie Portal-Benutzer und Bucket-Berechtigungen.",
      });

  const headerActions = canManagePortalUsers
    ? [{ label: t({ en: "Add user", fr: "Ajouter un utilisateur", de: "Benutzer hinzufugen" }), onClick: () => setShowCreateModal(true) }]
    : [];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t({ en: "Portal management", fr: "Gestion du portail", de: "Portal-Verwaltung" })}
        description={pageDescription}
        breadcrumbs={[
          { label: t({ en: "Portal", fr: "Portail", de: "Portal" }), to: "/portal" },
          { label: t({ en: "Manage", fr: "Gestion", de: "Verwaltung" }) },
        ]}
        actions={headerActions}
      />

      {accountError && <PageBanner tone="error">{accountError}</PageBanner>}
      {stateError && <PageBanner tone="error">{stateError}</PageBanner>}
      {actionError && <PageBanner tone="error">{actionError}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}


      {hasAccountContext && canManagePortalUsers && (
        <div className="ui-surface-card">
          <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">
                  {t({ en: "Portal IAM compliance", fr: "Conformite IAM portail", de: "Portal-IAM-Konformitat" })}
                </p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  {t({ en: "Compares existing IAM permissions with portal settings.", fr: "Compare les droits IAM existants avec les settings du portail.", de: "Vergleicht bestehende IAM-Rechte mit den Portal-Einstellungen." })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleCheckIamCompliance}
                  disabled={!accountIdForApi || iamLoading || iamApplying}
                  className="rounded-md border border-slate-200 px-3 py-2 ui-caption font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
                >
                  {iamLoading
                    ? t({ en: "Checking...", fr: "Verification...", de: "Prufung..." })
                    : t({ en: "Check", fr: "Verifier", de: "Prufen" })}
                </button>
                <button
                  type="button"
                  onClick={handleApplyIamCompliance}
                  disabled={!iamReport || iamReport.ok || iamLoading || iamApplying}
                  className="rounded-md bg-primary px-3 py-2 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
                >
                  {iamApplying
                    ? t({ en: "Reapplying...", fr: "Reapplication...", de: "Erneutes Anwenden..." })
                    : t({ en: "Reapply", fr: "Reappliquer", de: "Erneut anwenden" })}
                </button>
              </div>
            </div>
          </div>
          <div className="px-4 py-4">
            {iamError && <PageBanner tone="error">{iamError}</PageBanner>}
            {!iamError && iamLoading && (
              <PageBanner tone="info">
                {t({ en: "Check in progress...", fr: "Verification en cours...", de: "Prufung lauft..." })}
              </PageBanner>
            )}
            {!iamError && !iamLoading && iamReport && iamReport.ok && (
              <PageBanner tone="success">{t({ en: "No divergence detected.", fr: "Aucune divergence detectee.", de: "Keine Abweichung erkannt." })}</PageBanner>
            )}
            {!iamError && !iamLoading && iamReport && !iamReport.ok && (
              <div className="space-y-3">
                <PageBanner tone="warning">
                  {t({
                    en: `${iamReport.issues.length} divergence(s) detected.`,
                    fr: `${iamReport.issues.length} divergence(s) detectee(s).`,
                    de: `${iamReport.issues.length} Abweichung(en) erkannt.`,
                  })}
                </PageBanner>
                <div className="space-y-2">
                  {iamReport.issues.map((issue, index) => (
                    <div
                      key={`${issue.scope}-${issue.subject}-${index}`}
                      className="rounded-lg border border-slate-200/80 px-3 py-2 dark:border-slate-700"
                    >
                      <div className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {issue.scope === "group"
                          ? t({ en: "Group", fr: "Groupe", de: "Gruppe" })
                          : t({ en: "User", fr: "Utilisateur", de: "Benutzer" })}
                      </div>
                      <div className="ui-body font-semibold text-slate-900 dark:text-slate-100">{issue.subject}</div>
                      <div className="ui-caption text-slate-600 dark:text-slate-300">{issue.message}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!iamError && !iamLoading && !iamReport && (
              <PageBanner tone="info">
                {t({ en: "Run a check to detect IAM divergences.", fr: "Lancez une verification pour detecter les divergences IAM.", de: "Starten Sie eine Prufung, um IAM-Abweichungen zu erkennen." })}
              </PageBanner>
            )}
          </div>
        </div>
      )}

      <ListSectionCard
        title={t({ en: "Users", fr: "Utilisateurs", de: "Benutzer" })}
        subtitle={t({ en: "Role and bucket permissions for selected account.", fr: "Role et droits buckets pour le compte selectionne.", de: "Rolle und Bucket-Rechte fur das ausgewahlte Konto." })}
        rightContent={(
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <span className="ui-caption text-slate-500 dark:text-slate-400">{userCountLabel}</span>
            <div className="flex items-center gap-2 sm:justify-end">
              <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t({ en: "Filter", fr: "Filtre", de: "Filter" })}
              </span>
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t({ en: "Search by email or IAM", fr: "Rechercher par email ou IAM", de: "Nach E-Mail oder IAM suchen" })}
                disabled={!canRenderUsers}
                className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:w-64 md:w-72"
              />
            </div>
          </div>
        )}
      >
        <div className="overflow-x-auto">
          <table className="manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                {userTableColumns.map((col) => (
                  <SortableHeader
                    key={col.label}
                    label={col.label}
                    field={col.field}
                    activeField={sort.field}
                    direction={sort.direction}
                    align={col.align ?? (col.label === t({ en: "Actions", fr: "Actions", de: "Aktionen" }) ? "right" : "left")}
                    onSort={col.field ? (field) => toggleSort(field as SortField) : undefined}
                  />
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {usersContextState && (
                <TableEmptyState
                  colSpan={userTableColumns.length}
                  message={usersContextState.message}
                  tone={usersContextState.tone === "error" ? "error" : "neutral"}
                />
              )}
              {!usersContextState && usersTableStatus === "loading" && (
                <TableEmptyState
                  colSpan={userTableColumns.length}
                  message={t({ en: "Loading users...", fr: "Chargement des utilisateurs...", de: "Benutzer werden geladen..." })}
                />
              )}
              {!usersContextState && usersTableStatus === "error" && (
                <TableEmptyState
                  colSpan={userTableColumns.length}
                  message={t({ en: "Unable to load users.", fr: "Impossible de charger les utilisateurs.", de: "Benutzer konnen nicht geladen werden." })}
                  tone="error"
                />
              )}
              {!usersContextState && usersTableStatus === "empty" && (
                <TableEmptyState
                  colSpan={userTableColumns.length}
                  message={t({ en: "No portal user.", fr: "Aucun utilisateur portail.", de: "Kein Portal-Benutzer." })}
                />
              )}
              {!usersContextState && filteredUsers.map((user) => {
                const isIamOnly = Boolean(user.iam_only);
                const isSelf = Boolean(userEmail && user.email === userEmail);
                const busy = busyUserId === user.id;
                return (
                  <tr key={user.id ?? user.email} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="manager-table-cell px-6 py-4 ui-body font-semibold text-slate-900 dark:text-slate-100">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{user.email}</span>
                          {isSelf && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-200">
                              {t({ en: "You", fr: "Vous", de: "Sie" })}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="manager-table-cell px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                        <span className="font-mono">{user.iam_username || "-"}</span>
                      </td>
                      <td className="manager-table-cell px-6 py-4">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 ui-caption font-semibold ${portalRoleBadgeClasses(user.role, user.iam_only)}`}
                        >
                          {portalRoleLabel(user.role, user.iam_only)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {canManagePortalUsers && !isIamOnly ? (
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openEditModal(user)}
                              className={tableActionButtonClasses}
                              disabled={busy}
                            >
                              {t({ en: "Manage", fr: "Gerer", de: "Verwalten" })}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemovePortalUser(user)}
                              className={tableDeleteActionClasses}
                              disabled={busy || isSelf}
                            >
                              {busy
                                ? t({ en: "Deleting...", fr: "Suppression...", de: "Wird geloscht..." })
                                : t({ en: "Remove", fr: "Retirer", de: "Entfernen" })}
                            </button>
                          </div>
                        ) : (
                          <span className="ui-caption text-slate-400">
                            {t({ en: "Read only", fr: "Lecture seule", de: "Nur lesen" })}
                          </span>
                        )}
                      </td>
                    </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ListSectionCard>


      {showCreateModal && (
        <Modal title={t({ en: "Add user", fr: "Ajouter un utilisateur", de: "Benutzer hinzufugen" })} onClose={() => setShowCreateModal(false)}>
          {actionError && (
            <PageBanner tone="error" className="mb-3">
              {actionError}
            </PageBanner>
          )}
          <form onSubmit={handleCreatePortalUser} className="space-y-3">
            <div className="flex flex-col gap-1">
              <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Email *</label>
              <input
                type="email"
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                placeholder={t({ en: "first.last@example.com", fr: "prenom.nom@example.com", de: "vorname.nachname@example.com" })}
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                required
              />
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                {t({ en: 'Default role is "Portal user". You can promote later.', fr: 'Le role par defaut est "Portal user". Vous pourrez promouvoir ensuite.', de: 'Die Standardrolle ist "Portal user". Sie konnen spater befordern.' })}
              </p>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={creatingUser || !newUserEmail.trim()}
                className="rounded-md bg-primary px-4 py-2 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
              >
                {creatingUser
                  ? t({ en: "Adding...", fr: "Ajout...", de: "Wird hinzugefugt..." })
                  : t({ en: "Add", fr: "Ajouter", de: "Hinzufugen" })}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showEditModal && editingUser && (
        <Modal
          title={t({
            en: `Manage ${editingUser.email}`,
            fr: `Gerer ${editingUser.email}`,
            de: `${editingUser.email} verwalten`,
          })}
          onClose={closeEditModal}
        >
          {editError && (
            <PageBanner tone="error" className="mb-3">
              {editError}
            </PageBanner>
          )}
          {editMessage && (
            <PageBanner tone="success" className="mb-3">
              {editMessage}
            </PageBanner>
          )}
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t({ en: "Email", fr: "Email", de: "E-Mail" })}
                </span>
                <div className="rounded-md border border-slate-200 px-3 py-2 ui-body text-slate-700 dark:border-slate-700 dark:text-slate-100">
                  {editingUser.email}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t({ en: "IAM user", fr: "Utilisateur IAM", de: "IAM-Benutzer" })}
                </span>
                <div className="rounded-md border border-slate-200 px-3 py-2 font-mono ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100">
                  {editingUser.iam_username || "-"}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">
                    {t({ en: "Portal role", fr: "Role portail", de: "Portal-Rolle" })}
                  </p>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    {t({ en: "Defines portal management rights.", fr: "Definit les droits de gestion du portail.", de: "Definiert die Verwaltungsrechte im Portal." })}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as PortalAccountRole)}
                    className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="portal_user">{t({ en: "Portal user", fr: "Portal user", de: "Portal-Benutzer" })}</option>
                    <option value="portal_manager">{t({ en: "Portal manager", fr: "Portal manager", de: "Portal-Manager" })}</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleUpdatePortalRole}
                    disabled={busyUserId === editingUser.id}
                    className="rounded-md bg-slate-900 px-3 py-2 ui-caption font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                  >
                    {busyUserId === editingUser.id
                      ? t({ en: "Updating...", fr: "Mise a jour...", de: "Wird aktualisiert..." })
                      : t({ en: "Update", fr: "Mettre a jour", de: "Aktualisieren" })}
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">
                    {t({ en: "Bucket permissions", fr: "Droits buckets", de: "Bucket-Berechtigungen" })}
                  </p>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    {t({
                      en: `${editBuckets.length} authorized`,
                      fr: `${editBuckets.length} autorise(s)`,
                      de: `${editBuckets.length} autorisiert`,
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="ui-caption font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    {t({ en: "Filter", fr: "Filtre", de: "Filter" })}
                  </span>
                  <input
                    type="search"
                    value={editBucketFilter}
                    onChange={(e) => setEditBucketFilter(e.target.value)}
                    placeholder={t({ en: "Search...", fr: "Rechercher...", de: "Suchen..." })}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:w-64"
                  />
                </div>
              </div>
              {!hasPortalBucketRole(editingUser.role) && (
                <p className="mt-2 ui-caption text-amber-700 dark:text-amber-300">
                  {t({
                    en: "Bucket permissions are available only for portal users/managers.",
                    fr: "Les droits bucket sont disponibles uniquement pour les portal users/managers.",
                    de: "Bucket-Rechte sind nur fur Portal-Benutzer/-Manager verfugbar.",
                  })}
                </p>
              )}
              <div className="mt-3 overflow-x-auto">
                <table className="manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                  <thead className="bg-slate-50 dark:bg-slate-900/50">
                    <tr>
                      <th className="px-3 py-2 text-left ui-caption font-semibold text-slate-600 dark:text-slate-300">
                        {t({ en: "Bucket", fr: "Bucket", de: "Bucket" })}
                      </th>
                      <th className="px-3 py-2 text-right ui-caption font-semibold text-slate-600 dark:text-slate-300">
                        {t({ en: "Action", fr: "Action", de: "Aktion" })}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {editLoading && (
                      <TableEmptyState
                        colSpan={2}
                        message={t({ en: "Loading buckets...", fr: "Chargement des buckets...", de: "Buckets werden geladen..." })}
                      />
                    )}
                    {!editLoading && bucketAccessRows.length === 0 && (
                      <TableEmptyState
                        colSpan={2}
                        message={
                          editBucketFilter.trim()
                            ? t({ en: "No bucket matches this filter.", fr: "Aucun bucket ne correspond au filtre.", de: "Kein Bucket entspricht dem Filter." })
                            : t({ en: "No bucket for this account.", fr: "Aucun bucket pour ce compte.", de: "Kein Bucket fur dieses Konto." })
                        }
                      />
                    )}
                    {!editLoading &&
                      bucketAccessRows.map((bucket) => {
                        const busy = editBucketAction === bucket.name;
                        const disabled =
                          editLoading || Boolean(editBucketAction) || !hasPortalBucketRole(editingUser.role);
                        return (
                          <tr key={bucket.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="px-3 py-2 ui-body font-mono text-slate-700 dark:text-slate-200">
                              {bucket.name}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {bucket.hasAccess ? (
                                <button
                                  type="button"
                                  onClick={() => handleRevokePortalBucket(bucket.name)}
                                  disabled={disabled}
                                  className={tableDeleteActionClasses}
                                >
                                  {busy
                                    ? t({ en: "Removing...", fr: "Retrait...", de: "Wird entfernt..." })
                                    : t({ en: "Remove", fr: "Retirer", de: "Entfernen" })}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleGrantPortalBucket(bucket.name)}
                                  disabled={disabled}
                                  className={tableActionButtonClasses}
                                >
                                  {busy
                                    ? t({ en: "Adding...", fr: "Ajout...", de: "Wird hinzugefugt..." })
                                    : t({ en: "Add", fr: "Ajouter", de: "Hinzufugen" })}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
