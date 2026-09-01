# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.main import app


def test_admin_automation_openapi_exposes_only_batch_apply_route():
    automation_paths = {
        path for path in app.openapi()["paths"] if path.startswith("/api/admin/automation/")
    }

    assert automation_paths == {"/api/admin/automation/apply"}
