from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import secrets
from datetime import UTC, datetime

import jwt
from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.models import ApiToken
from app.db.session import get_session
from app.schemas import CurrentUser

logger = logging.getLogger(__name__)
bearer_scheme = HTTPBearer(auto_error=False)


def _unauthorized(message: str = "Authentication required") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=message,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _roles_from_claims(claims: dict[str, object], audience: str) -> set[str]:
    roles: set[str] = set()
    realm_access = claims.get("realm_access")
    if isinstance(realm_access, dict) and isinstance(realm_access.get("roles"), list):
        roles.update(str(role) for role in realm_access["roles"])
    resource_access = claims.get("resource_access")
    if isinstance(resource_access, dict):
        audience_access = resource_access.get(audience)
        if isinstance(audience_access, dict) and isinstance(audience_access.get("roles"), list):
            roles.update(str(role) for role in audience_access["roles"])
    return roles


def _decode_oidc_token(token: str, settings: Settings) -> dict[str, object]:
    if not settings.oidc_issuer_url:
        raise _unauthorized("OIDC is not configured")
    jwks_url = f"{settings.oidc_issuer_url.rstrip('/')}/protocol/openid-connect/certs"
    signing_key = PyJWKClient(jwks_url, cache_keys=True).get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=settings.oidc_algorithms,
        audience=settings.oidc_audience,
        issuer=settings.oidc_issuer_url,
        options={"require": ["exp", "iat", "sub"]},
    )


async def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    x_dev_user: str | None = Header(default=None, alias="X-Dev-User"),
    settings: Settings = Depends(get_settings),
) -> CurrentUser | None:
    if settings.dev_auth_bypass:
        subject = (x_dev_user or "local-developer").strip()
        if not subject:
            raise _unauthorized("X-Dev-User cannot be blank")
        return CurrentUser(subject=subject, display_name=subject, roles={"publisher", "moderator"})
    if credentials is None:
        return None
    try:
        claims = await asyncio.to_thread(_decode_oidc_token, credentials.credentials, settings)
    except HTTPException:
        raise
    except Exception as exc:
        logger.info("OIDC token validation failed: %s", exc)
        raise _unauthorized("Invalid or expired access token") from exc
    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject:
        raise _unauthorized("Access token has no subject")
    return CurrentUser(
        subject=subject,
        display_name=str(claims.get("preferred_username") or claims.get("name") or subject),
        email=str(claims["email"]) if claims.get("email") else None,
        roles=_roles_from_claims(claims, settings.oidc_audience),
    )


async def require_user(user: CurrentUser | None = Depends(get_optional_user)) -> CurrentUser:
    if user is None:
        raise _unauthorized()
    return user


def create_api_token(settings: Settings) -> tuple[str, str, str]:
    prefix = secrets.token_hex(4)
    raw_token = f"oidt_{prefix}_{secrets.token_urlsafe(32)}"
    return raw_token, prefix, hash_api_token(raw_token, settings)


def hash_api_token(token: str, settings: Settings) -> str:
    return hashlib.sha256(f"{settings.token_hash_pepper}:{token}".encode()).hexdigest()


async def authenticate_api_token(
    request: Request,
    dataset_id: str,
    session: AsyncSession,
    settings: Settings,
    required_scope: str,
) -> ApiToken:
    authorization = request.headers.get("Authorization", "")
    if not authorization.lower().startswith("bearer "):
        raise _unauthorized("A dataset API token is required")
    raw_token = authorization.split(" ", 1)[1].strip()
    parts = raw_token.split("_", 2)
    if len(parts) != 3 or parts[0] != "oidt":
        raise _unauthorized("Malformed dataset API token")
    token = await session.scalar(select(ApiToken).where(ApiToken.prefix == parts[1]))
    if token is None or not hmac.compare_digest(
        token.token_hash, hash_api_token(raw_token, settings)
    ):
        raise _unauthorized("Invalid dataset API token")
    now = datetime.now(UTC)
    expires_at = token.expires_at
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if token.revoked_at is not None or (expires_at and expires_at <= now):
        raise _unauthorized("Dataset API token is revoked or expired")
    if token.dataset_id != dataset_id or required_scope not in token.scopes:
        raise HTTPException(status_code=403, detail="Token scope does not allow this operation")
    token.last_used_at = now
    return token


def client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        # Nginx appends the actual peer with proxy_add_x_forwarded_for. The rightmost
        # value cannot be selected by a client-supplied prefix.
        return forwarded.rsplit(",", 1)[-1].strip()
    return request.client.host if request.client else None


async def db_session_dependency() -> AsyncSession:
    # Kept for generated OpenAPI dependency references; routes use get_session directly.
    async for session in get_session():
        return session
    raise RuntimeError("Database session unavailable")
