# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter

from app.routers.ceph_admin import bucket_admin_ops, bucket_index_ops, identity_admin_ops

router = APIRouter(
    prefix="/ceph-admin/endpoints/{endpoint_id}",
    tags=["ceph-admin-admin-ops"],
)
router.include_router(identity_admin_ops.router)
router.include_router(bucket_admin_ops.router)
router.include_router(bucket_index_ops.router)
