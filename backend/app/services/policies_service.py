# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from app.db_models import S3Account
from app.models.policy import Policy
from app.services.rgw_iam import RGWIAMService, get_iam_service


class PoliciesService:
    def __init__(self, iam_service: RGWIAMService) -> None:
        self.iam = iam_service

    def list_policies(self) -> list[Policy]:
        return self.iam.list_policies()

    def get_policy(self, arn: str, include_document: bool = False) -> Optional[Policy]:
        return self.iam.get_policy(arn, include_document=include_document)

    def create_policy(self, name: str, document: dict) -> Policy:
        return self.iam.create_policy(name, document)

    def delete_policy(self, arn: str) -> None:
        self.iam.delete_policy(arn)


def get_policies_service(account: S3Account) -> PoliciesService:
    access_key, secret_key = account.effective_rgw_credentials()
    if not access_key or not secret_key:
        raise ValueError("S3Account root keys missing")
    iam_service = get_iam_service(access_key, secret_key)
    return PoliciesService(iam_service)
