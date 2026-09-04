/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Navigate, useLocation, useParams } from "react-router-dom";

import {
  decodePortalObjectPath,
  decodePortalRouteValue,
  storageSpacePath,
} from "./portalWorkspaceModel";

export default function PortalObjectDetailRedirect() {
  const location = useLocation();
  const params = useParams();
  const spaceId = decodePortalRouteValue(params.spaceId);
  const objectKey = decodePortalObjectPath(params["*"]);
  const search = new URLSearchParams(location.search);
  const legacyTab = search.get("tab");
  const deleted = search.get("deleted") === "1";

  search.delete("tab");
  search.delete("deleted");
  search.set("object", objectKey);
  search.set(
    "object_view",
    deleted || legacyTab === "history"
      ? "history"
      : legacyTab === "sharing"
        ? "sharing"
        : legacyTab === "properties" || legacyTab === "details"
          ? "details"
          : "preview",
  );
  if (deleted) {
    search.set("object_deleted", "1");
    search.set("show_deleted", "1");
  } else {
    search.delete("object_deleted");
  }

  return (
    <Navigate
      replace
      to={`${storageSpacePath({ id: spaceId })}?${search.toString()}`}
    />
  );
}
