# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Managed private-access domain errors."""


class ManagedPrivateAccessError(RuntimeError):
    pass


class ManagedPrivateAccessConflict(ManagedPrivateAccessError):
    pass


class ManagedPrivateAccessForbidden(ManagedPrivateAccessError):
    pass


class ManagedPrivateAccessCleanupPending(ManagedPrivateAccessError):
    def __init__(self, provisioning_id: int, message: str) -> None:
        super().__init__(message)
        self.provisioning_id = provisioning_id
