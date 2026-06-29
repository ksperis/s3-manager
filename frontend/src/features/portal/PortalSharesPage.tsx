/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import {
  createPortalStorageSpacePublicLink,
  grantPortalStorageSpaceShare,
  listPortalStorageSpacePublicLinks,
  listPortalStorageSpaceShares,
  revokePortalStorageSpacePublicLink,
  type PortalPublicLink,
  revokePortalStorageSpaceShare,
  updatePortalStorageSpaceShare,
  type PortalStorageSpaceRole,
  type PortalStorageSpaceShare,
} from "../../api/portal";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import { cx, uiDividerClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import type { PortalWorkspaceRole } from "./portalWorkspaceModel";
import {
  portalRoleTone,
  resolvePortalWorkspacePageState,
} from "./portalUi";
import { portalDateLabel, portalPublicLinkStatusLabel, portalRoleLabel } from "./portalI18n";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

const tabs = [
  { id: "with" },
  { id: "by" },
  { id: "links" },
] as const;

const roles: PortalStorageSpaceRole[] = ["Viewer", "Editor", "Owner"];

type ShareTab = (typeof tabs)[number]["id"];
type PendingShareAction =
  | { type: "revoke-share"; share: ShareRow }
  | { type: "revoke-public-link"; link: PortalPublicLink };
type ShareRow = {
  id: string;
  userId?: number | null;
  spaceId: string;
  spaceName: string;
  person: string;
  access: PortalWorkspaceRole;
  activityLabel: string;
};

function fromApiShare(share: PortalStorageSpaceShare): ShareRow {
  return {
    id: share.id,
    userId: share.user_id,
    spaceId: share.storage_space_id,
    spaceName: share.storage_space_name,
    person: share.email,
    access: share.role,
    activityLabel: share.activity_label ?? "Active",
  };
}

function SharesTable({
  shares,
  editable,
  busyShareId,
  onRoleChange,
  onRevoke,
}: {
  shares: ShareRow[];
  editable: boolean;
  busyShareId: string | null;
  onRoleChange: (share: ShareRow, role: PortalStorageSpaceRole) => void;
  onRevoke: (share: ShareRow) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="overflow-x-auto">
      <table className="ui-data-table min-w-[760px]">
        <thead>
          <tr>
            <th>{t({ en: "Name", fr: "Nom", de: "Name" })}</th>
            <th>{editable ? t({ en: "Shared with", fr: "Partagé avec", de: "Geteilt mit" }) : t({ en: "Shared by", fr: "Partagé par", de: "Geteilt von" })}</th>
            <th>{t({ en: "Access", fr: "Accès", de: "Zugriff" })}</th>
            <th>{t({ en: "Activity", fr: "Activité", de: "Aktivität" })}</th>
            {editable ? <th className="w-28 text-right">{t({ en: "Action", fr: "Action", de: "Aktion" })}</th> : null}
          </tr>
        </thead>
        <tbody>
          {shares.map((share) => (
            <tr key={share.id}>
              <td className={cx("font-bold", uiTitleTextClass)}>{share.spaceName}</td>
              <td>{share.person}</td>
              <td>
                {editable && share.userId ? (
                  <select
                    className="ui-control h-8 py-1.5 text-xs"
                    value={share.access}
                    disabled={busyShareId === share.id}
                    onChange={(event) => onRoleChange(share, event.target.value as PortalStorageSpaceRole)}
                    aria-label={t({ en: `Access for ${share.person}`, fr: `Accès pour ${share.person}`, de: `Zugriff für ${share.person}` })}
                  >
                    {roles.map((role) => (
                      <option key={role} value={role}>{portalRoleLabel(role, t)}</option>
                    ))}
                  </select>
                ) : (
                  <UiBadge tone={portalRoleTone(share.access)}>{portalRoleLabel(share.access, t)}</UiBadge>
                )}
              </td>
              <td>{share.activityLabel === "Active" ? t({ en: "Active", fr: "Actif", de: "Aktiv" }) : share.activityLabel}</td>
              {editable ? (
                <td className="text-right">
                  {share.userId ? (
                    <button
                      type="button"
                      disabled={busyShareId === share.id}
                      onClick={() => onRevoke(share)}
                      className={tableDeleteActionClasses}
                    >
                      {t({ en: "Revoke", fr: "Révoquer", de: "Widerrufen" })}
                    </button>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
          {shares.length === 0 ? (
            <tr>
              <td colSpan={editable ? 5 : 4} className={cx("py-6 text-center text-xs font-semibold", uiMutedTextClass)}>
                {t({ en: "No shares to display.", fr: "Aucun partage à afficher.", de: "Keine Freigaben zum Anzeigen." })}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export default function PortalSharesPage() {
  const { locale, t } = useI18n();
  const [activeTab, setActiveTab] = useState<ShareTab>("with");
  const [apiShares, setApiShares] = useState<PortalStorageSpaceShare[] | null>(null);
  const [publicLinks, setPublicLinks] = useState<PortalPublicLink[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [sharesError, setSharesError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [selectedSpaceId, setSelectedSpaceId] = useState("");
  const [selectedRole, setSelectedRole] = useState<PortalStorageSpaceRole>("Viewer");
  const [publicObjectKey, setPublicObjectKey] = useState("");
  const [publicLinkExpiration, setPublicLinkExpiration] = useState("");
  const [busyShareId, setBusyShareId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingShareAction | null>(null);
  const { workspace, loading, error, hasAccountContext, accountError, accountLoading, accountIdForApi } = usePortalWorkspaceData();
  const activeSharedSpaces = useMemo(
    () => workspace.spaces.filter((space) => space.status !== "Archived" && space.visibility === "shared"),
    [workspace.spaces]
  );
  const activeSharedOwnerSpaces = useMemo(
    () => activeSharedSpaces.filter((space) => space.role === "Owner"),
    [activeSharedSpaces]
  );

  const spaceIds = useMemo(() => workspace.spaces.map((space) => space.id).join("|"), [workspace.spaces]);
  const activeSharedSpaceIds = useMemo(() => activeSharedSpaces.map((space) => space.id).join("|"), [activeSharedSpaces]);

  useEffect(() => {
    const selectableSpaces = activeTab === "with" ? activeSharedSpaces : activeSharedOwnerSpaces;
    if (!selectedSpaceId && selectableSpaces[0]) {
      setSelectedSpaceId(selectableSpaces[0].id);
    }
    if (selectedSpaceId && !selectableSpaces.some((space) => space.id === selectedSpaceId)) {
      setSelectedSpaceId(selectableSpaces[0]?.id ?? "");
    }
  }, [activeSharedOwnerSpaces, activeSharedSpaces, activeTab, selectedSpaceId]);

  useEffect(() => {
    let cancelled = false;
    if (!accountIdForApi || activeSharedSpaces.length === 0) {
      setApiShares(null);
      setSharesLoading(false);
      setSharesError(null);
      return () => {
        cancelled = true;
      };
    }
    setSharesLoading(true);
    setSharesError(null);
    Promise.all(activeSharedSpaces.map((space) => listPortalStorageSpaceShares(accountIdForApi, space.id)))
      .then((results) => {
        if (!cancelled) setApiShares(results.flat());
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setApiShares(null);
          setSharesError(extractApiError(err, t({ en: "Unable to load shares.", fr: "Impossible de charger les partages.", de: "Freigaben können nicht geladen werden." })));
        }
      })
      .finally(() => {
        if (!cancelled) setSharesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, activeSharedSpaceIds, activeSharedSpaces, t]);

  useEffect(() => {
    let cancelled = false;
    if (!accountIdForApi || workspace.spaces.length === 0) {
      setPublicLinks([]);
      return () => {
        cancelled = true;
      };
    }
    Promise.all(
      workspace.spaces
        .filter((space) => space.role === "Owner" && space.status !== "Archived" && space.visibility === "shared")
        .map((space) => listPortalStorageSpacePublicLinks(accountIdForApi, space.id, { includeRevoked: true }))
    )
      .then((results) => {
        if (!cancelled) setPublicLinks(results.flat());
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setPublicLinks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, spaceIds, workspace.spaces]);

  const rows = useMemo(() => {
    return {
      with: (apiShares ?? []).filter((share) => share.direction === "with_me").map(fromApiShare),
      by: (apiShares ?? []).filter((share) => share.direction === "by_me").map(fromApiShare),
      links: [],
    };
  }, [apiShares]);

  const refreshSpaceShares = async (spaceId: string) => {
    if (!accountIdForApi) return;
    const updated = await listPortalStorageSpaceShares(accountIdForApi, spaceId);
    setApiShares((current) => {
      const rest = (current ?? []).filter((share) => share.storage_space_id !== spaceId);
      return [...rest, ...updated];
    });
  };

  const handleCreateShare = async () => {
    if (!accountIdForApi || !selectedSpaceId || !email.trim()) return;
    if (!activeSharedOwnerSpaces.some((space) => space.id === selectedSpaceId)) return;
    setBusyShareId("new");
    setSharesError(null);
    try {
      const share = await grantPortalStorageSpaceShare(accountIdForApi, selectedSpaceId, {
        email: email.trim(),
        role: selectedRole,
      });
      setEmail("");
      setApiShares((current) => {
        const filtered = (current ?? []).filter((item) => item.id !== share.id);
        return [...filtered, share];
      });
      setActiveTab("by");
    } catch (err) {
      console.error(err);
      setSharesError(extractApiError(err, t({ en: "Unable to create share.", fr: "Impossible de créer le partage.", de: "Freigabe kann nicht erstellt werden." })));
    } finally {
      setBusyShareId(null);
    }
  };

  const handleRoleChange = async (share: ShareRow, role: PortalStorageSpaceRole) => {
    if (!accountIdForApi || !share.userId) return;
    setBusyShareId(share.id);
    setSharesError(null);
    try {
      const updated = await updatePortalStorageSpaceShare(accountIdForApi, share.spaceId, share.userId, role);
      setApiShares((current) => (current ?? []).map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      console.error(err);
      setSharesError(extractApiError(err, t({ en: "Unable to update share.", fr: "Impossible de mettre à jour le partage.", de: "Freigabe kann nicht aktualisiert werden." })));
    } finally {
      setBusyShareId(null);
    }
  };

  const handleRevoke = async (share: ShareRow) => {
    if (!accountIdForApi || !share.userId) return;
    setPendingAction({ type: "revoke-share", share });
  };

  const confirmRevoke = async (share: ShareRow) => {
    if (!accountIdForApi || !share.userId) return;
    setBusyShareId(share.id);
    setSharesError(null);
    try {
      await revokePortalStorageSpaceShare(accountIdForApi, share.spaceId, share.userId);
      await refreshSpaceShares(share.spaceId);
      setPendingAction(null);
    } catch (err) {
      console.error(err);
      setSharesError(extractApiError(err, t({ en: "Unable to revoke share.", fr: "Impossible de révoquer le partage.", de: "Freigabe kann nicht widerrufen werden." })));
      setPendingAction(null);
    } finally {
      setBusyShareId(null);
    }
  };

  const handleCreatePublicLink = async () => {
    if (!accountIdForApi || !selectedSpaceId || !publicObjectKey.trim()) return;
    setBusyShareId("public-link");
    setSharesError(null);
    try {
      const link = await createPortalStorageSpacePublicLink(accountIdForApi, selectedSpaceId, {
        object_key: publicObjectKey.trim(),
        label: publicObjectKey.trim().split("/").filter(Boolean).at(-1) ?? publicObjectKey.trim(),
        expires_at: publicLinkExpiration ? new Date(publicLinkExpiration).toISOString() : null,
      });
      setPublicLinks((current) => [link, ...current.filter((item) => item.id !== link.id)]);
      setPublicObjectKey("");
      setActiveTab("links");
    } catch (err) {
      console.error(err);
      setSharesError(extractApiError(err, t({ en: "Unable to create public link.", fr: "Impossible de créer le lien public.", de: "Öffentlicher Link kann nicht erstellt werden." })));
    } finally {
      setBusyShareId(null);
    }
  };

  const handleRevokePublicLink = async (link: PortalPublicLink) => {
    if (!accountIdForApi) return;
    setPendingAction({ type: "revoke-public-link", link });
  };

  const confirmRevokePublicLink = async (link: PortalPublicLink) => {
    if (!accountIdForApi) return;
    setBusyShareId(`public-link-${link.id}`);
    setSharesError(null);
    try {
      const updated = await revokePortalStorageSpacePublicLink(accountIdForApi, link.storage_space_id, link.id);
      setPublicLinks((current) => [
        ...current.filter((item) => item.storage_space_id !== link.storage_space_id),
        ...updated,
      ]);
      setPendingAction(null);
    } catch (err) {
      console.error(err);
      setSharesError(extractApiError(err, t({ en: "Unable to revoke public link.", fr: "Impossible de révoquer le lien public.", de: "Öffentlicher Link kann nicht widerrufen werden." })));
      setPendingAction(null);
    } finally {
      setBusyShareId(null);
    }
  };

  const shares = rows[activeTab];
  const displayedCount = activeTab === "links" ? publicLinks.length : shares.length;

  const pageState = resolvePortalWorkspacePageState({
    accountLoading,
    loading,
    accountError,
    error,
    hasAccountContext,
    loadingMessage: t({ en: "Loading shares...", fr: "Chargement des partages...", de: "Freigaben werden geladen..." }),
    noAccountMessage: t({ en: "Select an account to manage shares.", fr: "Sélectionnez un compte pour gérer les partages.", de: "Wählen Sie ein Konto aus, um Freigaben zu verwalten." }),
  });
  if (pageState) return pageState;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t({ en: "Shares", fr: "Partages", de: "Freigaben" })}
        description={t({ en: "Manage shared access with Viewer, Editor, and Owner roles.", fr: "Gérez les accès partagés avec les rôles Lecteur, Éditeur et Propriétaire.", de: "Verwalten Sie geteilte Zugriffe mit den Rollen Betrachter, Bearbeiter und Eigentümer." })}
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "Shares", fr: "Partages", de: "Freigaben" }) })}
      />
      {sharesError ? <PageBanner tone="warning">{sharesError}</PageBanner> : null}
      <UiCard>
        <div className={cx("mb-3 border-b pb-3", uiDividerClass)}>
          <PageTabs
            tabs={[
              { id: "with", label: t({ en: "Shared with me", fr: "Partagés avec moi", de: "Mit mir geteilt" }) },
              { id: "by", label: t({ en: "Shared by me", fr: "Partagés par moi", de: "Von mir geteilt" }) },
              { id: "links", label: t({ en: "Public links", fr: "Liens publics", de: "Öffentliche Links" }) },
            ]}
            activeTab={activeTab}
            onChange={(tab) => setActiveTab(tab as ShareTab)}
            variant="bar"
          />
        </div>
        {sharesLoading ? <div className={cx("mb-3 text-xs font-semibold", uiMutedTextClass)}>{t({ en: "Loading share permissions...", fr: "Chargement des permissions de partage...", de: "Freigabeberechtigungen werden geladen..." })}</div> : null}
        {activeTab === "links" ? (
          <div className="overflow-x-auto">
            <table className="ui-data-table min-w-[860px]">
              <thead>
                <tr>
                  <th>{t({ en: "Storage Space", fr: "Espace de stockage", de: "Speicherbereich" })}</th>
                  <th>{t({ en: "Object", fr: "Objet", de: "Objekt" })}</th>
                  <th>{t({ en: "Status", fr: "Statut", de: "Status" })}</th>
                  <th>{t({ en: "Expires", fr: "Expire", de: "Läuft ab" })}</th>
                  <th>{t({ en: "URL", fr: "URL", de: "URL" })}</th>
                  <th className="text-right">{t({ en: "Action", fr: "Action", de: "Aktion" })}</th>
                </tr>
              </thead>
              <tbody>
                {publicLinks.map((link) => (
                  <tr key={link.id}>
                    <td className={cx("font-bold", uiTitleTextClass)}>{link.storage_space_name}</td>
                    <td>{link.object_name}</td>
                    <td><UiBadge tone={link.status === "Active" ? "success" : "neutral"}>{portalPublicLinkStatusLabel(link.status, t)}</UiBadge></td>
                    <td>{link.expires_at ? portalDateLabel(link.expires_at, locale) : "-"}</td>
                    <td className="max-w-[260px] truncate text-primary dark:text-primary-200">{link.url}</td>
                    <td className="text-right">
                      {link.status === "Active" ? (
                        <button
                          type="button"
                          disabled={busyShareId === `public-link-${link.id}`}
                          onClick={() => handleRevokePublicLink(link)}
                          className={tableDeleteActionClasses}
                        >
                          {t({ en: "Revoke", fr: "Révoquer", de: "Widerrufen" })}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {publicLinks.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={cx("py-6 text-center text-xs font-semibold", uiMutedTextClass)}>
                      {t({ en: "No public links to display.", fr: "Aucun lien public à afficher.", de: "Keine öffentlichen Links zum Anzeigen." })}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : (
          <SharesTable
            shares={shares}
            editable={activeTab === "by"}
            busyShareId={busyShareId}
            onRoleChange={handleRoleChange}
            onRevoke={handleRevoke}
          />
        )}
        <div className={cx("mt-4 flex items-center justify-between text-[11px] font-semibold", uiMutedTextClass)}>
          <span>{displayedCount} of {displayedCount}</span>
        </div>
      </UiCard>

      {activeTab === "by" ? (
        <UiCard title={t({ en: "Create a new share", fr: "Créer un nouveau partage", de: "Neue Freigabe erstellen" })}>
          <div className="grid gap-3 md:grid-cols-[1fr_180px_160px_auto]">
            <select className="ui-control h-8 py-1.5 text-xs" value={selectedSpaceId} onChange={(event) => setSelectedSpaceId(event.target.value)}>
              {activeSharedOwnerSpaces.map((space) => (
                <option key={space.id} value={space.id}>{space.name}</option>
              ))}
            </select>
            <input
              className="ui-control h-8 text-xs"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="user@example.com"
            />
            <select className="ui-control h-8 py-1.5 text-xs" value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as PortalStorageSpaceRole)}>
              {roles.map((role) => (
                <option key={role} value={role}>{portalRoleLabel(role, t)}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={!accountIdForApi || !selectedSpaceId || !email.trim() || busyShareId === "new" || activeSharedOwnerSpaces.length === 0}
              onClick={handleCreateShare}
              className={tableActionButtonClasses}
            >
              {t({ en: "Create share", fr: "Créer le partage", de: "Freigabe erstellen" })}
            </button>
          </div>
        </UiCard>
      ) : activeTab === "links" ? (
        <UiCard title={t({ en: "Create a public link", fr: "Créer un lien public", de: "Öffentlichen Link erstellen" })}>
          <div className="grid gap-3 md:grid-cols-[180px_1fr_220px_auto]">
            <select className="ui-control h-8 py-1.5 text-xs" value={selectedSpaceId} onChange={(event) => setSelectedSpaceId(event.target.value)}>
              {activeSharedOwnerSpaces.map((space) => (
                <option key={space.id} value={space.id}>{space.name}</option>
              ))}
            </select>
            <input className="ui-control h-8 text-xs" value={publicObjectKey} onChange={(event) => setPublicObjectKey(event.target.value)} placeholder="path/to/object.ext" />
            <input type="datetime-local" className="ui-control h-8 text-xs" value={publicLinkExpiration} onChange={(event) => setPublicLinkExpiration(event.target.value)} aria-label={t({ en: "Public link expiration", fr: "Expiration du lien public", de: "Ablauf des öffentlichen Links" })} />
            <UiButton
              disabled={!accountIdForApi || !selectedSpaceId || !publicObjectKey.trim() || busyShareId === "public-link" || activeSharedOwnerSpaces.length === 0}
              onClick={handleCreatePublicLink}
              className="h-8 px-3 py-1.5"
            >
              {t({ en: "Create link", fr: "Créer le lien", de: "Link erstellen" })}
            </UiButton>
          </div>
        </UiCard>
      ) : null}

      {pendingAction?.type === "revoke-share" ? (
        <ConfirmActionDialog
          title={t({ en: "Revoke access", fr: "Révoquer l'accès", de: "Zugriff widerrufen" })}
          description={t({ en: "Confirm that you want to remove this person's access.", fr: "Confirmez que vous voulez retirer l'accès de cette personne.", de: "Bestätigen Sie, dass Sie den Zugriff dieser Person entfernen möchten." })}
          confirmLabel={t({ en: "Revoke access", fr: "Révoquer l'accès", de: "Zugriff widerrufen" })}
          loading={busyShareId === pendingAction.share.id}
          details={[
            { label: t({ en: "Person", fr: "Personne", de: "Person" }), value: pendingAction.share.person },
            { label: t({ en: "Storage Space", fr: "Espace de stockage", de: "Speicherbereich" }), value: pendingAction.share.spaceName },
            { label: t({ en: "Access", fr: "Accès", de: "Zugriff" }), value: portalRoleLabel(pendingAction.share.access, t) },
          ]}
          impacts={[
            t({ en: "This person loses access to the Storage Space immediately.", fr: "Cette personne perd immédiatement l'accès à l'espace de stockage.", de: "Diese Person verliert sofort den Zugriff auf den Speicherbereich." }),
            t({ en: "Files and objects in the Storage Space are not deleted.", fr: "Les fichiers et objets de l'espace de stockage ne sont pas supprimés.", de: "Dateien und Objekte im Speicherbereich werden nicht gelöscht." }),
            t({ en: "You can share the Storage Space again later if needed.", fr: "Vous pourrez repartager l'espace de stockage plus tard si nécessaire.", de: "Sie können den Speicherbereich später bei Bedarf erneut freigeben." }),
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => confirmRevoke(pendingAction.share)}
        />
      ) : null}

      {pendingAction?.type === "revoke-public-link" ? (
        <ConfirmActionDialog
          title={t({ en: "Revoke public link", fr: "Révoquer le lien public", de: "Öffentlichen Link widerrufen" })}
          description={t({ en: "Confirm that you want to revoke this public link.", fr: "Confirmez que vous voulez révoquer ce lien public.", de: "Bestätigen Sie, dass Sie diesen öffentlichen Link widerrufen möchten." })}
          confirmLabel={t({ en: "Revoke link", fr: "Révoquer le lien", de: "Link widerrufen" })}
          loading={busyShareId === `public-link-${pendingAction.link.id}`}
          details={[
            { label: t({ en: "Object", fr: "Objet", de: "Objekt" }), value: pendingAction.link.object_name },
            { label: t({ en: "Storage Space", fr: "Espace de stockage", de: "Speicherbereich" }), value: pendingAction.link.storage_space_name },
            { label: t({ en: "Link", fr: "Lien", de: "Link" }), value: pendingAction.link.url, mono: true },
          ]}
          impacts={[
            t({ en: "Anyone using this URL loses access immediately.", fr: "Toute personne utilisant cette URL perd immédiatement l'accès.", de: "Alle, die diese URL verwenden, verlieren sofort den Zugriff." }),
            t({ en: "The object remains in the Storage Space.", fr: "L'objet reste dans l'espace de stockage.", de: "Das Objekt bleibt im Speicherbereich." }),
            t({ en: "You can create a new public link later if sharing is still allowed.", fr: "Vous pourrez créer un nouveau lien public plus tard si le partage reste autorisé.", de: "Sie können später einen neuen öffentlichen Link erstellen, wenn Freigaben weiter erlaubt sind." }),
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => confirmRevokePublicLink(pendingAction.link)}
        />
      ) : null}
    </div>
  );
}
