/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  attachRolePolicy,
  deleteRoleInlinePolicy,
  detachRolePolicy,
  listRoleInlinePolicies,
  listRolePolicies,
  putRoleInlinePolicy,
} from "../../api/managerIamRoles";
import ManagerEntityPoliciesPage from "./ManagerEntityPoliciesPage";

export default function ManagerRolePoliciesPage() {
  return (
    <ManagerEntityPoliciesPage
      entityType="role"
      routeParam="roleName"
      listPoliciesForEntity={listRolePolicies}
      attachPolicyToEntity={attachRolePolicy}
      detachPolicyFromEntity={detachRolePolicy}
      listInlinePoliciesForEntity={listRoleInlinePolicies}
      putInlinePolicyForEntity={putRoleInlinePolicy}
      deleteInlinePolicyForEntity={deleteRoleInlinePolicy}
    />
  );
}
