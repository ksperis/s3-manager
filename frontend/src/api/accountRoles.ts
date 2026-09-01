export type AccountAccessRole = "portal_user" | "portal_manager" | "account_administrator";

export const ACCOUNT_ACCESS_ROLE_OPTIONS: { value: AccountAccessRole; label: string }[] = [
  { value: "portal_user", label: "Portal user" },
  { value: "portal_manager", label: "Portal manager" },
  { value: "account_administrator", label: "Account administrator" },
];

export type AccountAccessRoleOption = (typeof ACCOUNT_ACCESS_ROLE_OPTIONS)[number] & {
  disabled?: boolean;
};

export function getAccountAccessRoleOptions(
  portalEnabled: boolean,
  currentRole?: AccountAccessRole,
): AccountAccessRoleOption[] {
  if (portalEnabled) {
    return ACCOUNT_ACCESS_ROLE_OPTIONS;
  }

  return ACCOUNT_ACCESS_ROLE_OPTIONS
    .filter(
      (option) =>
        option.value === "account_administrator" || option.value === currentRole,
    )
    .map((option) => ({
      ...option,
      disabled: option.value !== "account_administrator",
    }));
}

export function normalizeAccountAccessRole(value?: string | null): AccountAccessRole {
  if (value === "portal_user" || value === "portal_manager" || value === "account_administrator") {
    return value;
  }
  return "portal_user";
}
