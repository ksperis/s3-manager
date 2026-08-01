export type AccountAccessRole = "portal_user" | "portal_manager" | "account_administrator";

export const ACCOUNT_ACCESS_ROLE_OPTIONS: { value: AccountAccessRole; label: string }[] = [
  { value: "portal_user", label: "Portal user" },
  { value: "portal_manager", label: "Portal manager" },
  { value: "account_administrator", label: "Account administrator" },
];
