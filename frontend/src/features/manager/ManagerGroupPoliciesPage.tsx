/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  attachGroupPolicy,
  deleteGroupInlinePolicy,
  detachGroupPolicy,
  listGroupInlinePolicies,
  listGroupPolicies,
  putGroupInlinePolicy,
} from "../../api/managerIamGroups";
import ManagerEntityPoliciesPage from "./ManagerEntityPoliciesPage";

export default function ManagerGroupPoliciesPage() {
  return (
    <ManagerEntityPoliciesPage
      entityType="group"
      routeParam="groupName"
      listPoliciesForEntity={listGroupPolicies}
      attachPolicyToEntity={attachGroupPolicy}
      detachPolicyFromEntity={detachGroupPolicy}
      listInlinePoliciesForEntity={listGroupInlinePolicies}
      putInlinePolicyForEntity={putGroupInlinePolicy}
      deleteInlinePolicyForEntity={deleteGroupInlinePolicy}
      extraActions={(entityName) => [
        {
          label: "Members",
          to: `/manager/groups/${encodeURIComponent(entityName)}/users`,
          variant: "ghost",
        },
      ]}
    />
  );
}
