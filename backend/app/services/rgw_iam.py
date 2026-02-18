# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from typing import List, Optional, Union

from app.models.iam import AccessKey, IAMGroup, IAMRole, IAMUser
from app.models.policy import Policy
from app.core.config import get_settings

settings = get_settings()


def get_iam_client(
    access_key: str,
    secret_key: str,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    verify_tls: bool = True,
):
    if not endpoint:
        raise RuntimeError("IAM endpoint is not configured")
    return boto3.client(
        "iam",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4"),
        region_name=region or settings.seed_s3_region,
        verify=verify_tls,
    )


class RGWIAMService:
    def __init__(
        self,
        access_key: str,
        secret_key: str,
        endpoint: Optional[str] = None,
        region: Optional[str] = None,
        verify_tls: bool = True,
    ) -> None:
        self.client = get_iam_client(access_key, secret_key, endpoint=endpoint, region=region, verify_tls=verify_tls)
        # Known Ceph-managed policies (subset supported by RGW IAM)
        self._default_policies: list[Policy] = [
            self._policy_from_data({"PolicyName": "AmazonS3FullAccess", "Arn": "arn:aws:iam::aws:policy/AmazonS3FullAccess"}),
            self._policy_from_data({"PolicyName": "AmazonS3ReadOnlyAccess", "Arn": "arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess"}),
            self._policy_from_data({"PolicyName": "IAMFullAccess", "Arn": "arn:aws:iam::aws:policy/IAMFullAccess"}),
            self._policy_from_data({"PolicyName": "IAMReadOnlyAccess", "Arn": "arn:aws:iam::aws:policy/IAMReadOnlyAccess"}),
        ]

    def _format_access_key(self, data: dict, include_secret: bool = False) -> AccessKey:
        created_at = data.get("CreateDate")
        created_str = None
        if created_at is not None:
            created_str = created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at)
        return AccessKey(
            access_key_id=data.get("AccessKeyId") or data.get("id") or data.get("access_key"),
            status=data.get("Status"),
            created_at=created_str,
            secret_access_key=data.get("SecretAccessKey") if include_secret else None,
        )

    # Users
    def list_users(self) -> List[IAMUser]:
        try:
            resp = self.client.list_users()
            users: List[IAMUser] = []
            for u in resp.get("Users", []):
                name = u.get("UserName")
                arn = u.get("Arn")
                user_id = u.get("UserId")
                if not name:
                    # Skip malformed entries that don't expose a username
                    continue
                user_groups = self.client.list_groups_for_user(UserName=name).get("Groups", [])
                group_names = [g.get("GroupName") for g in user_groups if g.get("GroupName")]
                attached = self.client.list_attached_user_policies(UserName=name).get("AttachedPolicies", [])
                policy_arns = [p.get("PolicyArn") for p in attached if p.get("PolicyArn")]
                inline_names = self.client.list_user_policies(UserName=name).get("PolicyNames", [])
                key_metadata = self.client.list_access_keys(UserName=name).get("AccessKeyMetadata", [])
                users.append(
                    IAMUser(
                        name=name,
                        user_id=user_id,
                        arn=arn,
                        groups=group_names,
                        policies=policy_arns,
                        inline_policies=inline_names or None,
                        has_keys=len(key_metadata) > 0,
                    )
                )
            return users
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to list IAM users: {exc}") from exc

    def create_user(
        self,
        name: str,
        create_key: bool = False,
        allow_existing: bool = False,
    ) -> tuple[IAMUser, Optional[AccessKey]]:
        try:
            resp = self.client.create_user(UserName=name)
            u = resp.get("User", {})
            new_key = self.create_access_key(name) if create_key else None
            return IAMUser(
                name=u.get("UserName") or name,
                user_id=u.get("UserId"),
                arn=u.get("Arn"),
            ), new_key
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code")
            if allow_existing and code in {"EntityAlreadyExists", "UserAlreadyExists"}:
                existing = self.get_user(name)
                if existing is not None:
                    return existing, None
            raise RuntimeError(f"Unable to create IAM user: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to create IAM user: {exc}") from exc

    def get_user(self, name: str) -> Optional[IAMUser]:
        try:
            resp = self.client.get_user(UserName=name)
            u = resp.get("User", {})
            if not u:
                return None
            return IAMUser(
                name=u.get("UserName") or name,
                user_id=u.get("UserId"),
                arn=u.get("Arn"),
            )
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"NoSuchEntity"}:
                return None
            raise RuntimeError(f"Unable to fetch IAM user: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to fetch IAM user: {exc}") from exc

    def delete_user(self, name: str) -> None:
        try:
            self.client.delete_user(UserName=name)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"NoSuchEntity"}:
                return
            raise RuntimeError(f"Unable to delete IAM user: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to delete IAM user: {exc}") from exc

    def list_access_keys(self, user_name: str) -> List[AccessKey]:
        try:
            resp = self.client.list_access_keys(UserName=user_name)
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to list IAM access keys: {exc}") from exc
        return [self._format_access_key(k) for k in resp.get("AccessKeyMetadata", [])]

    def create_access_key(self, user_name: str) -> AccessKey:
        try:
            resp = self.client.create_access_key(UserName=user_name)
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to create IAM access key: {exc}") from exc
        return self._format_access_key(resp.get("AccessKey", {}), include_secret=True)

    def delete_access_key(self, user_name: str, access_key_id: str) -> None:
        try:
            self.client.delete_access_key(UserName=user_name, AccessKeyId=access_key_id)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"NoSuchEntity"}:
                return
            raise RuntimeError(f"Unable to delete IAM access key: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to delete IAM access key: {exc}") from exc

    def update_access_key_status(self, user_name: str, access_key_id: str, status: str) -> None:
        try:
            self.client.update_access_key(UserName=user_name, AccessKeyId=access_key_id, Status=status)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"NoSuchEntity"}:
                raise RuntimeError("Access key not found") from exc
            raise RuntimeError(f"Unable to update IAM access key: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to update IAM access key: {exc}") from exc

    def list_user_policies(self, user_name: str) -> List[Policy]:
        try:
            resp = self.client.list_attached_user_policies(UserName=user_name)
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to list user policies: {exc}") from exc
        return [self._policy_from_data(p) for p in resp.get("AttachedPolicies", [])]

    def list_user_inline_policies(self, user_name: str) -> list[str]:
        try:
            resp = self.client.list_user_policies(UserName=user_name)
            return [p for p in resp.get("PolicyNames", []) if p]
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to list inline policies for user: {exc}") from exc

    def get_user_inline_policy(self, user_name: str, policy_name: str) -> Optional[dict]:
        try:
            resp = self.client.get_user_policy(UserName=user_name, PolicyName=policy_name)
            return self._normalize_policy_document(resp.get("PolicyDocument"))
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"NoSuchEntity"}:
                return None
            raise RuntimeError(f"Unable to fetch inline policy for user: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to fetch inline policy for user: {exc}") from exc

    def put_user_inline_policy(self, user_name: str, policy_name: str, policy_document: Union[dict, str]) -> None:
        try:
            document = policy_document if isinstance(policy_document, str) else json.dumps(policy_document)
            self.client.put_user_policy(UserName=user_name, PolicyName=policy_name, PolicyDocument=document)
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to put inline policy on user: {exc}") from exc

    def delete_user_inline_policy(self, user_name: str, policy_name: str) -> None:
        try:
            self.client.delete_user_policy(UserName=user_name, PolicyName=policy_name)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"NoSuchEntity"}:
                return
            raise RuntimeError(f"Unable to delete inline policy from user: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to delete inline policy from user: {exc}") from exc

    def attach_user_policy(self, user_name: str, policy_arn: str) -> None:
        try:
            self.client.attach_user_policy(UserName=user_name, PolicyArn=policy_arn)
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to attach policy to user: {exc}") from exc

    def detach_user_policy(self, user_name: str, policy_arn: str) -> None:
        try:
            self.client.detach_user_policy(UserName=user_name, PolicyArn=policy_arn)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"NoSuchEntity"}:
                return
            raise RuntimeError(f"Unable to detach policy from user: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to detach policy from user: {exc}") from exc

    def list_groups_for_user(self, user_name: str) -> List[IAMGroup]:
        try:
            resp = self.client.list_groups_for_user(UserName=user_name)
            return [
                IAMGroup(name=g.get("GroupName"), arn=g.get("Arn"))
                for g in resp.get("Groups", [])
                if g.get("GroupName")
            ]
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to list groups for user: {exc}") from exc

    # Groups
    def list_groups(self) -> List[IAMGroup]:
        try:
            resp = self.client.list_groups()
            groups: List[IAMGroup] = []
            for g in resp.get("Groups", []):
                name = g.get("GroupName")
                arn = g.get("Arn")
                attached = self.client.list_attached_group_policies(GroupName=name).get("AttachedPolicies", [])
                policy_arns = [p.get("PolicyArn") for p in attached if p.get("PolicyArn")]
                groups.append(IAMGroup(name=name, arn=arn, policies=policy_arns))
            return groups
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to list IAM groups: {exc}") from exc

    def create_group(self, name: str) -> IAMGroup:
        try:
            resp = self.client.create_group(GroupName=name)
            g = resp.get("Group", {})
            return IAMGroup(name=g.get("GroupName") or name, arn=g.get("Arn"))
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to create IAM group: {exc}") from exc

    def delete_group(self, name: str) -> None:
        try:
            self.client.delete_group(GroupName=name)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"NoSuchEntity"}:
                return
            raise RuntimeError(f"Unable to delete IAM group: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to delete IAM group: {exc}") from exc

    def list_group_users(self, group_name: str) -> List[IAMUser]:
        try:
            paginator = self.client.get_paginator("get_group")
            members: List[IAMUser] = []
            for page in paginator.paginate(GroupName=group_name):
                for u in page.get("Users", []):
                    members.append(IAMUser(name=u.get("UserName"), user_id=u.get("UserId"), arn=u.get("Arn")))
            return members
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to list IAM group members: {exc}") from exc

    def add_user_to_group(self, group_name: str, user_name: str) -> None:
        try:
            self.client.add_user_to_group(GroupName=group_name, UserName=user_name)
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to add user to group: {exc}") from exc

    def remove_user_from_group(self, group_name: str, user_name: str) -> None:
        try:
            self.client.remove_user_from_group(GroupName=group_name, UserName=user_name)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"NoSuchEntity"}:
                return
            raise RuntimeError(f"Unable to remove user from group: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to remove user from group: {exc}") from exc

    def list_group_policies(self, group_name: str) -> List[Policy]:
        try:
            resp = self.client.list_attached_group_policies(GroupName=group_name)
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to list group policies: {exc}") from exc
        return [self._policy_from_data(p) for p in resp.get("AttachedPolicies", [])]

    def list_group_inline_policies(self, group_name: str) -> list[str]:
        try:
            resp = self.client.list_group_policies(GroupName=group_name)
            return [p for p in resp.get("PolicyNames", []) if p]
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to list inline policies for group: {exc}") from exc

    def get_group_inline_policy(self, group_name: str, policy_name: str) -> Optional[dict]:
        try:
            resp = self.client.get_group_policy(GroupName=group_name, PolicyName=policy_name)
            return self._normalize_policy_document(resp.get("PolicyDocument"))
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"NoSuchEntity"}:
                return None
            raise RuntimeError(f"Unable to fetch inline policy for group: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to fetch inline policy for group: {exc}") from exc

    def put_group_inline_policy(self, group_name: str, policy_name: str, policy_document: Union[dict, str]) -> None:
        try:
            document = policy_document if isinstance(policy_document, str) else json.dumps(policy_document)
            self.client.put_group_policy(GroupName=group_name, PolicyName=policy_name, PolicyDocument=document)
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to put inline policy on group: {exc}") from exc

    def delete_group_inline_policy(self, group_name: str, policy_name: str) -> None:
        try:
            self.client.delete_group_policy(GroupName=group_name, PolicyName=policy_name)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"NoSuchEntity"}:
                return
            raise RuntimeError(f"Unable to delete inline policy from group: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to delete inline policy from group: {exc}") from exc

    def attach_group_policy(self, group_name: str, policy_arn: str) -> None:
        try:
            self.client.attach_group_policy(GroupName=group_name, PolicyArn=policy_arn)
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to attach policy to group: {exc}") from exc

    def detach_group_policy(self, group_name: str, policy_arn: str) -> None:
        try:
            self.client.detach_group_policy(GroupName=group_name, PolicyArn=policy_arn)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"NoSuchEntity"}:
                return
            raise RuntimeError(f"Unable to detach policy from group: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to detach policy from group: {exc}") from exc

    # Roles
    def list_roles(self) -> List[IAMRole]:
        try:
            resp = self.client.list_roles()
            roles: List[IAMRole] = []
            for r in resp.get("Roles", []):
                name = r.get("RoleName")
                arn = r.get("Arn")
                attached = self.client.list_attached_role_policies(RoleName=name).get("AttachedPolicies", [])
                policy_arns = [p.get("PolicyArn") for p in attached if p.get("PolicyArn")]
                roles.append(IAMRole(name=name, arn=arn, path=r.get("Path"), policies=policy_arns))
            return roles
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to list IAM roles: {exc}") from exc

    def create_role(self, name: str, assume_role_policy: Union[dict, str], path: Optional[str] = None) -> IAMRole:
        try:
            document = json.dumps(assume_role_policy) if isinstance(assume_role_policy, dict) else assume_role_policy
            kwargs: dict = {"RoleName": name, "AssumeRolePolicyDocument": document}
            if path:
                kwargs["Path"] = path
            resp = self.client.create_role(**kwargs)
            r = resp.get("Role", {})
            return IAMRole(name=r.get("RoleName") or name, arn=r.get("Arn"), path=r.get("Path"))
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to create IAM role: {exc}") from exc

    def get_role(self, name: str) -> Optional[IAMRole]:
        try:
            resp = self.client.get_role(RoleName=name)
            data = resp.get("Role", {}) or {}
            attached = self.client.list_attached_role_policies(RoleName=name).get("AttachedPolicies", [])
            policy_arns = [p.get("PolicyArn") for p in attached if p.get("PolicyArn")]
            assume_doc = self._normalize_policy_document(data.get("AssumeRolePolicyDocument"))
            return IAMRole(
                name=data.get("RoleName") or name,
                arn=data.get("Arn"),
                path=data.get("Path"),
                policies=policy_arns,
                assume_role_policy_document=assume_doc,
            )
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"NoSuchEntity"}:
                return None
            raise RuntimeError(f"Unable to fetch IAM role: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to fetch IAM role: {exc}") from exc

    def delete_role(self, name: str) -> None:
        try:
            self.client.delete_role(RoleName=name)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"NoSuchEntity"}:
                return
            raise RuntimeError(f"Unable to delete IAM role: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to delete IAM role: {exc}") from exc

    def update_role_assume_policy(self, role_name: str, assume_role_policy: Union[dict, str]) -> None:
        try:
            document = json.dumps(assume_role_policy) if isinstance(assume_role_policy, dict) else assume_role_policy
            self.client.update_assume_role_policy(RoleName=role_name, PolicyDocument=document)
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to update role trust policy: {exc}") from exc

    # Policies
    def _policy_from_data(self, data: dict, document: Optional[dict] = None) -> Policy:
        return Policy(
            name=data.get("PolicyName") or data.get("name"),
            arn=data.get("Arn") or data.get("PolicyArn") or data.get("arn"),
            path=data.get("Path"),
            default_version_id=data.get("DefaultVersionId"),
            document=document,
        )

    def list_policies(self) -> List[Policy]:
        try:
            resp = self.client.list_policies(Scope="Local")
            return [self._policy_from_data(p) for p in resp.get("Policies", [])]
        except (BotoCoreError, ClientError):
            # Ceph RGW Squid/Quincy may not implement ListPolicies; fall back to known managed set
            return self._default_policies.copy()

    def get_policy(self, policy_arn: str, include_document: bool = False) -> Optional[Policy]:
        try:
            resp = self.client.get_policy(PolicyArn=policy_arn)
            policy_data = resp.get("Policy", {}) or {}
            document = None
            if include_document and policy_data.get("DefaultVersionId"):
                try:
                    version_resp = self.client.get_policy_version(
                        PolicyArn=policy_arn, VersionId=policy_data["DefaultVersionId"]
                    )
                    document = version_resp.get("PolicyVersion", {}).get("Document")
                except (BotoCoreError, ClientError):
                    document = None
            return self._policy_from_data(policy_data, document=document)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"NoSuchEntity"}:
                # Try to resolve from the static set
                return next((p for p in self._default_policies if p.arn == policy_arn), None)
            # Unsupported endpoint — fall back to static if available
            if exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") == 405:
                return next((p for p in self._default_policies if p.arn == policy_arn), None)
            raise RuntimeError(f"Unable to fetch IAM policy: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to fetch IAM policy: {exc}") from exc

    def create_policy(self, name: str, document: dict) -> Policy:
        try:
            resp = self.client.create_policy(PolicyName=name, PolicyDocument=json.dumps(document))
        except ClientError as exc:
            err = exc.response.get("Error", {}) if hasattr(exc, "response") else {}
            status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") if hasattr(exc, "response") else None
            if status == 405 or err.get("Code") in {"NotImplemented", "MethodNotAllowed"}:
                raise ValueError("IAM CreatePolicy is not supported by this endpoint") from exc
            raise RuntimeError(f"Unable to create IAM policy: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to create IAM policy: {exc}") from exc
        return self._policy_from_data(resp.get("Policy", {}), document=document)

    def delete_policy(self, policy_arn: str) -> None:
        try:
            self.client.delete_policy(PolicyArn=policy_arn)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"NoSuchEntity"}:
                return
            raise RuntimeError(f"Unable to delete IAM policy: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to delete IAM policy: {exc}") from exc

    def list_role_policies(self, role_name: str) -> List[Policy]:
        try:
            resp = self.client.list_attached_role_policies(RoleName=role_name)
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to list role policies: {exc}") from exc
        return [self._policy_from_data(p) for p in resp.get("AttachedPolicies", [])]

    def list_role_inline_policies(self, role_name: str) -> list[str]:
        try:
            resp = self.client.list_role_policies(RoleName=role_name)
            return [p for p in resp.get("PolicyNames", []) if p]
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to list inline policies for role: {exc}") from exc

    def get_role_inline_policy(self, role_name: str, policy_name: str) -> Optional[dict]:
        try:
            resp = self.client.get_role_policy(RoleName=role_name, PolicyName=policy_name)
            return self._normalize_policy_document(resp.get("PolicyDocument"))
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"NoSuchEntity"}:
                return None
            raise RuntimeError(f"Unable to fetch inline policy for role: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to fetch inline policy for role: {exc}") from exc

    def put_role_inline_policy(self, role_name: str, policy_name: str, policy_document: Union[dict, str]) -> None:
        try:
            document = policy_document if isinstance(policy_document, str) else json.dumps(policy_document)
            self.client.put_role_policy(RoleName=role_name, PolicyName=policy_name, PolicyDocument=document)
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to put inline policy on role: {exc}") from exc

    def delete_role_inline_policy(self, role_name: str, policy_name: str) -> None:
        try:
            self.client.delete_role_policy(RoleName=role_name, PolicyName=policy_name)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"NoSuchEntity"}:
                return
            raise RuntimeError(f"Unable to delete inline policy from role: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to delete inline policy from role: {exc}") from exc

    def attach_role_policy(self, role_name: str, policy_arn: str) -> None:
        try:
            self.client.attach_role_policy(RoleName=role_name, PolicyArn=policy_arn)
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to attach policy to role: {exc}") from exc

    def detach_role_policy(self, role_name: str, policy_arn: str) -> None:
        try:
            self.client.detach_role_policy(RoleName=role_name, PolicyArn=policy_arn)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"NoSuchEntity"}:
                return
            raise RuntimeError(f"Unable to detach policy from role: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to detach policy from role: {exc}") from exc

    def _normalize_policy_document(self, document: Optional[Union[str, dict]]) -> Optional[dict]:
        if document is None:
            return None
        if isinstance(document, dict):
            return document
        try:
            return json.loads(document)
        except (TypeError, json.JSONDecodeError):
            return None


def get_iam_service(
    access_key: str,
    secret_key: str,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    verify_tls: bool = True,
) -> RGWIAMService:
    return RGWIAMService(access_key, secret_key, endpoint=endpoint, region=region, verify_tls=verify_tls)
