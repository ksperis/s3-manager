# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from dataclasses import dataclass


@dataclass
class AccountCapabilities:
    can_manage_buckets: bool = False
    can_manage_portal_users: bool = False
    can_manage_iam: bool = False
    can_view_root_key: bool = False
    using_root_key: bool = False
