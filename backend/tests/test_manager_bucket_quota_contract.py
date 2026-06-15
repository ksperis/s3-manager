# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0


def test_manager_bucket_quota_update_route_is_not_exposed(client):
    response = client.put(
        "/api/manager/buckets/demo-bucket/quota",
        params={"account_id": 1},
        json={"max_size_gb": 1, "max_objects": 1000},
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}
