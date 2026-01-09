# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import argparse
import logging
import random
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from app.core.config import get_settings
from app.core.database import SessionLocal, engine
from app.core.db_init import init_db
from app.db import S3Account, User, UserRole
from app.models.s3_account import S3AccountCreate, S3AccountUpdate
from app.models.user import UserCreate
from app.services.buckets_service import BucketsService
from app.services.objects_service import ObjectsService
from app.services.s3_accounts_service import get_s3_accounts_service
from app.services.users_service import UsersService
from app.services.rgw_admin import get_rgw_admin_client
from app.services.rgw_iam import get_iam_service
from app.services import s3_client
from app.models.iam import AccessKey as IAMAccessKey
from app.utils.s3_endpoint import configured_s3_endpoint, resolve_s3_endpoint

try:
    import yaml
except ImportError:
    yaml = None

logger = logging.getLogger("seed_demo_data")


ACCOUNT_PREFIXES: tuple[str, ...] = (
    "Aurora",
    "Northwind",
    "Harbor",
    "Summit",
    "Evergreen",
    "Lighthouse",
    "Vertex",
    "Atlas",
    "Nimbus",
    "Pioneer",
    "Frontier",
    "Copper",
    "Cobalt",
    "Helios",
    "Orion",
    "Delta",
    "Sterling",
    "Granite",
    "Anchor",
)
ACCOUNT_SUFFIXES: tuple[str, ...] = (
    "Analytics",
    "Retail",
    "Studios",
    "Systems",
    "Logistics",
    "Partners",
    "Holdings",
    "Ventures",
    "Labs",
    "Operations",
    "Platform",
    "Group",
    "Advisors",
    "Collective",
)
DEPARTMENTS: tuple[str, ...] = (
    "data",
    "platform",
    "security",
    "finance",
    "media",
    "supply",
    "ops",
    "eng",
    "product",
    "people",
    "analytics",
)
BUCKET_THEMES: tuple[str, ...] = (
    "logs",
    "backups",
    "raw-data",
    "curated",
    "etl-stage",
    "artifacts",
    "archive",
    "reports",
    "cdn-assets",
    "metrics",
    "exports",
    "compliance",
    "contracts",
    "media",
    "ml-features",
    "warehouse",
    "iot-events",
    "billing",
)
DEFAULT_IAM_BUCKET_POLICY = "arn:aws:iam::aws:policy/AmazonS3FullAccess"
SERVICES: tuple[str, ...] = (
    "accounts",
    "billing",
    "cdn",
    "checkout",
    "data-pipeline",
    "events",
    "forecast",
    "fulfillment",
    "inventory",
    "mobile",
    "platform",
    "search",
    "support",
    "warehouse",
)
FIRST_NAMES: tuple[str, ...] = (
    "Alice",
    "Benoit",
    "Camille",
    "David",
    "Emma",
    "Farid",
    "Gabriel",
    "Helene",
    "Ines",
    "Julien",
    "Lea",
    "Martin",
    "Nora",
    "Olivier",
    "Pierre",
    "Quentin",
    "Romy",
    "Sophie",
    "Theo",
    "Valentin",
)
LAST_NAMES: tuple[str, ...] = (
    "Martin",
    "Bernard",
    "Dubois",
    "Thomas",
    "Robert",
    "Richard",
    "Petit",
    "Durand",
    "Leroy",
    "Moreau",
    "Simon",
    "Laurent",
    "Garcia",
    "Roux",
    "Morin",
    "Fournier",
    "Guerin",
    "Henry",
    "Lopez",
    "Fontaine",
)


@dataclass
class BucketPlan:
    name: str
    object_count: int
    iam_user: Optional[str] = None


@dataclass
class UserPlan:
    email: str
    full_name: str
    password: str


@dataclass
class AccountPlan:
    name: str
    email: str
    quota_gb: Optional[int]
    buckets: list[BucketPlan]
    users: list[UserPlan]
    iam_user: Optional[str] = None


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9-]+", "-", text.lower()).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)
    return slug or "demo"


