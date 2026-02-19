/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import ProfilePage from "../features/shared/ProfilePage";
import { readStoredUser } from "../utils/workspaces";
import EnvironmentSwitcher from "./EnvironmentSwitcher";
import { useGeneralSettings } from "./GeneralSettingsContext";
import Modal from "./Modal";
import ThemeToggle from "./ThemeToggle";

type TopbarProps = {
  projectName?: string;
  section?: string;
  inlineContent?: ReactNode;
  userEmail?: string | null;
  onLogout?: () => void;
  contextAction?: ReactNode;
  showMobileMenuButton?: boolean;
  mobileMenuOpen?: boolean;
  onMobileMenuToggle?: () => void;
};

function buildAccountInitial(value?: string | null): string {
  if (!value) return "U";
  const clean = value.trim().replace(/[^a-zA-Z0-9]/g, "");
  if (!clean) return "U";
  return clean[0].toUpperCase();
}

export default function Topbar({
  projectName,
  section,
  inlineContent,
  userEmail,
  onLogout,
  contextAction,
  showMobileMenuButton = false,
  mobileMenuOpen = false,
  onMobileMenuToggle,
}: TopbarProps) {
  const { generalSettings } = useGeneralSettings();
  const storedUser = useMemo(() => readStoredUser(), []);
  const isRgwSession = storedUser?.authType === "rgw_session";
  const canManagePrivateConnections =
    !isRgwSession &&
    (storedUser?.role === "ui_admin" ||
      (storedUser?.role === "ui_user" && generalSettings.allow_user_private_connections));

  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showConnectionsModal, setShowConnectionsModal] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

  const accountDisplay = userEmail ?? "Session";
  const accountInitial = buildAccountInitial(accountDisplay);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [accountMenuOpen]);

  const openProfileModal = () => {
    setAccountMenuOpen(false);
    setShowProfileModal(true);
  };

  const openConnectionsModal = () => {
    setAccountMenuOpen(false);
    setShowConnectionsModal(true);
  };

  const triggerLogout = () => {
    setAccountMenuOpen(false);
    onLogout?.();
  };

  return (
    <>
      <div
        data-topbar
        className="fixed inset-x-0 top-0 z-[45] border-b border-slate-200/80 bg-gradient-to-r from-white/95 via-white/90 to-slate-50/90 shadow-sm backdrop-blur supports-[backdrop-filter]:backdrop-blur dark:border-slate-800 dark:from-slate-900/95 dark:via-slate-900/90 dark:to-slate-950/90"
      >
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            {showMobileMenuButton && (
              <button
                type="button"
                onClick={onMobileMenuToggle}
                aria-label={mobileMenuOpen ? "Fermer la navigation" : "Ouvrir la navigation"}
                aria-controls="mobile-navigation-panel"
                aria-expanded={mobileMenuOpen}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200/80 bg-white text-slate-700 shadow-sm transition hover:border-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-primary-500 dark:focus-visible:ring-offset-slate-900 md:hidden"
              >
                <HamburgerIcon className="h-4 w-4" />
              </button>
            )}
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-200">
              <CubeIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0 leading-tight">
              <div className="truncate ui-body font-semibold text-slate-900 dark:text-slate-50">
                {projectName ?? "S3 Manager"}
              </div>
              {section && <div className="truncate ui-caption text-slate-500 dark:text-slate-400">{section}</div>}
            </div>
          </div>

          {inlineContent && <div className="hidden min-w-0 flex-1 items-center pl-1 md:flex">{inlineContent}</div>}
          {contextAction && <div className="hidden sm:flex">{contextAction}</div>}

          <div className="ml-auto flex items-center gap-2">
            <EnvironmentSwitcher />
            <ThemeToggle />

            <div ref={accountMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setAccountMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={accountMenuOpen}
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-2 py-1 text-left shadow-sm transition hover:border-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-700 dark:bg-slate-800 dark:hover:border-primary-500 dark:focus-visible:ring-offset-slate-900"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 ui-caption font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-100">
                  {accountInitial}
                </span>
                <span className="hidden min-w-0 sm:flex sm:max-w-48 sm:flex-col sm:items-start">
                  <span className="ui-caption uppercase tracking-wide text-slate-400 dark:text-slate-500">Compte</span>
                  <span className="w-full truncate ui-caption font-semibold text-slate-700 dark:text-slate-100">
                    {accountDisplay}
                  </span>
                </span>
                <ChevronDownIcon
                  className={`h-3.5 w-3.5 text-slate-500 transition-transform dark:text-slate-300 ${
                    accountMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {accountMenuOpen && (
                <div className="absolute right-0 top-[calc(100%+10px)] z-50 w-72 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                  <div className="mb-1 rounded-lg border border-slate-200/70 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/70">
                    <p className="ui-caption text-slate-500 dark:text-slate-400">Connecte en tant que</p>
                    <p className="truncate ui-caption font-semibold text-slate-800 dark:text-slate-100">{accountDisplay}</p>
                  </div>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={openProfileModal}
                    className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <UserIcon className="mt-0.5 h-4 w-4 text-slate-500 dark:text-slate-300" />
                    <span>
                      <span className="block ui-caption font-semibold text-slate-800 dark:text-slate-100">
                        Profil utilisateur
                      </span>
                      <span className="block ui-caption text-slate-500 dark:text-slate-400">
                        Identite, mot de passe, preferences
                      </span>
                    </span>
                  </button>

                  {canManagePrivateConnections && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={openConnectionsModal}
                      className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <LinkIcon className="mt-0.5 h-4 w-4 text-slate-500 dark:text-slate-300" />
                      <span>
                        <span className="block ui-caption font-semibold text-slate-800 dark:text-slate-100">
                          Connexions S3 privees
                        </span>
                        <span className="block ui-caption text-slate-500 dark:text-slate-400">
                          Gerer vos endpoints et credentials
                        </span>
                      </span>
                    </button>
                  )}

                  <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={triggerLogout}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left ui-caption font-semibold text-primary-700 transition hover:bg-primary-50 dark:text-primary-200 dark:hover:bg-primary-900/40"
                  >
                    <LogoutIcon className="h-4 w-4" />
                    <span>Deconnexion</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showProfileModal && (
        <Modal
          title="Profil utilisateur"
          onClose={() => setShowProfileModal(false)}
          maxWidthClass="max-w-6xl"
          maxBodyHeightClass="max-h-[85vh]"
          zIndexClass="z-[46]"
        >
          <ProfilePage showPageHeader={false} showSettingsCards showConnectionsSection={false} />
        </Modal>
      )}

      {showConnectionsModal && (
        <Modal
          title="Connexions S3 privees"
          onClose={() => setShowConnectionsModal(false)}
          maxWidthClass="max-w-7xl"
          maxBodyHeightClass="max-h-[85vh]"
          zIndexClass="z-[46]"
        >
          <ProfilePage showPageHeader={false} showSettingsCards={false} showConnectionsSection />
        </Modal>
      )}
    </>
  );
}

function CubeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m12 12 8-4.5M12 12 4 7.5M12 12v9" />
    </svg>
  );
}

function HamburgerIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeWidth={1.8} d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function ChevronDownIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="m5 7 5 6 5-6" />
    </svg>
  );
}

function UserIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <circle cx="12" cy="8" r="3.25" strokeWidth={1.5} />
      <path strokeLinecap="round" strokeWidth={1.5} d="M5 19a7 7 0 0 1 14 0" />
    </svg>
  );
}

function LinkIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 14a4 4 0 0 1 0-5.66L12.34 6a4 4 0 0 1 5.66 5.66L16.5 13.2" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14 10a4 4 0 0 1 0 5.66L11.66 18a4 4 0 0 1-5.66-5.66L7.5 10.8" />
    </svg>
  );
}

function LogoutIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 16.5 20 12l-5-4.5" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 12H9" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 19.5H6A2.5 2.5 0 0 1 3.5 17V7A2.5 2.5 0 0 1 6 4.5h6" />
    </svg>
  );
}
