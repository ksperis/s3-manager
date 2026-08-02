# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0


def test_manager_accounts_catalogue_route_removed(client):
    response = client.get("/api/manager/accounts")
    assert response.status_code == 404
