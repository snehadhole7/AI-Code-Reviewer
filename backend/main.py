import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

APP_SECRET = os.getenv("APP_SECRET", "change-this-secret-before-deployment")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
MONGODB_URI = os.getenv("MONGODB_URI", "")
MONGODB_DB = os.getenv("MONGODB_DB", "ai_code_reviewer")
DATA_DIR = Path(__file__).parent / "data"
USERS_FILE = DATA_DIR / "users.json"
REPORTS_FILE = DATA_DIR / "reports.json"

app = FastAPI(title="AI Code Reviewer API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AuthRequest(BaseModel):
    email: str
    password: str = Field(min_length=6)


class ReviewRequest(BaseModel):
    source: str = ""
    file_name: str = ""
    repo_url: str = ""


def ensure_data_files() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    for file_path in (USERS_FILE, REPORTS_FILE):
        if not file_path.exists():
            file_path.write_text("[]", encoding="utf-8")


def read_json(file_path: Path) -> list[dict[str, Any]]:
    ensure_data_files()
    return json.loads(file_path.read_text(encoding="utf-8"))


def write_json(file_path: Path, rows: list[dict[str, Any]]) -> None:
    ensure_data_files()
    file_path.write_text(json.dumps(rows, indent=2), encoding="utf-8")


def mongo_collection(name: str):
    if not MONGODB_URI:
        return None

    try:
        from pymongo import MongoClient
    except ImportError:
        return None

    client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=1500)
    client.admin.command("ping")
    return client[MONGODB_DB][name]


def load_users() -> list[dict[str, Any]]:
    collection = mongo_collection("users")
    if collection is not None:
        return [{key: value for key, value in user.items() if key != "_id"} for user in collection.find()]
    return read_json(USERS_FILE)


def save_users(users: list[dict[str, Any]]) -> None:
    collection = mongo_collection("users")
    if collection is not None:
        collection.delete_many({})
        if users:
            collection.insert_many(users)
        return
    write_json(USERS_FILE, users)


def load_reports() -> list[dict[str, Any]]:
    collection = mongo_collection("reports")
    if collection is not None:
        return [{key: value for key, value in report.items() if key != "_id"} for report in collection.find().sort("createdAt", -1)]
    return read_json(REPORTS_FILE)


def insert_report(report: dict[str, Any]) -> None:
    collection = mongo_collection("reports")
    if collection is not None:
        collection.insert_one(report)
        return

    reports = read_json(REPORTS_FILE)
    reports.insert(0, report)
    write_json(REPORTS_FILE, reports[:100])


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def sign(value: str) -> str:
    digest = hmac.new(APP_SECRET.encode("utf-8"), value.encode("utf-8"), hashlib.sha256).digest()
    return b64url(digest)


def create_token(email: str) -> str:
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode("utf-8"))
    payload = b64url(json.dumps({"sub": email, "iat": int(time.time())}).encode("utf-8"))
    signature = sign(f"{header}.{payload}")
    return f"{header}.{payload}.{signature}"


def verify_token(authorization: str = Header(default="")) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = authorization.removeprefix("Bearer ").strip()
    parts = token.split(".")
    if len(parts) != 3 or not hmac.compare_digest(sign(f"{parts[0]}.{parts[1]}"), parts[2]):
        raise HTTPException(status_code=401, detail="Invalid token")

    padded_payload = parts[1] + "=" * (-len(parts[1]) % 4)
    payload = json.loads(base64.urlsafe_b64decode(padded_payload.encode("utf-8")))
    return payload["sub"]


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000)
    return f"{salt}:{digest.hex()}"


def password_matches(password: str, stored_hash: str) -> bool:
    salt, _ = stored_hash.split(":", 1)
    return hmac.compare_digest(hash_password(password, salt), stored_hash)


def detect_language(file_name: str, source: str, repo_url: str) -> str:
    name = f"{file_name or repo_url}".lower()
    if name.endswith(".py") or "def " in source:
        return "Python"
    if name.endswith(".cpp") or "#include" in source:
        return "C++"
    if name.endswith(".java") or "public class" in source:
        return "Java"
    if name.endswith(".ts"):
        return "TypeScript"
    if name.endswith(".js") or "function " in source:
        return "JavaScript"
    return "Mixed"


