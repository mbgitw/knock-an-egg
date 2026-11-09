"""Call the public deployment APIs of Builda Agent Server and Builda Online."""

from __future__ import annotations

import json
import secrets
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional


class HttpError(RuntimeError):
    """Hold the HTTP status, business code, and public error message of a public deployment API."""

    def __init__(
        self,
        message: str,
        *,
        status_code: Optional[int] = None,
        business_code: Optional[str] = None,
    ) -> None:
        """Build a server error free of caller guesses."""

        self.status_code = status_code
        self.business_code = business_code
        super().__init__(message)


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Refuse automatic redirects so the Authorization header is not sent to other services."""

    def redirect_request(
        self,
        _request: urllib.request.Request,
        _file_pointer: Any,
        _code: int,
        _message: str,
        _headers: Any,
        _new_url: str,
    ) -> None:
        """Treat 3xx as an ordinary HTTP error."""

        return None


_OPENER = urllib.request.build_opener(_NoRedirectHandler())


def json_request(
    method: str,
    url: str,
    body: Optional[dict[str, Any]] = None,
    bearer_token: Optional[str] = None,
) -> dict[str, Any]:
    """Send a JSON request and parse a JSON object response."""

    headers = {"Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    return _execute(request)


def multipart_request(
    url: str,
    fields: dict[str, str],
    file_path: Path,
    content_type: str,
    bearer_token: str,
) -> dict[str, Any]:
    """Send one size-limited source multipart request."""

    boundary = f"----builda-online-{secrets.token_hex(16)}"
    body = bytearray()
    for name, value in fields.items():
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        body.extend(value.encode("utf-8"))
        body.extend(b"\r\n")
    body.extend(f"--{boundary}\r\n".encode())
    filename = file_path.name.replace('"', "")
    body.extend(
        (
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode()
    )
    body.extend(file_path.read_bytes())
    body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode())
    request = urllib.request.Request(
        url,
        data=bytes(body),
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {bearer_token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    return _execute(request)


def quote_path(value: str) -> str:
    """Encode a single URL path segment."""

    return urllib.parse.quote(value, safe="")


def response_error_summary(value: dict[str, Any]) -> Optional[str]:
    """Preserve the business code and public message from an abnormal business response under a success status."""

    business_code, message = _mapping_error(value)
    if business_code is None and message is None:
        return None
    code_prefix = (
        f"business code {business_code}: " if business_code is not None else ""
    )
    return f"{code_prefix}{message or 'Request was rejected'}"


def _execute(request: urllib.request.Request) -> dict[str, Any]:
    """Execute a request and convert HTTP errors into messages that do not leak credentials."""

    try:
        with _OPENER.open(request, timeout=60) as response:
            payload = response.read()
    except urllib.error.HTTPError as error:
        payload = error.read()
        business_code, message = _response_error(payload)
        code_suffix = (
            f" / business code {business_code}" if business_code is not None else ""
        )
        raise HttpError(
            f"HTTP {error.code}{code_suffix}: {message}",
            status_code=error.code,
            business_code=business_code,
        ) from error
    except urllib.error.URLError as error:
        raise HttpError(f"Request failed: {error.reason}") from error
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise HttpError("Server returned invalid JSON") from error
    if not isinstance(value, dict):
        raise HttpError("Server JSON root is not an object")
    return value


def _response_error(payload: bytes) -> tuple[Optional[str], str]:
    """Extract the public business code and error message, limiting output length."""

    try:
        value = json.loads(payload.decode("utf-8"))
        if isinstance(value, dict):
            business_code, message = _mapping_error(value)
            if business_code is not None or message is not None:
                return business_code, message or "Request was rejected"
    except (UnicodeDecodeError, json.JSONDecodeError):
        pass
    text = payload.decode("utf-8", errors="replace").strip()
    return None, text[:500] or "Request was rejected"


def _mapping_error(value: dict[str, Any]) -> tuple[Optional[str], Optional[str]]:
    """Extract length-limited business error fields from a JSON object."""

    code = value.get("code") or value.get("error_code") or value.get("errorCode")
    message = value.get("message") or value.get("msg") or value.get("detail")
    normalized_code = None
    if isinstance(code, (str, int)) and not isinstance(code, bool):
        normalized_code = str(code)[:100]
    normalized_message = None
    if isinstance(message, (str, int)) and not isinstance(message, bool):
        normalized_message = str(message)[:500]
    return normalized_code, normalized_message
