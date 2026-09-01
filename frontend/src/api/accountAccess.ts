export type ManagerAccountRole = "account_administrator";
export type PortalAccountRole = "portal_user" | "portal_manager";

export type AccountAccessGrant = {
  manager_role: ManagerAccountRole | null;
  portal_role: PortalAccountRole | null;
  allow_manager_browser_data_access?: boolean;
};

const ACCOUNT_ACCESS_REQUIRED_MESSAGE =
  "Choose at least one role for this association.";

const PORTAL_DISABLED_ACCOUNT_ACCESS_REQUIRED_MESSAGE =
  "Choose a Manager role; Portal is off.";

export function getAccountAccessRequiredMessage(portalEnabled: boolean): string {
  return portalEnabled
    ? ACCOUNT_ACCESS_REQUIRED_MESSAGE
    : PORTAL_DISABLED_ACCOUNT_ACCESS_REQUIRED_MESSAGE;
}

export const MANAGER_ACCOUNT_ROLE_OPTIONS: Array<{
  value: ManagerAccountRole | "";
  label: string;
}> = [
  { value: "", label: "No Manager access" },
  { value: "account_administrator", label: "Account administrator" },
];

export const PORTAL_ACCOUNT_ROLE_OPTIONS: Array<{
  value: PortalAccountRole | "";
  label: string;
}> = [
  { value: "", label: "No Portal access" },
  { value: "portal_user", label: "Portal user" },
  { value: "portal_manager", label: "Portal manager" },
];

export function parseManagerAccountRole(value: string): ManagerAccountRole | null {
  if (value === "") return null;
  if (value === "account_administrator") return value;
  throw new Error(`Invalid Manager account role: ${value}`);
}

export function parsePortalAccountRole(value: string): PortalAccountRole | null {
  if (value === "") return null;
  if (value === "portal_user" || value === "portal_manager") return value;
  throw new Error(`Invalid Portal account role: ${value}`);
}

export function hasAccountAccessRole(grant: AccountAccessGrant): boolean {
  return grant.manager_role !== null || grant.portal_role !== null;
}

export function defaultAccountAccessGrant(portalEnabled: boolean): AccountAccessGrant {
  return portalEnabled
    ? { manager_role: null, portal_role: "portal_user" }
    : { manager_role: "account_administrator", portal_role: null };
}