def load_yaml_config(path: Optional[Path]) -> Optional[dict]:
    if not path:
        return None
    if not path.exists():
        raise FileNotFoundError(f"Config file not found: {path}")
    if yaml is None:
        raise RuntimeError("PyYAML is required to load YAML configs. Install with `pip install pyyaml`.")
    with path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
        if not isinstance(data, dict):
            raise ValueError("YAML root must be a mapping/object.")
        return data


def pick_unique_name(existing: set[str]) -> str:
    for _ in range(50):
        name = f"{random.choice(ACCOUNT_PREFIXES)}-{random.choice(ACCOUNT_SUFFIXES)}"
        if name not in existing:
            return name
    return f"Demo Account {len(existing) + 1}"


def random_email(account_slug: str, local_hint: Optional[str] = None) -> str:
    local = local_hint or random.choice(DEPARTMENTS)
    return f"{local}.{account_slug}@example.com"


def random_full_name() -> str:
    return f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"


def generate_bucket_name(account_slug: str, used: set[str]) -> str:
    for _ in range(30):
        base = f"{account_slug}-{random.choice(BUCKET_THEMES)}"
        candidate = base[:55]
        if candidate in used:
            candidate = f"{candidate}-{random.randint(1, 999)}"
        candidate = candidate[:63].rstrip("-")
        if candidate not in used:
            return candidate
    fallback = f"{account_slug}-data-{len(used) + 1}"
    return fallback[:63]


def generate_object_key(bucket_name: str, idx: int) -> tuple[str, str]:
    year = random.choice((2023, 2024))
    month = random.randint(1, 12)
    day = random.randint(1, 28)
    quarter = (month - 1) // 3 + 1
    service = random.choice(SERVICES)
    patterns = (
        ("logs/{svc}/{year}/{month:02d}/{day:02d}.log", "text/plain"),
        ("reports/{year}/q{quarter}/{svc}-summary.pdf", "application/pdf"),
        ("exports/{svc}/{year}{month:02d}{day:02d}-customers.csv", "text/csv"),
        ("media/{svc}/hero-{idx:03d}.jpg", "image/jpeg"),
        ("backups/{svc}/{year}-{month:02d}-{day:02d}.sql.gz", "application/gzip"),
        ("warehouse/{svc}/partition={year}-{month:02d}-{day:02d}/part-{idx:05d}.parquet", "application/octet-stream"),
        ("iot/{svc}/{year}/{month:02d}/{day:02d}/event-{idx:06d}.json", "application/json"),
    )
    pattern, content_type = random.choice(patterns)
    key = pattern.format(
        svc=service,
        year=year,
        month=month,
        day=day,
        quarter=quarter,
        idx=idx,
    )
    return key, content_type


