type AdminPrincipalKind = "user" | "group";

type AdminPrincipalEditRequest = {
  id: number;
  search: string;
};

export function buildAdminPrincipalEditHref({
  id,
  kind,
  search,
}: {
  id: number | string;
  kind: AdminPrincipalKind;
  search: string;
}): string {
  const params = new URLSearchParams({
    edit: String(id),
    search,
  });
  return `/admin/${kind === "group" ? "groups" : "users"}?${params.toString()}`;
}

export function readAdminPrincipalEditRequest(locationSearch: string): AdminPrincipalEditRequest | null {
  const params = new URLSearchParams(locationSearch);
  const rawId = params.get("edit")?.trim() ?? "";
  if (!/^\d+$/.test(rawId)) return null;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return {
    id,
    search: params.get("search")?.trim() ?? "",
  };
}

export function clearAdminPrincipalEditRequest(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("edit")) return;
  url.searchParams.delete("edit");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}
