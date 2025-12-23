# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends
from app.models.user import UserOut
from app.routers.dependencies import get_current_user
from app.services.users_service import UsersService, get_users_service
from app.core.database import get_db

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserOut)
def read_users_me(
    current_user=Depends(get_current_user),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
) -> UserOut:
    return users_service.user_to_out(current_user)