def fallback_review(source: str, file_name: str, repo_url: str) -> dict[str, Any]:
    language = detect_language(file_name, source, repo_url)
    lines = source.splitlines() or [""]
    risky_loop = "<=" in source and ".length" in source
    has_eval = "eval(" in source or "innerHTML" in source
    no_try_catch = "try" not in source and "catch" not in source
    hardcoded_secret = bool(re.search(r"api[_-]?key|password|secret", source, re.I))
    bug_count = sum([risky_loop, no_try_catch]) + int(len(lines) > 160)
    security_count = sum([has_eval, hardcoded_secret])
    performance_count = 2 if len(lines) > 80 else 1
    score = max(58, 96 - bug_count * 9 - security_count * 12 - performance_count * 4 - 5)

    return {
        "id": secrets.token_hex(12),
        "title": file_name or repo_url.replace("https://", "").replace("http://", "") or "Pasted source code",
        "language": language,
        "createdAt": datetime.now(timezone.utc).astimezone().strftime("%d %b %Y, %I:%M %p"),
        "score": score,
        "metrics": {
            "Bugs": max(0, 100 - bug_count * 28),
            "Security": max(0, 100 - security_count * 34),
            "Performance": max(0, 100 - performance_count * 15),
            "CleanCode": 90 if len(source) < 1800 else 78,
        },
        "bugs": [
            "Possible off-by-one loop: using <= with array length can read an undefined item."
            if risky_loop
            else "No critical syntax-level bug pattern found in this sample.",
            "Add input validation before accessing nested values.",
        ],
        "warnings": [
            "No error handling block detected around risky operations."
            if no_try_catch
            else "Error handling is present.",
            "Large file detected. Split into smaller modules for better review quality."
            if len(lines) > 120
            else "File size is comfortable for focused review.",
        ],
        "security": [
            "Avoid eval or direct innerHTML because they can enable injection attacks."
            if has_eval
            else "No direct eval or innerHTML usage detected.",
            "A possible hardcoded credential was detected. Move secrets to environment variables."
            if hardcoded_secret
            else "No obvious hardcoded secret pattern found.",
        ],
        "suggestions": [
            "Add unit tests for invalid, empty, and large input cases.",
            "Use descriptive function names and keep each function focused on one job.",
            "Return structured errors from the backend so the dashboard can show precise fixes.",
        ],
        "optimizedCode": (
            'function calculateTotal(items = []) {\n'
            '  if (!Array.isArray(items)) throw new TypeError("items must be an array");\n'
            "  return items.reduce((total, item) => total + Number(item.price || 0), 0);\n"
            "}"
        ),
        "severity": {
            "Critical": security_count,
            "High": bug_count,
            "Medium": performance_count,
            "Low": 2,
        },
        "source": "Local FastAPI analyzer",
    }


def gemini_review(source: str, file_name: str, repo_url: str) -> dict[str, Any] | None:
    if not GEMINI_API_KEY:
        return None

    prompt = f"""
Return only valid JSON for an AI code review report.
Schema keys: title, language, score, metrics, bugs, warnings, security, suggestions, optimizedCode, severity.
metrics must contain Bugs, Security, Performance, CleanCode as numbers 0-100.
severity must contain Critical, High, Medium, Low counts.

File name: {file_name}
Repository URL: {repo_url}
Source code:
{source[:18000]}
"""
    endpoint = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
        f"?key={GEMINI_API_KEY}"
    )
    payload = json.dumps({"contents": [{"parts": [{"text": prompt}]}]}).encode("utf-8")
    request = urllib.request.Request(endpoint, data=payload, headers={"Content-Type": "application/json"})

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None

    text = data["candidates"][0]["content"]["parts"][0]["text"]
    text = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()

    try:
        report = json.loads(text)
    except json.JSONDecodeError:
        return None

    report["id"] = secrets.token_hex(12)
    report["createdAt"] = datetime.now(timezone.utc).astimezone().strftime("%d %b %Y, %I:%M %p")
    report["source"] = "Gemini API"
    return report


def save_report(email: str, report: dict[str, Any]) -> dict[str, Any]:
    insert_report({"owner": email, **report})
    return report


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "geminiConfigured": bool(GEMINI_API_KEY), "mongoConfigured": bool(MONGODB_URI)}


@app.post("/auth/signup")
def signup(payload: AuthRequest) -> dict[str, Any]:
    users = load_users()
    if any(user["email"].lower() == payload.email.lower() for user in users):
        raise HTTPException(status_code=409, detail="Email already registered")

    users.append({"email": payload.email.lower(), "passwordHash": hash_password(payload.password)})
    save_users(users)
    token = create_token(payload.email.lower())
    return {"email": payload.email.lower(), "token": token}


@app.post("/auth/login")
def login(payload: AuthRequest) -> dict[str, Any]:
    users = load_users()
    user = next((item for item in users if item["email"].lower() == payload.email.lower()), None)
    if not user or not password_matches(payload.password, user["passwordHash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    return {"email": user["email"], "token": create_token(user["email"])}


@app.post("/review/code")
def review_code(payload: ReviewRequest, email: str = Depends(verify_token)) -> dict[str, Any]:
    if not payload.source and not payload.repo_url:
        raise HTTPException(status_code=400, detail="Source code or repository URL is required")

    report = gemini_review(payload.source, payload.file_name, payload.repo_url)
    if report is None:
        report = fallback_review(payload.source, payload.file_name, payload.repo_url)
    return save_report(email, report)


@app.post("/review/file")
async def review_file(file: UploadFile, email: str = Depends(verify_token)) -> dict[str, Any]:
    source = (await file.read()).decode("utf-8", errors="replace")
    report = gemini_review(source, file.filename or "", "")
    if report is None:
        report = fallback_review(source, file.filename or "", "")
    return save_report(email, report)


@app.get("/reports")
def list_reports(email: str = Depends(verify_token)) -> list[dict[str, Any]]:
    reports = load_reports()
    return [{key: value for key, value in report.items() if key != "owner"} for report in reports if report["owner"] == email]