def build_object_body(bucket: str, key: str) -> bytes:
    sentence = (
        f"Demo payload for {bucket}/{key}. "
        f"Generated by seed_demo_data to populate the UI. "
        f"This is synthetic content only.\n"
    )
    target = random.randint(600, 2400)
    repeat = max(1, target // len(sentence))
    return (sentence * repeat).encode("utf-8")


def bucket_plans_for_account(
    account_slug: str,
    bucket_count: int,
    min_objects: int,
    max_objects: int,
    iam_user: Optional[str],
) -> list[BucketPlan]:
    used_names: set[str] = set()
    plans: list[BucketPlan] = []
    for _ in range(bucket_count):
        name = generate_bucket_name(account_slug, used_names)
        used_names.add(name)
        object_count = random.randint(min_objects, max_objects)
        plans.append(BucketPlan(name=name, object_count=object_count, iam_user=iam_user))
    return plans


def user_plans_for_account(
    account_slug: str,
    desired: int,
    password: str,
) -> list[UserPlan]:
    plans: list[UserPlan] = []
    for _ in range(desired):
        full_name = random_full_name()
        email_local = slugify(full_name.replace(" ", "."))
        email = f"{email_local}@{account_slug}.example.com"
        plans.append(UserPlan(email=email, full_name=full_name, password=password))
    return plans


def plans_from_config(
    config: dict,
    defaults: argparse.Namespace,
    existing_names: set[str],
) -> list[AccountPlan]:
    accounts_data = config.get("accounts")
    if not accounts_data:
        return []
    plans: list[AccountPlan] = []
    for entry in accounts_data:
        if not isinstance(entry, dict):
            continue
        name = entry.get("name") or pick_unique_name(existing_names)
        name = name.replace(" ", "-")
        account_slug = slugify(name)
        email = entry.get("email") or random_email(account_slug)
        quota_gb = entry.get("quota_gb", defaults.quota_gb)
        buckets_cfg = entry.get("buckets") or []
        users_cfg = entry.get("users") or []
        buckets: list[BucketPlan] = []
        used_bucket_names: set[str] = set()
        if buckets_cfg:
            for b in buckets_cfg:
                if not isinstance(b, dict):
                    continue
                bucket_name = b.get("name") or generate_bucket_name(account_slug, used_bucket_names)
                bucket_name = slugify(bucket_name)
                object_count = int(b.get("object_count") or b.get("objects") or random.randint(defaults.min_objects, defaults.max_objects))
                buckets.append(BucketPlan(name=bucket_name, object_count=object_count, iam_user=entry.get("iam_user")))
                used_bucket_names.add(bucket_name)
        else:
            bucket_count = int(entry.get("bucket_count") or random.randint(defaults.min_buckets, defaults.max_buckets))
            iam_user = entry.get("iam_user")
            buckets = bucket_plans_for_account(account_slug, bucket_count, defaults.min_objects, defaults.max_objects, iam_user)
        users: list[UserPlan] = []
        if users_cfg:
            for u in users_cfg:
                if not isinstance(u, dict):
                    continue
                full_name = u.get("full_name") or u.get("name") or random_full_name()
                email_value = u.get("email") or random_email(account_slug, slugify(full_name).replace("-", "."))
                password = u.get("password") or defaults.password
                users.append(UserPlan(email=email_value, full_name=full_name, password=password))
        else:
            users = user_plans_for_account(account_slug, defaults.users_per_account, defaults.password)
        plans.append(
            AccountPlan(
                name=name,
                email=email,
                quota_gb=quota_gb,
                buckets=buckets,
                users=users,
                iam_user=entry.get("iam_user"),
            )
        )
        existing_names.add(name)
    return plans


def build_account_plans(args: argparse.Namespace, config: Optional[dict]) -> list[AccountPlan]:
    existing_names: set[str] = set()
    plans: list[AccountPlan] = []
    if config:
        plans.extend(plans_from_config(config, args, existing_names))
    while len(plans) < args.accounts:
        name = pick_unique_name(existing_names)
        name = name.replace(" ", "-")
        account_slug = slugify(name)
        email = random_email(account_slug)
        quota_gb = args.quota_gb if random.random() < args.quota_ratio else None
        bucket_count = random.randint(args.min_buckets, args.max_buckets)
        buckets = bucket_plans_for_account(account_slug, bucket_count, args.min_objects, args.max_objects, iam_user=None)
        users = user_plans_for_account(account_slug, args.users_per_account, args.password)
        plans.append(
            AccountPlan(
                name=name,
                email=email,
                quota_gb=quota_gb,
                buckets=buckets,
                users=users,
                iam_user=None,
            )
        )
        existing_names.add(name)
    return plans[: args.accounts]


def ensure_account(
    accounts_service,
    name: str,
    email: str,
    quota_gb: Optional[int],
) -> S3Account:
    db = accounts_service.db
    existing = db.query(S3Account).filter(S3Account.name == name).first()
    if existing:
        if quota_gb is not None:
            try:
                accounts_service.update_account(
                    existing.id,
                    S3AccountUpdate(
                        quota_max_size_gb=quota_gb,
                        quota_max_objects=None,
                    ),
                )
            except Exception as exc:
                logger.debug("Unable to update quota for %s: %s", existing.name, exc)
        return existing
    payload = S3AccountCreate(
        name=name,
        email=email,
        quota_max_size_gb=quota_gb,
        quota_max_objects=None,
    )
    created = accounts_service.create_account_with_manager(payload)
    account = None
    if created.db_id:
        account = db.query(S3Account).filter(S3Account.id == created.db_id).first()
    if account is None:
        account = db.query(S3Account).filter(S3Account.name == name).first()
    if account is None:
        raise RuntimeError(f"Failed to create or load account {name}")
    return account


def ensure_iam_user_with_key(account: S3Account, iam_username: str) -> IAMAccessKey:
    access_key, secret_key = account.effective_rgw_credentials()
    if not access_key or not secret_key:
        raise RuntimeError(f"Missing root keys for account {account.name}")
    endpoint = resolve_s3_endpoint(account)
    if not endpoint:
        raise RuntimeError(f"No endpoint configured for account {account.name}")
    iam_service = get_iam_service(access_key, secret_key, endpoint=endpoint)
    key: Optional[IAMAccessKey] = None
    try:
        _, key = iam_service.create_user(iam_username, create_key=True)
    except RuntimeError as exc:
        logger.warning("Unable to create IAM user %s in %s (may exist): %s", iam_username, account.name, exc)
        try:
            keys = iam_service.list_access_keys(iam_username)
            key = keys[0] if keys else None
        except RuntimeError as list_exc:
            logger.debug("Unable to list keys for %s: %s", iam_username, list_exc)
    if key is None:
        key = iam_service.create_access_key(iam_username)
    # Attach broad S3 access to mirror UI bucket actions
    try:
        iam_service.attach_user_policy(iam_username, DEFAULT_IAM_BUCKET_POLICY)
    except RuntimeError as exc:
        logger.warning("Unable to attach policy %s to %s: %s", DEFAULT_IAM_BUCKET_POLICY, iam_username, exc)
    if not key.access_key_id or not key.secret_access_key:
        raise RuntimeError(f"Access key for {iam_username} missing secrets")
    return key


def create_account_data(
    accounts_service,
    buckets_service: BucketsService,
    objects_service: ObjectsService,
    users_service: UsersService,
    plan: AccountPlan,
) -> None:
    account = ensure_account(accounts_service, plan.name, plan.email, plan.quota_gb)
    if not account:
        logger.error("Unable to load account %s after creation", plan.name)
        return
    endpoint = resolve_s3_endpoint(account)
    if not endpoint:
        logger.error("No endpoint configured for account %s", plan.name)
        return
    logger.info("Account ready: %s (rgw_id=%s)", account.name, account.rgw_account_id or account.id)
    iam_keys: dict[str, IAMAccessKey] = {}

    def _client_for(user_name: str):
        key = iam_keys.get(user_name)
        if key is None:
            try:
                key = ensure_iam_user_with_key(account, user_name)
                iam_keys[user_name] = key
                logger.info("  IAM user ready: %s", user_name)
            except Exception as exc:
                logger.warning("  unable to provision IAM user %s: %s", user_name, exc)
                iam_keys[user_name] = None  # type: ignore
                return None, None
        if not key or not key.access_key_id or not key.secret_access_key:
            return None, None
        return key, s3_client.get_s3_client(key.access_key_id, key.secret_access_key, endpoint=endpoint)

    for bucket_plan in plan.buckets:
        iam_user_name = bucket_plan.iam_user or plan.iam_user or f"{slugify(plan.name)}-svc"
        iam_key, bucket_client = _client_for(iam_user_name)
        bucket_ready = True
        try:
            if bucket_client and iam_key:
                s3_client.create_bucket(
                    bucket_plan.name,
                    access_key=iam_key.access_key_id,
                    secret_key=iam_key.secret_access_key,
                    endpoint=endpoint,
                )
            else:
                buckets_service.create_bucket(bucket_plan.name, account)
            logger.info("  created bucket %s", bucket_plan.name)
        except Exception as exc:
            bucket_ready = False
            logger.warning("  bucket %s not created (may already exist): %s", bucket_plan.name, exc)
        for idx in range(bucket_plan.object_count):
            key, content_type = generate_object_key(bucket_plan.name, idx)
            body = build_object_body(bucket_plan.name, key)
            try:
                if bucket_client:
                    bucket_client.put_object(Bucket=bucket_plan.name, Key=key, Body=body, ContentType=content_type)
                else:
                    objects_service.upload_object(
                        bucket_plan.name,
                        account,
                        key,
                        file_obj=body,
                        content_type=content_type,
                    )
            except Exception as exc:
                if bucket_ready:
                    logger.debug("    failed object %s/%s: %s", bucket_plan.name, key, exc)
                else:
                    logger.debug(
                        "    unable to populate %s/%s (bucket missing or inaccessible): %s",
                        bucket_plan.name,
                        key,
                        exc,
                    )
                continue
    for user_plan in plan.users:
        existing_user = users_service.get_by_email(user_plan.email)
        if existing_user:
            user = existing_user
        else:
            try:
                user = users_service.create_user(
                    UserCreate(
                        email=user_plan.email,
                        password=user_plan.password,
                        full_name=user_plan.full_name,
                    )
                )
            except Exception as exc:
                logger.warning("  unable to create user %s: %s", user_plan.email, exc)
                continue
        try:
            users_service.assign_user_to_account(user.id, account.id)
        except Exception as exc:
            logger.warning("  unable to link user %s to %s: %s", user_plan.email, account.name, exc)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed the dev environment with demo accounts/buckets/objects.")
    parser.add_argument("--config", type=Path, help="Optional YAML file describing accounts/buckets/users to create.")
    parser.add_argument("--accounts", type=int, default=30, help="Total number of accounts to create (including config entries).")
    parser.add_argument("--min-buckets", type=int, default=10, help="Minimum buckets per account when auto-generating.")
    parser.add_argument("--max-buckets", type=int, default=20, help="Maximum buckets per account when auto-generating.")
    parser.add_argument("--min-objects", type=int, default=5, help="Minimum objects per bucket when auto-generating.")
    parser.add_argument("--max-objects", type=int, default=15, help="Maximum objects per bucket when auto-generating.")
    parser.add_argument("--users-per-account", type=int, default=2, help="Number of account-admin users to generate per account.")
    parser.add_argument("--password", default="ChangeMe123!", help="Password used for generated account-admin users.")
    parser.add_argument("--quota-gb", type=int, default=1, help="Quota in GB to apply to most generated accounts.")
    parser.add_argument(
        "--quota-ratio",
        type=float,
        default=0.85,
        help="Probability (0-1) that an auto-generated account receives a quota.",
    )
    parser.add_argument("--seed", type=int, default=None, help="Optional RNG seed for reproducible data.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.min_buckets > args.max_buckets:
        raise SystemExit("min-buckets cannot exceed max-buckets")
    if args.min_objects > args.max_objects:
        raise SystemExit("min-objects cannot exceed max-objects")
    if args.quota_ratio < 0 or args.quota_ratio > 1:
        logger.warning("quota-ratio should be between 0 and 1; clamping.")
        args.quota_ratio = max(0.0, min(1.0, args.quota_ratio))
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s %(message)s",
    )
    if args.seed is not None:
        random.seed(args.seed)
    config = load_yaml_config(args.config)
    settings = get_settings()
    endpoint = configured_s3_endpoint()
    if not endpoint:
        raise SystemExit("S3_ENDPOINT is required to seed demo data.")
    logger.info(
        "Using endpoint %s with database %s",
        endpoint,
        settings.database_url,
    )
    init_db(engine, SessionLocal)
    db = SessionLocal()
    try:
        # Prefer stored super-admin RGW credentials (like the UI) when available
        admin_user = (
            db.query(User)
            .filter(
                User.role == UserRole.UI_ADMIN.value,
                User.rgw_access_key.isnot(None),
                User.rgw_secret_key.isnot(None),
            )
            .first()
        )
        admin_client = None
        if admin_user and admin_user.rgw_access_key and admin_user.rgw_secret_key:
            admin_client = get_rgw_admin_client(
                access_key=admin_user.rgw_access_key,
                secret_key=admin_user.rgw_secret_key,
                endpoint=endpoint,
            )
            logger.info("Using RGW admin credentials from ui-admin %s", admin_user.email)
        accounts_service = get_s3_accounts_service(db, rgw_admin_client=admin_client)
        buckets_service = BucketsService()
        objects_service = ObjectsService()
        users_service = UsersService(db)
        plans = build_account_plans(args, config)
        logger.info("Planned %s accounts (%s from YAML).", len(plans), len(config.get('accounts', [])) if config else 0)
        for plan in plans:
            create_account_data(
                accounts_service,
                buckets_service,
                objects_service,
                users_service,
                plan,
            )
    finally:
        db.close()


if __name__ == "__main__":
    main()
DEFAULT_IAM_BUCKET_POLICY = "arn:aws:iam::aws:policy/AmazonS3FullAccess"
