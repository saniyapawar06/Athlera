"""ATHLERA backend — FastAPI + Motor (MongoDB) + JWT auth.

Everything is served under the /api prefix.  Uses UUID strings for entity IDs
(never returns raw _id).  Ratings, UAS and match finalisation happen
server-side.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import math
import os
import statistics
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import jwt
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, status
from fastapi.responses import HTMLResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware

import scoring

# ---------- Config ----------
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")
ACCESS_TTL_MINUTES = int(os.environ.get("ACCESS_TTL_MINUTES", "10080"))

# ---------- Payments (Razorpay) ----------
# Live mode kicks in automatically once real test/live keys are provided in .env.
# Without keys the app runs in TEST-MODE and confirms paid registrations via an
# explicit in-app "test payment" step so the whole flow is verifiable end-to-end.
RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "").strip()
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "").strip()
PAYMENTS_LIVE = bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET)

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("athlera")

# ---------- Sport catalog ----------
SPORTS: list[dict[str, Any]] = [
    {"id": "squash",     "name": "Squash",     "decimals": 0, "min_scale": 500.0,  "default_rating": 3500.0, "accent": "#00FA9A"},
    {"id": "padel",      "name": "Padel",      "decimals": 2, "min_scale": 0.35,   "default_rating": 3.50,   "accent": "#FF6B6B"},
    {"id": "tennis",     "name": "Tennis",     "decimals": 2, "min_scale": 0.35,   "default_rating": 3.50,   "accent": "#DFFF00"},
    {"id": "badminton",  "name": "Badminton", "decimals": 0, "min_scale": 80.0,   "default_rating": 500.0,  "accent": "#FFC107"},
    {"id": "pickleball", "name": "Pickleball","decimals": 2, "min_scale": 0.35,   "default_rating": 3.50,   "accent": "#39FF14"},
]
SPORT_BY_ID = {s["id"]: s for s in SPORTS}

LEVELS = [
    {"id": "beginner",      "label": "Beginner",       "blurb": "Just starting out. Learning strokes & rules.",         "percentile": 0.10},
    {"id": "recreational",  "label": "Recreational",   "blurb": "Play casually a few times a month for fun.",           "percentile": 0.28},
    {"id": "intermediate",  "label": "Intermediate",   "blurb": "Consistent play. Understand tactics & positioning.",   "percentile": 0.50},
    {"id": "advanced",      "label": "Advanced",       "blurb": "Strong technical & tactical game. Club-level regular.", "percentile": 0.72},
    {"id": "competitive",   "label": "Competitive",    "blurb": "Play tournaments locally / regionally.",               "percentile": 0.88},
    {"id": "elite_amateur", "label": "Elite Amateur",  "blurb": "Top of the amateur pyramid. National-level exposure.", "percentile": 0.96},
]
LEVEL_BY_ID = {l["id"]: l for l in LEVELS}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ---------- Rating engine ----------
def sport_scale_and_k(sport_id: str, ratings: list[float]) -> tuple[float, float]:
    sport = SPORT_BY_ID[sport_id]
    min_scale = sport["min_scale"]
    if len(ratings) >= 3:
        stdev = statistics.pstdev(ratings)
    else:
        stdev = min_scale / 2
    scale = max(min_scale, 2.0 * stdev)
    k = scale * 0.12
    return scale, k


def expected_prob(winner_rating: float, loser_rating: float, scale: float) -> float:
    # P(winner) = 1 / (1 + 10^((loser - winner)/scale))
    return 1.0 / (1.0 + math.pow(10.0, (loser_rating - winner_rating) / scale))


def margin_multiplier(unit_diff: int, unit_total: int, point_diff: int, point_total: int) -> tuple[float, float]:
    unit_dom = (unit_diff / unit_total) if unit_total > 0 else 0.0
    point_dom = (point_diff / point_total) if point_total > 0 else 0.0
    margin_score = max(0.0, min(1.0, 0.55 * unit_dom + 0.45 * point_dom))
    return 1.0 + 0.9 * margin_score, margin_score


def anomaly_factor(expected_winner: float, rating_gap: float, stdev: float) -> float:
    # Very predictable big-gap upsets don't fully count as huge upsets; also dampen unlikely results.
    if stdev <= 0:
        stdev = 1.0
    if expected_winner > 0.95 and rating_gap > 2.5 * stdev:
        return 0.5
    return 1.0


def compute_rating_change(
    sport_id: str,
    winner_rating: float,
    loser_rating: float,
    unit_diff: int,
    unit_total: int,
    point_diff: int,
    point_total: int,
    population: list[float],
    provisional: bool = False,
) -> dict[str, float]:
    scale, k = sport_scale_and_k(sport_id, population)
    ew = expected_prob(winner_rating, loser_rating, scale)
    mm, margin_score = margin_multiplier(unit_diff, unit_total, point_diff, point_total)
    af = anomaly_factor(ew, abs(winner_rating - loser_rating), scale / 2.0)
    boost = 2.0 if provisional else 1.0
    delta = k * (1.0 - ew) * mm * af * boost
    new_winner = max(0.0, winner_rating + delta)
    new_loser = max(0.0, loser_rating - delta)
    return {
        "scale": scale,
        "k": k,
        "expected_winner": ew,
        "margin_multiplier": mm,
        "margin_score": margin_score,
        "anomaly": af,
        "delta": delta,
        "new_winner": new_winner,
        "new_loser": new_loser,
    }


def rating_tag(expected_winner: float, margin_score: float) -> str:
    upset = expected_winner < 0.35
    even = 0.4 <= expected_winner <= 0.6
    dominant = margin_score >= 0.35
    close = margin_score <= 0.12
    if upset and dominant:
        return "Upset Bonus · Clear Win"
    if upset:
        return "Upset · Close Match"
    if even and dominant:
        return "Even Matchup · Dominant Score"
    if even:
        return "Even Matchup · Close"
    if dominant:
        return "Expected Result · Dominant"
    if close:
        return "Expected Result · Close Match"
    return "Expected Result · Clear Win"


def band_for_percentile(p: float) -> str:
    if p >= 0.95: return "Elite"
    if p >= 0.80: return "Competitive"
    if p >= 0.55: return "Advanced"
    if p >= 0.30: return "Intermediate"
    if p >= 0.10: return "Recreational"
    return "Beginner"


# ---------- Score validation ----------
def _validate_squash_game(a: int, b: int) -> None:
    if a < 0 or b < 0:
        raise HTTPException(400, "Negative squash score")
    hi, lo = max(a, b), min(a, b)
    if hi < 11:
        raise HTTPException(400, "Squash game must reach 11")
    if hi == 11 and lo <= 9:
        return
    # After 10-10 must win by 2, no cap
    if hi - lo != 2:
        raise HTTPException(400, "Squash must win by 2 after 10-10")


def _validate_tennis_set(a: int, b: int, is_last_set_tiebreak: bool = False) -> None:
    hi, lo = max(a, b), min(a, b)
    if hi < 6 and not (hi == 7 and lo == 6):
        raise HTTPException(400, "Tennis set must reach 6")
    if hi == 6 and lo <= 4: return
    if hi == 7 and lo in (5, 6): return
    raise HTTPException(400, f"Invalid tennis set score {a}-{b}")


def _validate_badminton_game(a: int, b: int) -> None:
    hi, lo = max(a, b), min(a, b)
    if hi > 30:
        raise HTTPException(400, "Badminton hard cap is 30")
    if hi == 30 and lo == 29: return
    if hi == 21 and lo <= 19: return
    if 22 <= hi <= 29 and hi - lo == 2: return
    raise HTTPException(400, f"Invalid badminton score {a}-{b}")


def _validate_pickleball_game(a: int, b: int) -> None:
    hi, lo = max(a, b), min(a, b)
    if hi < 11:
        raise HTTPException(400, "Pickleball game must reach 11")
    if hi == 11 and lo <= 9: return
    if hi - lo == 2: return
    raise HTTPException(400, f"Invalid pickleball score {a}-{b}")


def validate_score(sport_id: str, sides_games: list[list[int]]) -> dict:
    """`sides_games`: list of games/sets — each is [side0_points, side1_points]."""
    if not sides_games:
        raise HTTPException(400, "No games provided")
    max_units = {"squash": 5, "tennis": 3, "padel": 3, "badminton": 3, "pickleball": 3}.get(sport_id)
    if max_units is None:
        raise HTTPException(400, f"Unknown sport {sport_id}")
    if len(sides_games) > max_units:
        raise HTTPException(400, f"A {sport_id} match cannot contain more than {max_units} games/sets")
    side_wins = [0, 0]
    total_points = [0, 0]
    for g in sides_games:
        if len(g) != 2:
            raise HTTPException(400, "Each game must have two scores")
        a, b = int(g[0]), int(g[1])
        if sport_id == "squash":     _validate_squash_game(a, b)
        elif sport_id == "tennis":   _validate_tennis_set(a, b)
        elif sport_id == "padel":    _validate_tennis_set(a, b)
        elif sport_id == "badminton":_validate_badminton_game(a, b)
        elif sport_id == "pickleball":_validate_pickleball_game(a, b)
        else: raise HTTPException(400, f"Unknown sport {sport_id}")
        total_points[0] += a; total_points[1] += b
        if a > b: side_wins[0] += 1
        else:     side_wins[1] += 1
    winner_side = 0 if side_wins[0] > side_wins[1] else 1
    # Must be a majority-of-games win. A result cannot include games after the
    # match was already clinched.
    needed = (len(sides_games) // 2) + 1
    if side_wins[winner_side] < needed:
        raise HTTPException(400, "Not a completed match — winner did not clinch")
    return {
        "winner_side": winner_side,
        "unit_diff": abs(side_wins[0] - side_wins[1]),
        "unit_total": sum(side_wins),
        "point_diff": abs(total_points[0] - total_points[1]),
        "point_total": sum(total_points),
        "side_wins": side_wins,
        "total_points": total_points,
    }


# ---------- Models ----------
class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    display_name: Optional[str] = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class SportRatingSubmitIn(BaseModel):
    sport_id: str
    has_accredited: bool
    provider_name: Optional[str] = None
    submitted_rating: Optional[float] = None
    screenshot_base64: Optional[str] = None  # data URI or raw base64
    level_id: Optional[str] = None


class OnboardingIn(BaseModel):
    display_name: Optional[str] = None
    submissions: list[SportRatingSubmitIn]


class MatchPreviewIn(BaseModel):
    sport_id: str
    opponent_user_id: str
    games: list[list[int]]


class MatchSubmitIn(MatchPreviewIn):
    played_at: Optional[str] = None
    note: Optional[str] = None


class MatchConfirmIn(BaseModel):
    match_id: str
    action: str  # "verify" or "dispute"


# ---------- Lifespan ----------
client: Optional[AsyncIOMotorClient] = None
DB = None


async def seed_data() -> None:
    """Seed sport catalog and demo users so leaderboards look real."""
    # Sports
    for s in SPORTS:
        await DB.sports.update_one({"id": s["id"]}, {"$set": s}, upsert=True)

    # Demo users
    existing = await DB.users.count_documents({"is_seed": True})
    if existing >= 30:
        return
    log.info("Seeding demo users & ratings…")
    demo_names = [
        "Aarav Mehta","Bianca Rossi","Chen Wei","Diego Alvarez","Elena Novak","Farah Haddad",
        "Grace O'Neil","Hiro Tanaka","Isla Fernandez","Jonas Berg","Kavya Iyer","Liam Walsh",
        "Mei Zhang","Noah Cohen","Olivia Park","Priya Shah","Quentin Roux","Rania Al-Amri",
        "Santiago Vega","Tara Kapoor","Uma Prakash","Viktor Ilic","Wren Ashford","Xiomara Diaz",
        "Yusuf Karim","Zoe Blackwood","Arjun Nair","Bea Lindqvist","Cyrus Bhatt","Daria Volkov",
        "Ewan McRae","Fionn Kelly","Giulia Marchetti","Haruki Sato","Imani Okafor","Jae-won Lim",
    ]
    for i, name in enumerate(demo_names):
        uid = str(uuid.uuid4())
        await DB.users.insert_one({
            "id": uid,
            "email": None,
            "password_hash": None,
            "is_guest": False,
            "is_seed": True,
            "display_name": name,
            "username": name.lower().replace(" ", "_").replace("'", ""),
            "bio": "Demo athlete",
            "city": ["London","Mumbai","Singapore","Barcelona","Dubai","New York","Sydney","Tokyo"][i % 8],
            "created_at": now_utc(),
        })
        # Give each seed user 3-5 sports at varying strengths
        import random
        random.seed(hash(name))
        chosen = random.sample([s["id"] for s in SPORTS], k=random.randint(3, 5))
        for sid in chosen:
            sport = SPORT_BY_ID[sid]
            base = sport["default_rating"]
            spread = sport["min_scale"] * 6
            rating = round(max(0.0, base + random.uniform(-spread, spread * 1.2)), sport["decimals"])
            matches_played = random.randint(6, 60)
            await DB.player_sports.insert_one({
                "id": str(uuid.uuid4()),
                "user_id": uid,
                "sport_id": sid,
                "rating": rating,
                "peak_rating": rating + random.uniform(0, spread * 0.3),
                "provisional": False,
                "matches_played": matches_played,
                "wins": random.randint(0, matches_played),
                "level_id": None,
                "external": None,
                "created_at": now_utc(),
            })
    log.info("Seeding done.")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global client, DB
    client = AsyncIOMotorClient(MONGO_URL)
    DB = client[DB_NAME]
    await DB.command("ping")
    await DB.users.create_index(
        "email", unique=True,
        partialFilterExpression={"email": {"$type": "string"}},
    )
    await DB.users.create_index("id", unique=True)
    await DB.player_sports.create_index([("user_id", 1), ("sport_id", 1)], unique=True)
    await DB.player_sports.create_index([("sport_id", 1), ("rating", -1)])
    await DB.matches.create_index([("participants", 1), ("created_at", -1)])
    await DB.revoked_tokens.create_index("expires_at", expireAfterSeconds=0)
    await seed_data()
    yield
    client.close()


app = FastAPI(title="ATHLERA API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
api = APIRouter(prefix="/api")


# ---------- Auth helpers ----------
def issue_token(user: dict) -> str:
    now = now_utc()
    claims = {
        "sub": user["id"],
        "is_guest": user.get("is_guest", False),
        "jti": uuid.uuid4().hex,
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TTL_MINUTES),
    }
    return jwt.encode(claims, JWT_SECRET, algorithm=JWT_ALGORITHM)


def public_user(u: dict) -> dict:
    return {
        "id": u["id"],
        "email": u.get("email"),
        "is_guest": u.get("is_guest", False),
        "display_name": u.get("display_name"),
        "username": u.get("username"),
        "city": u.get("city"),
        "bio": u.get("bio"),
        "onboarded": bool(u.get("onboarded")),
        "created_at": (u.get("created_at") or now_utc()).isoformat(),
    }


async def current_user(cred: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme)) -> dict:
    if cred is None:
        raise HTTPException(401, "Missing bearer token")
    try:
        claims = jwt.decode(
            cred.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM],
            options={"require": ["sub", "exp", "jti"]},
        )
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired token")
    if await DB.revoked_tokens.find_one({"jti": claims["jti"]}):
        raise HTTPException(401, "Token revoked")
    u = await DB.users.find_one({"id": claims["sub"]}, {"_id": 0})
    if not u:
        raise HTTPException(401, "User not found")
    return u


# ---------- Auth routes ----------
@api.get("/")
async def root():
    return {"ok": True, "service": "athlera"}


@api.post("/auth/register", response_model=TokenOut, status_code=201)
async def register(body: SignupIn):
    email = body.email.lower()
    if await DB.users.find_one({"email": email}):
        raise HTTPException(409, "Email already registered")
    uid = str(uuid.uuid4())
    user = {
        "id": uid,
        "email": email,
        "password_hash": pwd_ctx.hash(body.password),
        "is_guest": False,
        "display_name": body.display_name or email.split("@")[0],
        "username": email.split("@")[0].replace(".", "_"),
        "onboarded": False,
        "created_at": now_utc(),
    }
    await DB.users.insert_one(user)
    return TokenOut(access_token=issue_token(user), user=public_user(user))


@api.post("/auth/login", response_model=TokenOut)
async def login(body: LoginIn):
    email = body.email.lower()
    u = await DB.users.find_one({"email": email})
    ok = pwd_ctx.verify(body.password, u["password_hash"]) if u and u.get("password_hash") else False
    if not u or not ok or u.get("is_guest"):
        raise HTTPException(401, "Incorrect email or password")
    return TokenOut(access_token=issue_token(u), user=public_user(u))


@api.post("/auth/guest", response_model=TokenOut, status_code=201)
async def guest():
    uid = str(uuid.uuid4())
    u = {
        "id": uid, "email": None, "password_hash": None,
        "is_guest": True, "display_name": f"Guest-{uid[:4].upper()}",
        "username": f"guest_{uid[:6]}", "onboarded": False, "created_at": now_utc(),
    }
    await DB.users.insert_one(u)
    return TokenOut(access_token=issue_token(u), user=public_user(u))


@api.get("/auth/me")
async def me(u: dict = Depends(current_user)):
    return public_user(u)


class SessionIn(BaseModel):
    session_id: str


@api.post("/auth/session")
async def auth_session(body: SessionIn):
    """Exchange an Emergent Google-auth session_id for an ATHLERA JWT.

    Reuses the existing user/JWT system: we upsert the user by email (never
    duplicating existing accounts) and mint the same access_token used by
    email/guest login, so the rest of the app is unchanged.
    """
    import httpx
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": body.session_id},
            )
    except Exception:
        raise HTTPException(401, "Could not verify Google session")
    if r.status_code != 200:
        raise HTTPException(401, "Invalid or expired Google session")
    data = r.json()
    email = (data.get("email") or "").lower()
    if not email:
        raise HTTPException(401, "Google session missing email")
    name = data.get("name") or email.split("@")[0]
    u = await DB.users.find_one({"email": email})
    if u:
        # Reuse the existing account; mark it as no-longer-guest if it was.
        if u.get("is_guest"):
            await DB.users.update_one({"id": u["id"]}, {"$set": {"is_guest": False}})
            u["is_guest"] = False
    else:
        uid = str(uuid.uuid4())
        u = {
            "id": uid, "email": email, "password_hash": None, "is_guest": False,
            "display_name": name, "username": email.split("@")[0].replace(".", "_"),
            "auth_provider": "google", "onboarded": False, "created_at": now_utc(),
        }
        await DB.users.insert_one(u)
    return TokenOut(access_token=issue_token(u), user=public_user(u))


@api.post("/auth/logout", status_code=204)
async def logout(cred: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme)):
    if not cred:
        return
    try:
        claims = jwt.decode(cred.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM], options={"verify_exp": False})
        exp = datetime.fromtimestamp(claims["exp"], timezone.utc)
        await DB.revoked_tokens.insert_one({"jti": claims["jti"], "expires_at": exp})
    except jwt.PyJWTError:
        pass


# ---------- Catalog ----------
@api.get("/sports")
async def list_sports():
    return {"sports": SPORTS, "levels": LEVELS}


# ---------- Onboarding & player_sports ----------
async def _population_ratings(sport_id: str) -> list[float]:
    docs = await DB.player_sports.find({"sport_id": sport_id}, {"_id": 0, "rating": 1}).to_list(5000)
    return [d["rating"] for d in docs]


async def _provisional_from_level(sport_id: str, level_id: str) -> float:
    lvl = LEVEL_BY_ID[level_id]
    ratings = await _population_ratings(sport_id)
    sport = SPORT_BY_ID[sport_id]
    if len(ratings) >= 10:
        ratings.sort()
        idx = int(lvl["percentile"] * (len(ratings) - 1))
        base = ratings[idx]
    else:
        base = sport["default_rating"]
    return round(base, sport["decimals"])


async def _provisional_from_accredited(sport_id: str, submitted: float) -> float:
    # V1: identity conversion + clamped to sport's plausible band.
    sport = SPORT_BY_ID[sport_id]
    return round(max(0.0, submitted), sport["decimals"])


@api.post("/onboarding/submit")
async def onboarding_submit(body: OnboardingIn, u: dict = Depends(current_user)):
    updates: dict[str, Any] = {"onboarded": True}
    if body.display_name:
        updates["display_name"] = body.display_name
    await DB.users.update_one({"id": u["id"]}, {"$set": updates})

    results = []
    for sub in body.submissions:
        if sub.sport_id not in SPORT_BY_ID:
            raise HTTPException(400, f"Unknown sport {sub.sport_id}")
        sport = SPORT_BY_ID[sub.sport_id]

        external = None
        provisional = True
        rating: float
        if sub.has_accredited:
            if sub.submitted_rating is None or not sub.provider_name:
                raise HTTPException(400, "Accredited rating requires provider & rating")
            rating = await _provisional_from_accredited(sub.sport_id, sub.submitted_rating)
            ext_id = str(uuid.uuid4())
            await DB.external_rating_submissions.insert_one({
                "id": ext_id,
                "player_id": u["id"],
                "sport_id": sub.sport_id,
                "provider_name": sub.provider_name,
                "submitted_rating": sub.submitted_rating,
                "screenshot_base64": sub.screenshot_base64,
                "verification_status": "pending",
                "verified_by": None,
                "verified_at": None,
                "created_at": now_utc(),
            })
            external = {"submission_id": ext_id, "provider": sub.provider_name, "status": "pending"}
        else:
            if not sub.level_id or sub.level_id not in LEVEL_BY_ID:
                raise HTTPException(400, "Level required when no accredited rating")
            rating = await _provisional_from_level(sub.sport_id, sub.level_id)

        doc = {
            "id": str(uuid.uuid4()),
            "user_id": u["id"],
            "sport_id": sub.sport_id,
            "rating": rating,
            "peak_rating": rating,
            "provisional": provisional,
            "matches_played": 0,
            "wins": 0,
            "level_id": sub.level_id if not sub.has_accredited else None,
            "external": external,
            "created_at": now_utc(),
        }
        await DB.player_sports.update_one(
            {"user_id": u["id"], "sport_id": sub.sport_id},
            {"$set": {k: v for k, v in doc.items() if k != "id"}, "$setOnInsert": {"id": doc["id"]}},
            upsert=True,
        )
        results.append({
            "sport_id": sub.sport_id,
            "sport_name": sport["name"],
            "rating": rating,
            "provisional": True,
            "external": external,
            "decimals": sport["decimals"],
        })
    return {"ok": True, "ratings": results}


@api.post("/player-sports/add")
async def add_sport(body: SportRatingSubmitIn, u: dict = Depends(current_user)):
    return await onboarding_submit(OnboardingIn(submissions=[body]), u)


# ---------- Player profile & dashboard ----------
async def _uas_for_user(user_id: str) -> dict:
    ps = await DB.player_sports.find({"user_id": user_id}, {"_id": 0}).to_list(50)
    percentiles: dict[str, float] = {}
    for entry in ps:
        pop = await _population_ratings(entry["sport_id"])
        below = sum(1 for r in pop if r < entry["rating"])
        tied = sum(1 for r in pop if r == entry["rating"])
        total = len(pop) or 1
        pct = (below + 0.5 * tied) / total
        percentiles[entry["sport_id"]] = pct
    if percentiles:
        avg = sum(percentiles.values()) / len(percentiles)
        uas = round(1000 * avg)
    else:
        uas = 0
    return {"uas": uas, "percentiles": percentiles, "sports_counted": len(percentiles)}


async def _rank_for_user(user_id: str, sport_id: str, rating: float) -> tuple[int, int]:
    total = await DB.player_sports.count_documents({"sport_id": sport_id})
    higher = await DB.player_sports.count_documents({"sport_id": sport_id, "rating": {"$gt": rating}})
    return higher + 1, total


def _ordinal(n: int) -> str:
    if 10 <= n % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


async def _competition_progress(user_id: str) -> Optional[dict]:
    """Best-effort 'what's next' for one active competition the user is in."""
    mem = await DB.competition_members.find({"user_id": user_id, "status": "approved"}, {"_id": 0, "competition_id": 1}).to_list(200)
    cids = [m["competition_id"] for m in mem]
    if not cids:
        return None
    comp = await DB.competitions.find_one({"id": {"$in": cids}, "status": "in_progress"}, {"_id": 0})
    if not comp:
        return None
    if comp["type"] == "knockout":
        fixtures = await DB.fixtures.find({"competition_id": comp["id"]}, {"_id": 0}).sort([("round", 1), ("index", 1)]).to_list(500)
        total_rounds = next((f["total_rounds"] for f in fixtures if f.get("total_rounds")), None)
        for f in fixtures:
            if f.get("status") != "complete" and not f.get("winner_side"):
                uids = [x for s in f["sides"] for x in s["user_ids"]]
                if user_id in uids:
                    return {"name": comp["name"], "label": f'{_ko_round_name(f["round"], total_rounds).title()} next', "sport_id": comp["sport_id"]}
        return {"name": comp["name"], "label": "In the running", "sport_id": comp["sport_id"]}
    standings = await _compute_standings(comp["id"])
    for row in standings:
        if row.get("user_id") == user_id:
            return {"name": comp["name"], "label": f'{_ordinal(row["position"])} of {len(standings)}', "sport_id": comp["sport_id"]}
    return {"name": comp["name"], "label": "Playing", "sport_id": comp["sport_id"]}


async def _player_gamification(user_id: str) -> dict:
    """Lightweight gamification stats derived from verified matches + comps.

    Returns current/longest streak, recent form (last 5), matches this week,
    personal bests (peak rating per sport), rating movement, badges and
    competition progress. All cheap look-ups — no heavy aggregation.
    """
    matches = await DB.matches.find(
        {"participants": user_id, "status": "verified"}, {"_id": 0}
    ).sort("created_at", 1).to_list(500)

    # chronological win/loss sequence
    seq: list[bool] = []
    for m in matches:
        if m.get("winner_user_id") is None:
            continue
        seq.append(m["winner_user_id"] == user_id)

    # current streak (from most recent, wins only)
    current = 0
    for w in reversed(seq):
        if w:
            current += 1
        else:
            break
    # longest win streak
    longest = 0
    run = 0
    for w in seq:
        run = run + 1 if w else 0
        longest = max(longest, run)

    recent_form = ["W" if w else "L" for w in seq[-5:]][::-1]  # newest first
    wins = sum(1 for w in seq if w)

    # matches this week
    week_ago = now_utc() - timedelta(days=7)
    this_week = 0
    for m in matches:
        ca = m.get("created_at")
        if isinstance(ca, datetime):
            if ca.tzinfo is None:
                ca = ca.replace(tzinfo=timezone.utc)
            if ca >= week_ago:
                this_week += 1

    # personal bests + rating movement per sport
    ps = await DB.player_sports.find({"user_id": user_id}, {"_id": 0}).to_list(50)
    personal_bests = []
    best_rank = None
    for entry in ps:
        sport = SPORT_BY_ID.get(entry["sport_id"])
        if not sport:
            continue
        rank, _pop = await _rank_for_user(user_id, entry["sport_id"], entry["rating"])
        if rank and (best_rank is None or rank < best_rank):
            best_rank = rank
        at_peak = abs(float(entry.get("rating", 0)) - float(entry.get("peak_rating", 0))) < 1e-6
        personal_bests.append({
            "sport_id": entry["sport_id"], "sport_name": sport["name"],
            "peak_rating": entry.get("peak_rating", entry.get("rating")),
            "decimals": sport["decimals"], "at_peak": bool(at_peak and entry.get("matches_played", 0) > 0),
            "rank": rank,
        })

    # competition progress
    mem = await DB.competition_members.find({"user_id": user_id, "status": "approved"}, {"_id": 0, "competition_id": 1}).to_list(200)
    my_cids = [m["competition_id"] for m in mem]
    active_comps = await DB.competitions.count_documents({"id": {"$in": my_cids}, "status": {"$in": ["in_progress", "registration_open"]}})
    titles = await DB.competitions.count_documents({"champion_ids": user_id})

    # badges (earned achievements)
    badges = []
    if wins >= 1:
        badges.append({"id": "first_win", "label": "First Win", "icon": "trophy"})
    if longest >= 3:
        badges.append({"id": "streak3", "label": "On Fire", "icon": "flame"})
    if longest >= 5:
        badges.append({"id": "streak5", "label": "Unstoppable", "icon": "flash"})
    if best_rank is not None and best_rank <= 10:
        badges.append({"id": "top10", "label": "Top 10", "icon": "ribbon"})
    if titles >= 1:
        badges.append({"id": "champion", "label": "Champion", "icon": "medal"})
    if len(seq) >= 10:
        badges.append({"id": "veteran", "label": "Veteran", "icon": "shield-checkmark"})

    # next milestone (primary sport = most matches played)
    primary = max(ps, key=lambda e: e.get("matches_played", 0), default=None)
    next_milestone = None
    if primary and primary.get("matches_played", 0) > 0:
        psport = SPORT_BY_ID.get(primary["sport_id"])
        if psport:
            dec = psport["decimals"]
            rating = float(primary.get("rating", 0))
            peak = float(primary.get("peak_rating", rating))
            eps = 10 ** (-dec) if dec else 0.5
            if rating < peak - eps:
                remaining = round(peak - rating, dec)
                rem_txt = f"{remaining:.{dec}f}" if dec else str(int(round(remaining)))
                next_milestone = {"sport_name": psport["name"], "sport_id": primary["sport_id"],
                                  "label": f"{rem_txt} to personal best", "progress": max(0.0, min(1.0, rating / peak if peak else 0)),
                                  "at_peak": False}
            else:
                next_milestone = {"sport_name": psport["name"], "sport_id": primary["sport_id"],
                                  "label": "At a career-high rating", "progress": 1.0, "at_peak": True}

    # rating movement over the last 7 days (across all sports)
    try:
        week_hist = await DB.rating_history.find({"user_id": user_id, "created_at": {"$gte": week_ago}}, {"_id": 0, "delta": 1}).to_list(300)
        rating_change_week = round(sum(float(h.get("delta", 0)) for h in week_hist), 2)
    except Exception:
        rating_change_week = 0

    competition_progress = await _competition_progress(user_id)

    return {
        "current_streak": current,
        "longest_streak": longest,
        "recent_form": recent_form,
        "wins": wins,
        "losses": len(seq) - wins,
        "matches_this_week": this_week,
        "personal_bests": personal_bests,
        "best_rank": best_rank,
        "active_competitions": active_comps,
        "titles": titles,
        "badges": badges,
        "next_milestone": next_milestone,
        "rating_change_week": rating_change_week,
        "competition_progress": competition_progress,
    }



# ==================== GAMIFICATION: INSIGHTS, ACHIEVEMENTS, SHARING ====================
async def _rank_delta_week(user_id: str, sport_id: str, current_rank: int) -> int:
    """Positive => climbed this week. Uses rank stamped on rating_history (new matches only)."""
    week_ago = now_utc() - timedelta(days=7)
    prev = await DB.rating_history.find_one(
        {"user_id": user_id, "sport_id": sport_id, "created_at": {"$lt": week_ago}, "rank": {"$exists": True}},
        {"_id": 0, "rank": 1}, sort=[("created_at", -1)],
    )
    if not prev:
        prev = await DB.rating_history.find_one(
            {"user_id": user_id, "sport_id": sport_id, "rank": {"$exists": True}},
            {"_id": 0, "rank": 1}, sort=[("created_at", 1)],
        )
    if prev and prev.get("rank"):
        return prev["rank"] - current_rank
    return 0


async def _next_fixture_sport(user_id: str, sport_id: str) -> Optional[str]:
    mem = await DB.competition_members.find({"user_id": user_id, "status": "approved"}, {"_id": 0, "competition_id": 1}).to_list(200)
    cids = [m["competition_id"] for m in mem]
    if not cids:
        return None
    comp = await DB.competitions.find_one({"id": {"$in": cids}, "status": "in_progress", "sport_id": sport_id}, {"_id": 0})
    if not comp:
        return None
    if comp["type"] == "knockout":
        fixtures = await DB.fixtures.find({"competition_id": comp["id"]}, {"_id": 0}).sort([("round", 1), ("index", 1)]).to_list(500)
        total_rounds = next((f["total_rounds"] for f in fixtures if f.get("total_rounds")), None)
        for f in fixtures:
            if f.get("status") != "complete" and not f.get("winner_side"):
                uids = [x for s in f["sides"] for x in s["user_ids"]]
                if user_id in uids:
                    return _ko_round_name(f["round"], total_rounds).title()
        return None
    return "League match"


async def _build_sport_insights(user_id: str, card: dict) -> list[dict]:
    """Compact, motivational, metric-based messages for Home / My Sports."""
    sid = card["sport_id"]
    dec = card["decimals"]
    provisional = card.get("provisional", False)
    mp = card.get("matches_played", 0)
    rating = float(card.get("rating", 0))
    peak = float(card.get("peak_rating", rating))
    streak = card.get("current_streak", 0)
    form = card.get("recent_form") or []
    rank = card.get("rank")
    out: list[dict] = []

    if provisional:
        left = max(0, 5 - mp)
        if left > 0:
            out.append({"icon": "hourglass-outline", "tone": "info",
                        "text": f"{left} match{'es' if left != 1 else ''} until rating is established"})
    if streak >= 2:
        out.append({"icon": "flame", "tone": "hot", "text": f"{streak} match streak"})
    elif streak <= -2:
        out.append({"icon": "reload", "tone": "warn", "text": f"Bounce back — lost last {-streak}"})

    if not provisional and mp > 0:
        if peak > rating:
            gap = round(peak - rating, dec)
            gaptxt = f"{gap:.{dec}f}" if dec else str(int(round(gap)))
            out.append({"icon": "trending-up", "tone": "pb", "text": f"{gaptxt} points to Personal Best"})
        elif mp > 1:
            out.append({"icon": "trophy", "tone": "pb", "text": "At your Personal Best"})

    if form:
        last5 = form[-5:]
        wins5 = sum(1 for f in last5 if f == "W")
        out.append({"icon": "stats-chart", "tone": "info", "text": f"{wins5} wins from last {len(last5)}"})

    if rank:
        d = await _rank_delta_week(user_id, sid, rank)
        if d > 0:
            out.append({"icon": "arrow-up", "tone": "up", "text": f"{d} place{'s' if d != 1 else ''} this week"})
        elif d < 0:
            out.append({"icon": "arrow-down", "tone": "warn", "text": f"{-d} place{'s' if -d != 1 else ''} this week"})

    nf = await _next_fixture_sport(user_id, sid)
    if nf:
        out.append({"icon": "git-network-outline", "tone": "comp", "text": f"{nf} next"})

    return out


# ---- Achievement catalog (computed from real metrics; no XP/currency, no new persistence) ----
ACHIEVEMENTS: list[dict[str, Any]] = [
    {"code": "first_win",   "title": "First Win",           "desc": "Win your first ranked match.",   "tier": "bronze",   "category": "milestone",   "icon": "flash"},
    {"code": "upset_win",   "title": "Giant Slayer",        "desc": "Beat a higher-rated opponent.",  "tier": "gold",     "category": "milestone",   "icon": "shield-checkmark"},
    {"code": "new_pb",      "title": "New Peak",            "desc": "Set a new personal-best rating.", "tier": "silver",   "category": "milestone",   "icon": "trending-up"},
    {"code": "streak_3",    "title": "On a Roll",           "desc": "Win 3 matches in a row.",         "tier": "silver",   "category": "streak",      "icon": "flame"},
    {"code": "streak_5",    "title": "Red Hot",             "desc": "Win 5 matches in a row.",         "tier": "gold",     "category": "streak",      "icon": "flame"},
    {"code": "streak_10",   "title": "Unstoppable",         "desc": "Win 10 matches in a row.",        "tier": "platinum", "category": "streak",      "icon": "flame"},
    {"code": "matches_10",  "title": "Contender",           "desc": "Play 10 matches.",                "tier": "bronze",   "category": "milestone",   "icon": "tennisball"},
    {"code": "matches_25",  "title": "Regular",             "desc": "Play 25 matches.",                "tier": "silver",   "category": "milestone",   "icon": "tennisball"},
    {"code": "matches_50",  "title": "Veteran",             "desc": "Play 50 matches.",                "tier": "gold",     "category": "milestone",   "icon": "tennisball"},
    {"code": "matches_100", "title": "Centurion",           "desc": "Play 100 matches.",               "tier": "platinum", "category": "milestone",   "icon": "tennisball"},
    {"code": "top_100",     "title": "Top 100",             "desc": "Break into the top 100.",         "tier": "bronze",   "category": "rank",        "icon": "podium"},
    {"code": "top_50",      "title": "Top 50",              "desc": "Break into the top 50.",          "tier": "silver",   "category": "rank",        "icon": "podium"},
    {"code": "top_10",      "title": "Top 10",              "desc": "Break into the top 10.",          "tier": "gold",     "category": "rank",        "icon": "podium"},
    {"code": "top_3",       "title": "Podium",              "desc": "Reach the top 3.",                "tier": "platinum", "category": "rank",        "icon": "medal"},
    {"code": "rank_1",      "title": "Number One",          "desc": "Reach #1 in the rankings.",       "tier": "diamond",  "category": "rank",        "icon": "trophy"},
    {"code": "league_champion",     "title": "League Champion",     "desc": "Win a league.",     "tier": "gold",     "category": "competition", "icon": "trophy"},
    {"code": "knockout_champion",   "title": "Knockout Champion",   "desc": "Win a knockout.",   "tier": "gold",     "category": "competition", "icon": "trophy"},
    {"code": "tournament_champion", "title": "Tournament Champion", "desc": "Win a tournament.", "tier": "platinum", "category": "competition", "icon": "trophy"},
    {"code": "multi_2",     "title": "Dual Threat",         "desc": "Get rated in 2 sports.",          "tier": "bronze",   "category": "multi",       "icon": "sparkles"},
    {"code": "multi_3",     "title": "Triple Threat",       "desc": "Get rated in 3 sports.",          "tier": "silver",   "category": "multi",       "icon": "sparkles"},
    {"code": "multi_5",     "title": "Complete Athlete",    "desc": "Compete across all 5 sports.",    "tier": "platinum", "category": "multi",       "icon": "star"},
]
ACH_BY_CODE = {a["code"]: a for a in ACHIEVEMENTS}


async def _compute_achievements(user_id: str) -> dict:
    ps_list = await DB.player_sports.find({"user_id": user_id}, {"_id": 0}).to_list(50)
    total_matches = await DB.matches.count_documents({"participants": user_id, "status": "verified"})
    unlocked: dict[str, dict] = {}

    def mark(code: str, detail: str = ""):
        if code not in unlocked:
            unlocked[code] = {"detail": detail}

    best_rank = None
    sports_played = 0
    for ps in ps_list:
        sport = SPORT_BY_ID.get(ps["sport_id"])
        if not sport:
            continue
        mp = ps.get("matches_played", 0)
        if mp > 0:
            sports_played += 1
        if ps.get("wins", 0) >= 1:
            mark("first_win", sport["name"])
        best = ps.get("best_streak", 0)
        for code in ("streak_3", "streak_5", "streak_10"):
            if best >= ACH_BY_CODE[code].get("threshold", int(code.split("_")[1])):
                mark(code, sport["name"])
        if mp >= 2 and ps.get("wins", 0) >= 1:
            mark("new_pb", sport["name"])
        rank, _pop = await _rank_for_user(user_id, ps["sport_id"], ps["rating"])
        if rank and (best_rank is None or rank < best_rank):
            best_rank = rank
        for code, n in (("top_100", 100), ("top_50", 50), ("top_10", 10), ("top_3", 3)):
            if rank and rank <= n:
                mark(code, f"#{rank} {sport['name']}")
        if rank == 1:
            mark("rank_1", sport["name"])

    for code, n in (("matches_10", 10), ("matches_25", 25), ("matches_50", 50), ("matches_100", 100)):
        if total_matches >= n:
            mark(code, f"{total_matches} matches")
    for code, n in (("multi_2", 2), ("multi_3", 3), ("multi_5", 5)):
        if sports_played >= n:
            mark(code, f"{sports_played} sports")

    # competition titles by type
    titles = await DB.competitions.find({"champion_ids": user_id}, {"_id": 0, "type": 1, "name": 1}).to_list(100)
    for c in titles:
        code = {"league": "league_champion", "knockout": "knockout_champion", "tournament": "tournament_champion"}.get(c.get("type"))
        if code:
            mark(code, c.get("name", ""))

    # upset win — any verified win as the lower-rated player
    won = await DB.matches.find(
        {"participants": user_id, "winner_user_id": user_id, "status": "verified", "rating_applied": True},
        {"_id": 0, "rating_changes": 1, "participants": 1},
    ).to_list(200)
    for m in won:
        rcs = m.get("rating_changes") or {}
        me = rcs.get(user_id)
        opp_ids = [p for p in m.get("participants", []) if p != user_id]
        opp = rcs.get(opp_ids[0]) if opp_ids else None
        if me and opp and me.get("before", 0) < opp.get("before", 0):
            mark("upset_win", "")
            break

    catalog = []
    for spec in ACHIEVEMENTS:
        u = unlocked.get(spec["code"])
        catalog.append({
            "code": spec["code"], "title": spec["title"], "desc": spec["desc"],
            "tier": spec["tier"], "category": spec["category"], "icon": spec["icon"],
            "unlocked": u is not None, "detail": (u or {}).get("detail", ""),
        })
    return {"catalog": catalog, "unlocked_count": len(unlocked), "total": len(ACHIEVEMENTS), "best_rank": best_rank}


@api.get("/me/dashboard")
async def dashboard(u: dict = Depends(current_user)):
    ps = await DB.player_sports.find({"user_id": u["id"]}, {"_id": 0}).sort("rating", -1).to_list(50)
    uas_info = await _uas_for_user(u["id"])
    cards = []
    for entry in ps:
        rank, total = await _rank_for_user(u["id"], entry["sport_id"], entry["rating"])
        pct = uas_info["percentiles"].get(entry["sport_id"], 0.0)
        sport = SPORT_BY_ID[entry["sport_id"]]
        card = {
            **entry,
            "sport_name": sport["name"],
            "decimals": sport["decimals"],
            "accent": sport["accent"],
            "rank": rank,
            "population": total,
            "percentile": pct,
            "band": band_for_percentile(pct),
        }
        card["insights"] = await _build_sport_insights(u["id"], card)
        cards.append(card)
    total_matches = await DB.matches.count_documents({"participants": u["id"], "status": "verified"})
    gamification = await _player_gamification(u["id"])
    ach = await _compute_achievements(u["id"])
    gamification["achievement_count"] = ach["unlocked_count"]
    gamification["achievement_total"] = ach["total"]
    return {
        "user": public_user(u),
        "uas": uas_info["uas"],
        "sports_counted": uas_info["sports_counted"],
        "total_matches": total_matches,
        "cards": cards,
        "gamification": gamification,
    }


@api.get("/me/achievements")
async def my_achievements(u: dict = Depends(current_user)):
    return await _compute_achievements(u["id"])


class ShareIn(BaseModel):
    kind: str
    headline: str
    subtext: Optional[str] = None
    icon: Optional[str] = None
    sport_id: Optional[str] = None


@api.post("/social/share")
async def social_share(body: ShareIn, u: dict = Depends(current_user)):
    doc = {
        "id": f"share_{uuid.uuid4()}", "user_id": u["id"], "kind": body.kind,
        "headline": body.headline, "subtext": body.subtext,
        "icon": body.icon or "megaphone", "sport_id": body.sport_id, "created_at": now_utc(),
    }
    await DB.feed_posts.insert_one(doc)
    return {"ok": True, "post": {k: v for k, v in doc.items() if k != "_id"}}


@api.get("/sports/{sport_id}")
async def sport_page(sport_id: str, u: dict = Depends(current_user)):
    if sport_id not in SPORT_BY_ID:
        raise HTTPException(404, "Sport not found")
    sport = SPORT_BY_ID[sport_id]
    ps = await DB.player_sports.find_one({"user_id": u["id"], "sport_id": sport_id}, {"_id": 0})

    # Leaderboard (top 50)
    lb_docs = await DB.player_sports.find({"sport_id": sport_id}, {"_id": 0}).sort("rating", -1).limit(50).to_list(50)
    lb_user_ids = [d["user_id"] for d in lb_docs]
    users = await DB.users.find({"id": {"$in": lb_user_ids}}, {"_id": 0, "id": 1, "display_name": 1, "city": 1, "username": 1}).to_list(200)
    umap = {x["id"]: x for x in users}
    leaderboard = []
    for i, d in enumerate(lb_docs, start=1):
        usr = umap.get(d["user_id"], {})
        leaderboard.append({
            "rank": i,
            "user_id": d["user_id"],
            "display_name": usr.get("display_name") or "Athlete",
            "city": usr.get("city"),
            "rating": d["rating"],
            "provisional": d.get("provisional", False),
            "is_me": d["user_id"] == u["id"],
        })

    # Recent matches for this user in this sport
    matches = await DB.matches.find(
        {"participants": u["id"], "sport_id": sport_id},
        {"_id": 0},
    ).sort("created_at", -1).limit(25).to_list(25)

    my_rank = None
    if ps:
        my_rank, _pop = await _rank_for_user(u["id"], sport_id, ps["rating"])

    return {
        "sport": sport,
        "player": ps,
        "my_rank": my_rank,
        "leaderboard": leaderboard,
        "matches": matches,
    }


# ---------- Rankings ----------
@api.get("/rankings/sport/{sport_id}")
async def rankings_sport(sport_id: str, limit: int = 100):
    if sport_id not in SPORT_BY_ID:
        raise HTTPException(404, "Sport not found")
    docs = await DB.player_sports.find({"sport_id": sport_id}, {"_id": 0}).sort("rating", -1).limit(limit).to_list(limit)
    user_ids = [d["user_id"] for d in docs]
    users = await DB.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "display_name": 1, "city": 1, "username": 1}).to_list(500)
    umap = {u["id"]: u for u in users}
    rows = []
    for i, d in enumerate(docs, start=1):
        usr = umap.get(d["user_id"], {})
        rows.append({
            "rank": i,
            "user_id": d["user_id"],
            "display_name": usr.get("display_name") or "Athlete",
            "username": usr.get("username"),
            "city": usr.get("city"),
            "rating": d["rating"],
            "provisional": d.get("provisional", False),
            "matches_played": d.get("matches_played", 0),
        })
    return {"sport": SPORT_BY_ID[sport_id], "rows": rows}


@api.get("/rankings/uas")
async def rankings_uas(limit: int = 100):
    # Aggregate: compute UAS for every user with at least one sport.
    pipeline = [{"$group": {"_id": "$user_id"}}]
    user_ids = [r["_id"] async for r in DB.player_sports.aggregate(pipeline)]
    scored = []
    for uid in user_ids:
        info = await _uas_for_user(uid)
        if info["sports_counted"] == 0: continue
        scored.append({"user_id": uid, "uas": info["uas"], "sports_counted": info["sports_counted"]})
    scored.sort(key=lambda x: (-x["uas"], -x["sports_counted"]))
    scored = scored[:limit]
    users = await DB.users.find({"id": {"$in": [s["user_id"] for s in scored]}}, {"_id": 0, "id": 1, "display_name": 1, "city": 1}).to_list(500)
    umap = {u["id"]: u for u in users}
    rows = []
    for i, s in enumerate(scored, start=1):
        u = umap.get(s["user_id"], {})
        rows.append({
            "rank": i, "user_id": s["user_id"], "uas": s["uas"], "sports_counted": s["sports_counted"],
            "display_name": u.get("display_name") or "Athlete", "city": u.get("city"),
        })
    return {"rows": rows}


# ---------- Opponent search ----------
@api.get("/opponents/search")
async def opponents_search(sport_id: str, q: str = "", u: dict = Depends(current_user)):
    q = (q or "").strip().lower()
    filt: dict[str, Any] = {"sport_id": sport_id, "user_id": {"$ne": u["id"]}}
    ps_docs = await DB.player_sports.find(filt, {"_id": 0}).sort("rating", -1).to_list(500)
    if not ps_docs:
        return {"opponents": []}
    users = await DB.users.find(
        {"id": {"$in": [d["user_id"] for d in ps_docs]}},
        {"_id": 0, "id": 1, "display_name": 1, "username": 1, "city": 1},
    ).to_list(500)
    umap = {u["id"]: u for u in users}
    out = []
    for d in ps_docs:
        usr = umap.get(d["user_id"]) or {}
        name = (usr.get("display_name") or "").lower()
        uname = (usr.get("username") or "").lower()
        if q and q not in name and q not in uname:
            continue
        out.append({
            "user_id": d["user_id"],
            "display_name": usr.get("display_name") or "Athlete",
            "username": usr.get("username"),
            "city": usr.get("city"),
            "rating": d["rating"],
            "provisional": d.get("provisional", False),
        })
        if len(out) >= 40: break
    return {"opponents": out}


# ---------- Match preview & submit ----------
async def _get_ps(user_id: str, sport_id: str) -> Optional[dict]:
    return await DB.player_sports.find_one({"user_id": user_id, "sport_id": sport_id}, {"_id": 0})


@api.post("/matches/preview")
async def match_preview(body: MatchPreviewIn, u: dict = Depends(current_user)):
    if body.sport_id not in SPORT_BY_ID:
        raise HTTPException(404, "Sport not found")
    my_ps = await _get_ps(u["id"], body.sport_id)
    if not my_ps:
        raise HTTPException(400, "You have no rating for this sport")
    opp_ps = await _get_ps(body.opponent_user_id, body.sport_id)
    if not opp_ps:
        raise HTTPException(400, "Opponent has no rating for this sport")

    parsed = validate_score(body.sport_id, body.games)
    # side 0 = me, side 1 = opponent
    winner_is_me = parsed["winner_side"] == 0
    winner_rating = my_ps["rating"] if winner_is_me else opp_ps["rating"]
    loser_rating = opp_ps["rating"] if winner_is_me else my_ps["rating"]
    population = await _population_ratings(body.sport_id)
    is_provisional = my_ps.get("provisional") or opp_ps.get("provisional")
    calc = compute_rating_change(
        body.sport_id, winner_rating, loser_rating,
        parsed["unit_diff"], parsed["unit_total"],
        parsed["point_diff"], parsed["point_total"],
        population, provisional=is_provisional,
    )
    tag = rating_tag(calc["expected_winner"], calc["margin_score"])
    sport = SPORT_BY_ID[body.sport_id]
    dec = sport["decimals"]

    def r(x): return round(x, dec)

    return {
        "sport": sport,
        "my_rating": r(my_ps["rating"]),
        "opponent_rating": r(opp_ps["rating"]),
        "winner_is_me": winner_is_me,
        "expected_winner_prob": calc["expected_winner"],
        "margin_score": calc["margin_score"],
        "delta": r(calc["delta"]),
        "new_my_rating": r(calc["new_winner"] if winner_is_me else calc["new_loser"]),
        "new_opponent_rating": r(calc["new_loser"] if winner_is_me else calc["new_winner"]),
        "tag": tag,
        "parsed": parsed,
        "provisional": bool(is_provisional),
    }


@api.post("/matches/submit")
async def match_submit(body: MatchSubmitIn, u: dict = Depends(current_user)):
    if u.get("is_guest"):
        raise HTTPException(403, "Guests can preview but not submit verified matches")
    preview = await match_preview(MatchPreviewIn(**body.dict()), u)
    parsed = preview["parsed"]
    match_id = str(uuid.uuid4())
    doc = {
        "id": match_id,
        "sport_id": body.sport_id,
        "participants": [u["id"], body.opponent_user_id],
        "sides": [
            {"side": 0, "user_ids": [u["id"]]},
            {"side": 1, "user_ids": [body.opponent_user_id]},
        ],
        "games": body.games,
        "side_wins": parsed["side_wins"],
        "total_points": parsed["total_points"],
        "winner_user_id": u["id"] if preview["winner_is_me"] else body.opponent_user_id,
        "submitted_by": u["id"],
        "status": "pending_confirmation",
        "preview": {
            "delta": preview["delta"],
            "tag": preview["tag"],
            "expected_winner_prob": preview["expected_winner_prob"],
            "margin_score": preview["margin_score"],
            "provisional": preview["provisional"],
        },
        "note": body.note,
        "created_at": now_utc(),
    }
    # Auto-verify against seed opponents so demo flows show results immediately.
    opp_user = await DB.users.find_one({"id": body.opponent_user_id}, {"_id": 0})
    if opp_user and opp_user.get("is_seed"):
        doc["status"] = "verified"
    await DB.matches.insert_one(doc)

    if doc["status"] == "verified":
        await _apply_verified_match(match_id)
        applied = await DB.matches.find_one({"id": match_id}, {"_id": 0})
        rc = (applied or {}).get("rating_changes", {}).get(u["id"], {})
        return {"match": applied, "rating_change": rc}
    return {"match": {k: v for k, v in doc.items() if k != "_id"}, "rating_change": None}


async def _apply_verified_match(match_id: str) -> None:
    m = await DB.matches.find_one({"id": match_id}, {"_id": 0})
    if not m or m.get("rating_applied"):
        return
    sport_id = m["sport_id"]
    winner_id = m["winner_user_id"]
    loser_id = [p for p in m["participants"] if p != winner_id][0]
    w_ps = await _get_ps(winner_id, sport_id)
    l_ps = await _get_ps(loser_id, sport_id)
    if not w_ps or not l_ps: return
    population = await _population_ratings(sport_id)
    is_provisional = w_ps.get("provisional") or l_ps.get("provisional")
    parsed = {
        "unit_diff": abs(m["side_wins"][0] - m["side_wins"][1]),
        "unit_total": sum(m["side_wins"]),
        "point_diff": abs(m["total_points"][0] - m["total_points"][1]),
        "point_total": sum(m["total_points"]),
    }
    calc = compute_rating_change(
        sport_id, w_ps["rating"], l_ps["rating"],
        parsed["unit_diff"], parsed["unit_total"], parsed["point_diff"], parsed["point_total"],
        population, provisional=is_provisional,
    )
    sport = SPORT_BY_ID[sport_id]
    dec = sport["decimals"]

    rating_changes: dict[str, Any] = {}
    for user_ps, new_rating, is_winner in [
        (w_ps, round(calc["new_winner"], dec), True),
        (l_ps, round(calc["new_loser"], dec), False),
    ]:
        matches_played = user_ps.get("matches_played", 0) + 1
        wins = user_ps.get("wins", 0) + (1 if is_winner else 0)
        peak = max(user_ps.get("peak_rating", new_rating), new_rating)
        new_peak = new_rating > user_ps.get("peak_rating", 0)
        still_provisional = user_ps.get("provisional", True) and matches_played < 5
        # streaks
        prev_streak = user_ps.get("current_streak", 0)
        if is_winner:
            cur_streak = prev_streak + 1 if prev_streak >= 0 else 1
        else:
            cur_streak = prev_streak - 1 if prev_streak <= 0 else -1
        best_streak = max(user_ps.get("best_streak", 0), cur_streak)
        # recent form (list of 'W'/'L', newest last, keep 5)
        form = (user_ps.get("recent_form") or [])[-4:] + ["W" if is_winner else "L"]
        await DB.player_sports.update_one(
            {"user_id": user_ps["user_id"], "sport_id": sport_id},
            {"$set": {
                "rating": new_rating,
                "peak_rating": peak,
                "matches_played": matches_played,
                "wins": wins,
                "provisional": still_provisional,
                "current_streak": cur_streak,
                "best_streak": best_streak,
                "recent_form": form,
            }},
        )
        await DB.rating_history.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_ps["user_id"],
            "sport_id": sport_id,
            "before": user_ps["rating"],
            "after": new_rating,
            "delta": round(new_rating - user_ps["rating"], dec),
            "match_id": match_id,
            "created_at": now_utc(),
        })
        rating_changes[user_ps["user_id"]] = {
            "before": round(user_ps["rating"], dec),
            "after": new_rating,
            "delta": round(new_rating - user_ps["rating"], dec),
            "is_winner": is_winner,
            "new_peak": bool(new_peak and matches_played > 1),
            "streak": cur_streak,
            "level_up": still_provisional is False and user_ps.get("provisional", True) is True,
        }

    await DB.matches.update_one(
        {"id": match_id},
        {"$set": {"rating_applied": True, "status": "verified", "rating_changes": rating_changes}},
    )
    for uid, rc in rating_changes.items():
        rnk, _pop = await _rank_for_user(uid, sport_id, rc["after"])
        await DB.rating_history.update_one({"match_id": match_id, "user_id": uid}, {"$set": {"rank": rnk}})
    # Competition fixture progression
    m2 = await DB.matches.find_one({"id": match_id}, {"_id": 0})
    if m2 and m2.get("fixture_id"):
        await _progress_fixture(m2["fixture_id"], match_id)



@api.post("/matches/confirm")
async def match_confirm(body: MatchConfirmIn, u: dict = Depends(current_user)):
    m = await DB.matches.find_one({"id": body.match_id}, {"_id": 0})
    if not m: raise HTTPException(404, "Match not found")
    if u["id"] not in m["participants"] or u["id"] == m["submitted_by"]:
        raise HTTPException(403, "Only the opponent can confirm/dispute")
    if m["status"] != "pending_confirmation":
        raise HTTPException(400, f"Match already {m['status']}")
    if body.action == "verify":
        await _apply_verified_match(body.match_id)
        return {"status": "verified"}
    if body.action == "dispute":
        await DB.matches.update_one({"id": body.match_id}, {"$set": {"status": "disputed"}})
        return {"status": "disputed"}
    raise HTTPException(400, "Unknown action")


@api.get("/matches/mine")
async def matches_mine(u: dict = Depends(current_user)):
    docs = await DB.matches.find({"participants": u["id"]}, {"_id": 0}).sort("created_at", -1).limit(50).to_list(50)
    # Enrich with opponent names
    other_ids = list({p for m in docs for p in m["participants"] if p != u["id"]})
    users = await DB.users.find({"id": {"$in": other_ids}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}).to_list(500)
    umap = {x["id"]: x for x in users}
    out = []
    for m in docs:
        other = [p for p in m["participants"] if p != u["id"]][0]
        out.append({**m, "opponent": umap.get(other, {"id": other, "display_name": "Unknown"})})
    return {"matches": out}


@api.get("/events/upcoming")
async def upcoming_events(
    sport_id: Optional[str] = None,
    country: Optional[str] = None,
    city: Optional[str] = None,
    paid: Optional[str] = None,        # "free" | "paid"
    date: Optional[str] = None,        # YYYY-MM-DD (event day)
    near_city: Optional[str] = None,   # prioritise this city first
    u: dict = Depends(current_user),
):
    filt: dict[str, Any] = {"visibility": "public", "status": "open"}
    if sport_id and sport_id in SPORT_BY_ID:
        filt["sport_id"] = sport_id
    if country:
        filt["country"] = country
    if city:
        filt["city"] = city
    if paid == "free":
        filt["is_paid"] = False
    elif paid == "paid":
        filt["is_paid"] = True
    docs = await DB.events.find(filt, {"_id": 0}).sort("starts_at", 1).limit(150).to_list(150)

    if date:
        docs = [e for e in docs if (e.get("starts_at") or "")[:10] == date]

    ref = (near_city or "").strip().lower()

    def out_event(e: dict) -> dict:
        same = bool(ref and (e.get("city") or "").strip().lower() == ref)
        return {
            **e,
            "registered": len(e.get("registered_user_ids", [])),
            "is_registered": u["id"] in e.get("registered_user_ids", []),
            "entry_fee": f'{e.get("fee")} {e.get("currency")}' if e.get("is_paid") else "FREE",
            "same_city": same,
        }

    events = [out_event(e) for e in docs]
    if ref:
        events.sort(key=lambda x: (not x["same_city"], x.get("starts_at") or ""))
    return {"events": events}


@api.get("/athletes/{athlete_id}")
async def athlete_profile(athlete_id: str, _u: dict = Depends(current_user)):
    usr = await DB.users.find_one({"id": athlete_id}, {"_id": 0})
    if not usr:
        raise HTTPException(404, "Athlete not found")
    ps = await DB.player_sports.find({"user_id": athlete_id}, {"_id": 0}).sort("rating", -1).to_list(50)
    uas_info = await _uas_for_user(athlete_id)
    cards = []
    for entry in ps:
        rank, total = await _rank_for_user(athlete_id, entry["sport_id"], entry["rating"])
        pct = uas_info["percentiles"].get(entry["sport_id"], 0.0)
        sport = SPORT_BY_ID[entry["sport_id"]]
        cards.append({
            **entry, "sport_name": sport["name"], "decimals": sport["decimals"],
            "accent": sport["accent"], "rank": rank, "population": total,
            "percentile": pct, "band": band_for_percentile(pct),
        })
    return {
        "user": {"id": usr["id"], "display_name": usr.get("display_name"), "username": usr.get("username"), "city": usr.get("city"), "bio": usr.get("bio")},
        "uas": uas_info["uas"], "cards": cards,
    }


@api.get("/social/feed")
async def social_feed(u: dict = Depends(current_user)):
    users = await DB.users.find({}, {"_id": 0, "id": 1, "display_name": 1}).to_list(500)
    umap = {x["id"]: x.get("display_name", "Athlete") for x in users}
    items: list[dict] = []

    # 1) recent verified match results
    matches = await DB.matches.find({"status": "verified"}, {"_id": 0}).sort("created_at", -1).limit(30).to_list(30)
    for m in matches:
        if m.get("winner_user_id") is None:
            continue
        winner = umap.get(m["winner_user_id"], "Athlete")
        losers = [p for p in m["participants"] if p != m["winner_user_id"]]
        loser = umap.get(losers[0], "Athlete") if losers else "Athlete"
        rc = (m.get("rating_changes") or {}).get(m["winner_user_id"], {})
        items.append({
            "id": m["id"], "type": "match_result", "sport_id": m["sport_id"],
            "actor_id": m["winner_user_id"], "actor_name": winner,
            "text": f"{winner} beat {loser}",
            "score": " · ".join([f"{g[0]}-{g[1]}" for g in m.get("games", [])]),
            "rating_delta": rc.get("delta"),
            "match_id": m["id"],
            "created_at": m["created_at"].isoformat() if isinstance(m.get("created_at"), datetime) else m.get("created_at"),
        })

    # 2) competition champions (wins & milestones)
    champs = await DB.competitions.find({"status": "complete", "champion_ids": {"$exists": True, "$ne": None}}, {"_id": 0}).sort("created_at", -1).limit(10).to_list(10)
    for c in champs:
        cid_list = c.get("champion_ids") or []
        name = umap.get(cid_list[0], "Athlete") if cid_list else "Athlete"
        items.append({
            "id": f"champ_{c['id']}", "type": "competition_win", "sport_id": c["sport_id"],
            "actor_id": cid_list[0] if cid_list else None, "actor_name": name,
            "text": f"{name} won {c['name']}", "score": "🏆 CHAMPION",
            "created_at": c.get("created_at").isoformat() if isinstance(c.get("created_at"), datetime) else c.get("created_at"),
        })

    # 3) personal bests — players currently sitting at their peak rating
    pbs = await DB.player_sports.find(
        {"provisional": {"$ne": True}, "matches_played": {"$gte": 3}}, {"_id": 0}
    ).sort("updated_at", -1).limit(40).to_list(40)
    for p in pbs:
        rating = float(p.get("rating", 0))
        peak = float(p.get("peak_rating", 0))
        if peak <= 0 or abs(rating - peak) > 1e-6:
            continue
        sport = SPORT_BY_ID.get(p["sport_id"])
        if not sport:
            continue
        name = umap.get(p["user_id"], "Athlete")
        val = round(rating) if sport["decimals"] == 0 else round(rating, sport["decimals"])
        items.append({
            "id": f"pb_{p['user_id']}_{p['sport_id']}", "type": "personal_best", "sport_id": p["sport_id"],
            "actor_id": p["user_id"], "actor_name": name,
            "text": f"{name} hit a personal best in {sport['name']}", "score": f"PEAK {val}",
            "created_at": p.get("updated_at").isoformat() if isinstance(p.get("updated_at"), datetime) else p.get("created_at"),
        })

    # 4) looking to play — active social invites
    ltps = await DB.ltp_posts.find({"status": "open"}, {"_id": 0}).sort("created_at", -1).limit(15).to_list(15)
    for lp in ltps:
        sport = SPORT_BY_ID.get(lp["sport_id"])
        if not sport:
            continue
        name = umap.get(lp["user_id"], "Athlete")
        items.append({
            "id": f"ltp_{lp['id']}", "type": "looking_to_play", "sport_id": lp["sport_id"],
            "actor_id": lp["user_id"], "actor_name": name,
            "text": f"{name} is looking to play {sport['name']}",
            "score": f"{lp.get('when_text', '')} · {lp.get('area', '')}".strip(" ·"),
            "created_at": lp.get("created_at").isoformat() if isinstance(lp.get("created_at"), datetime) else lp.get("created_at"),
        })

    # 5) user-shared highlights (achievements, PBs, streaks, rank jumps, wins)
    shares = await DB.feed_posts.find({}, {"_id": 0}).sort("created_at", -1).limit(30).to_list(30)
    for s in shares:
        name = umap.get(s["user_id"], "Athlete")
        items.append({
            "id": s["id"], "type": "highlight", "sport_id": s.get("sport_id"),
            "actor_id": s["user_id"], "actor_name": name,
            "text": f"{name} · {s['headline']}",
            "score": s.get("subtext") or "",
            "icon": s.get("icon", "megaphone"), "kind": s.get("kind"),
            "created_at": s.get("created_at").isoformat() if isinstance(s.get("created_at"), datetime) else s.get("created_at"),
        })

    items.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    items = items[:50]

    # attach like/comment counts + my-like state
    ids = [it["id"] for it in items]
    likes = await DB.feed_likes.find({"item_id": {"$in": ids}}, {"_id": 0}).to_list(2000)
    comments = await DB.feed_comments.find({"item_id": {"$in": ids}}, {"_id": 0}).to_list(2000)
    like_count: dict[str, int] = {}
    liked_me: set[str] = set()
    for l in likes:
        like_count[l["item_id"]] = like_count.get(l["item_id"], 0) + 1
        if l["user_id"] == u["id"]:
            liked_me.add(l["item_id"])
    comment_count: dict[str, int] = {}
    for cm in comments:
        comment_count[cm["item_id"]] = comment_count.get(cm["item_id"], 0) + 1
    for it in items:
        it["like_count"] = like_count.get(it["id"], 0)
        it["liked_by_me"] = it["id"] in liked_me
        it["comment_count"] = comment_count.get(it["id"], 0)
    return {"items": items}


@api.post("/social/feed/{item_id}/like")
async def feed_like(item_id: str, u: dict = Depends(current_user)):
    if u.get("is_guest"):
        raise HTTPException(403, "Create an account to react")
    existing = await DB.feed_likes.find_one({"item_id": item_id, "user_id": u["id"]})
    if existing:
        await DB.feed_likes.delete_one({"item_id": item_id, "user_id": u["id"]})
        liked = False
    else:
        await DB.feed_likes.insert_one({"id": str(uuid.uuid4()), "item_id": item_id, "user_id": u["id"], "created_at": now_utc()})
        liked = True
    count = await DB.feed_likes.count_documents({"item_id": item_id})
    return {"liked": liked, "like_count": count}


class FeedCommentIn(BaseModel):
    text: str


@api.get("/social/feed/{item_id}/comments")
async def feed_comments_list(item_id: str, u: dict = Depends(current_user)):
    docs = await DB.feed_comments.find({"item_id": item_id}, {"_id": 0}).sort("created_at", 1).limit(200).to_list(200)
    uids = list({d["user_id"] for d in docs})
    users = await DB.users.find({"id": {"$in": uids}}, {"_id": 0, "id": 1, "display_name": 1}).to_list(200)
    umap = {x["id"]: x.get("display_name", "Athlete") for x in users}
    return {"comments": [{"id": d["id"], "user_id": d["user_id"], "name": umap.get(d["user_id"], "Athlete"),
                          "text": d["text"],
                          "created_at": d["created_at"].isoformat() if isinstance(d.get("created_at"), datetime) else d.get("created_at")} for d in docs]}


@api.post("/social/feed/{item_id}/comment")
async def feed_comment(item_id: str, body: FeedCommentIn, u: dict = Depends(current_user)):
    if u.get("is_guest"):
        raise HTTPException(403, "Create an account to comment")
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "Comment cannot be empty")
    doc = {"id": str(uuid.uuid4()), "item_id": item_id, "user_id": u["id"], "text": text[:500], "created_at": now_utc()}
    await DB.feed_comments.insert_one(doc)
    count = await DB.feed_comments.count_documents({"item_id": item_id})
    return {"ok": True, "comment_count": count}


# ==================== AUTO-ADD SPORT ====================
async def ensure_player_sport(user_id: str, sport_id: str) -> dict:
    ps = await DB.player_sports.find_one({"user_id": user_id, "sport_id": sport_id}, {"_id": 0})
    if ps:
        return ps
    # Auto-add with a deliberately low provisional rating (beginner band).
    rating = await _provisional_from_level(sport_id, "beginner")
    doc = {
        "id": str(uuid.uuid4()), "user_id": user_id, "sport_id": sport_id,
        "rating": rating, "peak_rating": rating, "provisional": True,
        "matches_played": 0, "wins": 0, "level_id": "beginner", "external": None,
        "current_streak": 0, "best_streak": 0, "recent_form": [],
        "auto_added": True, "created_at": now_utc(),
    }
    await DB.player_sports.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@api.post("/player-sports/ensure")
async def ensure_sport_endpoint(sport_id: str, u: dict = Depends(current_user)):
    if sport_id not in SPORT_BY_ID:
        raise HTTPException(404, "Unknown sport")
    ps = await ensure_player_sport(u["id"], sport_id)
    return {"player_sport": ps, "sport": SPORT_BY_ID[sport_id]}


# ==================== SCORING CONFIG ====================
@api.get("/scoring/config")
async def scoring_config():
    return {"rules": scoring.SPORT_RULES}


# ==================== GENERAL RESULT FINALIZER (live, doubles-aware) ====================
async def _apply_result_general(match_id: str) -> None:
    m = await DB.matches.find_one({"id": match_id}, {"_id": 0})
    if not m or m.get("rating_applied"):
        return
    sport_id = m["sport_id"]
    sport = SPORT_BY_ID[sport_id]
    dec = sport["decimals"]
    sides = m["sides"]  # [{side, user_ids:[...]}, ...]
    winner_side = m["winner_side"]

    # ensure everyone has the sport & gather ratings
    side_players: list[list[dict]] = []
    for s in sides:
        players = []
        for uid in s["user_ids"]:
            ps = await ensure_player_sport(uid, sport_id)
            players.append(ps)
        side_players.append(players)

    def side_avg(players): return sum(p["rating"] for p in players) / max(1, len(players))
    win_players = side_players[winner_side]
    lose_players = side_players[1 - winner_side]
    win_rating = side_avg(win_players)
    lose_rating = side_avg(lose_players)
    population = await _population_ratings(sport_id)
    is_provisional = any(p.get("provisional") for p in win_players + lose_players)

    su = scoring.summary(m["state"]) if m.get("state") else {
        "unit_diff": abs(m["side_wins"][0] - m["side_wins"][1]), "unit_total": max(1, sum(m["side_wins"])),
        "point_diff": abs(m["total_points"][0] - m["total_points"][1]), "point_total": max(1, sum(m["total_points"])),
    }
    calc = compute_rating_change(
        sport_id, win_rating, lose_rating,
        su["unit_diff"], su["unit_total"], su["point_diff"], su["point_total"],
        population, provisional=is_provisional,
    )
    delta = calc["delta"]
    rating_changes: dict[str, Any] = {}

    for players, is_winner in [(win_players, True), (lose_players, False)]:
        per_player_delta = delta / max(1, len(players))
        for ps in players:
            before = ps["rating"]
            after = round(max(0.0, before + per_player_delta) if is_winner else max(0.0, before - per_player_delta), dec)
            matches_played = ps.get("matches_played", 0) + 1
            wins = ps.get("wins", 0) + (1 if is_winner else 0)
            new_peak_flag = after > ps.get("peak_rating", 0) and matches_played > 1
            peak = max(ps.get("peak_rating", after), after)
            was_provisional = ps.get("provisional", True)
            still_prov = was_provisional and matches_played < 5
            prev_streak = ps.get("current_streak", 0)
            cur_streak = (prev_streak + 1 if prev_streak >= 0 else 1) if is_winner else (prev_streak - 1 if prev_streak <= 0 else -1)
            best_streak = max(ps.get("best_streak", 0), cur_streak)
            form = (ps.get("recent_form") or [])[-4:] + ["W" if is_winner else "L"]
            await DB.player_sports.update_one(
                {"user_id": ps["user_id"], "sport_id": sport_id},
                {"$set": {
                    "rating": after, "peak_rating": peak, "matches_played": matches_played,
                    "wins": wins, "provisional": still_prov, "current_streak": cur_streak,
                    "best_streak": best_streak, "recent_form": form,
                }},
            )
            await DB.rating_history.insert_one({
                "id": str(uuid.uuid4()), "user_id": ps["user_id"], "sport_id": sport_id,
                "before": before, "after": after, "delta": round(after - before, dec),
                "match_id": match_id, "created_at": now_utc(),
            })
            rating_changes[ps["user_id"]] = {
                "before": round(before, dec), "after": after, "delta": round(after - before, dec),
                "is_winner": is_winner, "new_peak": bool(new_peak_flag),
                "streak": cur_streak, "level_up": bool(was_provisional and not still_prov),
            }

    await DB.matches.update_one({"id": match_id}, {"$set": {"rating_applied": True, "status": "verified", "rating_changes": rating_changes}})
    for uid, rc in rating_changes.items():
        rnk, _pop = await _rank_for_user(uid, sport_id, rc["after"])
        await DB.rating_history.update_one({"match_id": match_id, "user_id": uid}, {"$set": {"rank": rnk}})
    if m.get("fixture_id"):
        await _progress_fixture(m["fixture_id"], match_id)


# ==================== LIVE SCORING ====================
class LiveCreateIn(BaseModel):
    sport_id: str
    doubles: bool = False
    best_of: int
    first_server_side: int = 0
    golden_point: bool = False
    padel_scoring: str = "advantage"  # advantage | golden_point | star_point
    warmup_seconds: int = 0  # legacy input accepted, never used for live flow
    competition_id: Optional[str] = None
    fixture_id: Optional[str] = None
    side0_user_ids: list[str] = []
    side1_user_ids: list[str] = []
    side0_label: Optional[str] = None
    side1_label: Optional[str] = None


class LiveEventIn(BaseModel):
    type: str
    side: Optional[int] = None
    note: Optional[str] = None


async def _label_for_side(user_ids: list[str], fallback: str) -> str:
    if not user_ids:
        return fallback
    users = await DB.users.find({"id": {"$in": user_ids}}, {"_id": 0, "display_name": 1}).to_list(10)
    names = [u.get("display_name", "Player") for u in users]
    return " / ".join(names) if names else fallback


@api.post("/live/create")
async def live_create(body: LiveCreateIn, u: dict = Depends(current_user)):
    if body.sport_id not in SPORT_BY_ID:
        raise HTTPException(404, "Unknown sport")
    if u.get("is_guest"):
        raise HTTPException(403, "Create an account to run live matches")
    await ensure_player_sport(u["id"], body.sport_id)
    s0 = body.side0_user_ids or [u["id"]]
    s1 = body.side1_user_ids or []
    if not s1:
        raise HTTPException(400, "Opponent required")
    for uid in s0 + s1:
        await ensure_player_sport(uid, body.sport_id)
    sides = [
        {"side": 0, "user_ids": s0, "label": body.side0_label or await _label_for_side(s0, "You")},
        {"side": 1, "user_ids": s1, "label": body.side1_label or await _label_for_side(s1, "Opponent")},
    ]
    state = scoring.new_state(
        body.sport_id, sides, body.best_of, body.doubles,
        body.first_server_side, {"golden_point": body.golden_point, "padel_scoring": body.padel_scoring},
    )
    live_id = str(uuid.uuid4())
    doc = {
        "id": live_id, "sport_id": body.sport_id, "owner_id": u["id"],
        "participants": s0 + s1, "sides": sides, "state": state,
        "competition_id": body.competition_id, "fixture_id": body.fixture_id,
        "warmup_seconds": body.warmup_seconds, "status": "in_progress",
        "created_at": now_utc(), "updated_at": now_utc(),
    }
    await DB.live_matches.insert_one(doc)
    return {"live_id": live_id, "display": scoring.display(state), "sides": sides, "state_meta": {"sport": SPORT_BY_ID[body.sport_id]}}


@api.get("/live/{live_id}")
async def live_get(live_id: str, u: dict = Depends(current_user)):
    lm = await DB.live_matches.find_one({"id": live_id}, {"_id": 0})
    if not lm:
        raise HTTPException(404, "Live match not found")
    sanitized_state = {k: v for k, v in lm["state"].items() if k != "log"}
    sanitized_state["log"] = []
    return {"live_id": live_id, "sport": SPORT_BY_ID[lm["sport_id"]], "sides": lm["sides"],
            "display": scoring.display(lm["state"]), "status": lm["status"],
            "state": sanitized_state,
            "warmup_seconds": lm.get("warmup_seconds", 0), "competition_id": lm.get("competition_id"),
            "log": [{"seq": e["seq"], "type": e["type"], "side": e.get("side"), "scored_side": e.get("scored_side"), "note": e.get("note")} for e in lm["state"]["log"][-30:]]}


@api.post("/live/{live_id}/event")
async def live_event(live_id: str, body: LiveEventIn, u: dict = Depends(current_user)):
    lm = await DB.live_matches.find_one({"id": live_id}, {"_id": 0})
    if not lm:
        raise HTTPException(404, "Live match not found")
    if lm["status"] != "in_progress":
        raise HTTPException(400, "Match not in progress")
    state = scoring.apply_event(lm["state"], body.type, body.side, body.note)
    await DB.live_matches.update_one({"id": live_id}, {"$set": {"state": state, "updated_at": now_utc()}})
    disp = scoring.display(state)
    return {"display": disp, "completed": state["status"] == "completed", "winner_side": state["winner_side"]}


@api.post("/live/{live_id}/finalize")
async def live_finalize(live_id: str, u: dict = Depends(current_user)):
    lm = await DB.live_matches.find_one({"id": live_id}, {"_id": 0})
    if not lm:
        raise HTTPException(404, "Live match not found")
    state = lm["state"]
    if state["status"] != "completed":
        raise HTTPException(400, "Match not complete yet")
    su = scoring.summary(state)
    winner_side = su["winner_side"]
    winner_uids = lm["sides"][winner_side]["user_ids"]
    match_id = str(uuid.uuid4())
    doc = {
        "id": match_id, "sport_id": lm["sport_id"], "participants": lm["participants"],
        "sides": lm["sides"], "games": state["games"], "state": state,
        "side_wins": su["side_wins"], "total_points": su["total_points"],
        "winner_side": winner_side, "winner_user_id": winner_uids[0] if winner_uids else None,
        "submitted_by": lm["owner_id"], "status": "verified", "source": "live",
        "competition_id": lm.get("competition_id"), "fixture_id": lm.get("fixture_id"),
        "created_at": now_utc(),
    }
    await DB.matches.insert_one(doc)
    await _apply_result_general(match_id)
    await DB.live_matches.update_one({"id": live_id}, {"$set": {"status": "completed", "match_id": match_id}})
    final = await DB.matches.find_one({"id": match_id}, {"_id": 0})
    return {"match_id": match_id, "rating_changes": final.get("rating_changes", {}),
            "sides": lm["sides"], "games": state["games"], "winner_side": winner_side,
            "sport": SPORT_BY_ID[lm["sport_id"]]}


@api.post("/live/{live_id}/abandon")
async def live_abandon(live_id: str, u: dict = Depends(current_user)):
    await DB.live_matches.update_one({"id": live_id}, {"$set": {"status": "abandoned"}})
    return {"ok": True}


@api.get("/live/mine/active")
async def live_mine(u: dict = Depends(current_user)):
    docs = await DB.live_matches.find({"owner_id": u["id"], "status": "in_progress"}, {"_id": 0}).sort("updated_at", -1).to_list(20)
    out = []
    for d in docs:
        out.append({"live_id": d["id"], "sport": SPORT_BY_ID[d["sport_id"]], "sides": d["sides"],
                    "display": scoring.display(d["state"]), "competition_id": d.get("competition_id")})
    return {"live_matches": out}


# ==================== COMPETITIONS ====================
class CompetitionCreateIn(BaseModel):
    name: str
    sport_id: str
    type: str  # league | knockout | tournament
    visibility: str = "private"  # private by default; events own public discovery
    city: Optional[str] = None  # retained for old clients; not required for competitions
    venue: Optional[str] = None  # retained for backward-compatible payloads
    entry_fee: Optional[str] = None
    currency: Optional[str] = "USD"
    matches_per_opponent: int = 1
    points_win: int = 3
    points_loss: int = 0
    playoff_qualifiers: int = 0  # 0=no playoffs, else 2/4/8/16
    max_participants: int = 16
    fixture_mode: str = "automatic"  # automatic | manual
    draw_mode: str = "rating"  # rating | random | manual
    manual_pairs: list[list[str]] = []


@api.post("/competitions/create")
async def competition_create(body: CompetitionCreateIn, u: dict = Depends(current_user)):
    if body.sport_id not in SPORT_BY_ID:
        raise HTTPException(404, "Unknown sport")
    if u.get("is_guest"):
        raise HTTPException(403, "Create an account to organise competitions")
    if body.type not in ("league", "knockout"):
        raise HTTPException(400, "Competition type must be league or knockout")
    if body.fixture_mode not in ("automatic", "manual"):
        raise HTTPException(400, "Fixture mode must be automatic or manual")
    if body.draw_mode not in ("rating", "random", "manual"):
        raise HTTPException(400, "Invalid knockout draw mode")
    cid = str(uuid.uuid4())
    doc = {
        "id": cid, "name": body.name, "sport_id": body.sport_id, "type": body.type,
        "visibility": body.visibility, "city": body.city, "venue": body.venue,
        "entry_fee": body.entry_fee, "currency": body.currency,
        "matches_per_opponent": body.matches_per_opponent,
        "fixture_mode": body.fixture_mode, "draw_mode": body.draw_mode,
        "manual_pairs": body.manual_pairs,
        "points_win": body.points_win, "points_loss": body.points_loss,
        "playoff_qualifiers": body.playoff_qualifiers, "max_participants": body.max_participants,
        "organiser_id": u["id"], "status": "registration_open", "fixtures_generated": False,
        "created_at": now_utc(),
    }
    await DB.competitions.insert_one(dict(doc))
    await DB.competition_members.insert_one({
        "id": str(uuid.uuid4()), "competition_id": cid, "user_id": u["id"],
        "status": "approved", "role": "organiser", "joined_at": now_utc(),
    })
    doc.pop("_id", None)
    return {"competition": {k: v for k, v in doc.items() if k != "_id"}}


async def _competition_public(c: dict, u_id: Optional[str] = None) -> dict:
    members = await DB.competition_members.find({"competition_id": c["id"], "status": "approved"}, {"_id": 0}).to_list(200)
    member_ids = [m["user_id"] for m in members]
    users = await DB.users.find({"id": {"$in": member_ids}}, {"_id": 0, "id": 1, "display_name": 1, "city": 1}).to_list(200)
    umap = {x["id"]: x for x in users}
    return {
        **c, "sport": SPORT_BY_ID[c["sport_id"]],
        "member_count": len(members),
        "members": [{"user_id": m["user_id"], "role": m.get("role", "player"),
                     "display_name": umap.get(m["user_id"], {}).get("display_name", "Athlete")} for m in members],
        "is_organiser": u_id == c["organiser_id"],
        "is_member": u_id in member_ids if u_id else False,
    }


@api.get("/competitions/list")
async def competitions_list(sport_id: Optional[str] = None, u: dict = Depends(current_user)):
    # A user's own PRIVATE leagues/knockouts must remain visible on their sport
    # pages even though they never appear in the public Events discovery feed.
    mem = await DB.competition_members.find({"user_id": u["id"], "status": "approved"}, {"_id": 0, "competition_id": 1}).to_list(500)
    my_cids = [m["competition_id"] for m in mem]
    filt: dict[str, Any] = {"$or": [
        {"visibility": "public"},
        {"organiser_id": u["id"]},
        {"id": {"$in": my_cids}},
    ]}
    if sport_id:
        filt = {"$and": [filt, {"sport_id": sport_id}]}
    docs = await DB.competitions.find(filt, {"_id": 0}).sort("created_at", -1).limit(80).to_list(80)
    return {"competitions": [await _competition_public(c, u["id"]) for c in docs]}


@api.get("/competitions/mine")
async def competitions_mine(u: dict = Depends(current_user)):
    # Everything the user created OR joined — leagues, knockouts and events.
    mem = await DB.competition_members.find({"user_id": u["id"], "status": "approved"}, {"_id": 0}).to_list(300)
    cids = list({m["competition_id"] for m in mem})
    docs = await DB.competitions.find({"$or": [{"id": {"$in": cids}}, {"organiser_id": u["id"]}]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    out = []
    for c in docs:
        pub = await _competition_public(c, u["id"])
        pub["my_role"] = "organiser" if pub["is_organiser"] else "player"
        # Next fixture for this user that has not been played yet.
        fx = await DB.fixtures.find(
            {"competition_id": c["id"], "sides.user_ids": u["id"], "status": {"$nin": ["complete", "bye"]}},
            {"_id": 0},
        ).sort([("round", 1), ("index", 1)]).to_list(50)
        nf = None
        if fx:
            f = fx[0]
            opp_ids = [x for s in f["sides"] for x in s["user_ids"] if x != u["id"]]
            opp_name = None
            if opp_ids:
                ou = await DB.users.find_one({"id": opp_ids[0]}, {"_id": 0, "display_name": 1})
                opp_name = (ou or {}).get("display_name", "Athlete")
            nf = {
                "round_name": _ko_round_name(f["round"], None) if c["type"] == "knockout" else f"ROUND {f['round']}",
                "opponent_name": opp_name, "status": f["status"],
                "scheduled_at": f.get("scheduled_at").isoformat() if isinstance(f.get("scheduled_at"), datetime) else f.get("scheduled_at"),
            }
        pub["next_fixture"] = nf
        out.append(pub)
    return {"competitions": out}


def _ko_round_name(round_no: int, total_rounds: Optional[int]) -> str:
    if not total_rounds:
        return f"ROUND {round_no}"
    # rounds_from_final: 0 = final, 1 = semis, 2 = QF ...
    rounds_from_final = total_rounds - round_no
    names = {0: "FINAL", 1: "SEMI-FINALS", 2: "QUARTER-FINALS", 3: "ROUND OF 16", 4: "ROUND OF 32", 5: "ROUND OF 64"}
    return names.get(rounds_from_final, f"ROUND {round_no}")


@api.get("/competitions/{cid}")
async def competition_detail(cid: str, u: dict = Depends(current_user)):
    c = await DB.competitions.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Competition not found")
    pub = await _competition_public(c, u["id"])
    fixtures = await DB.fixtures.find({"competition_id": cid}, {"_id": 0}).sort([("round", 1), ("index", 1), ("created_at", 1)]).to_list(500)
    is_ko = c["type"] == "knockout"
    # Seed map (knockouts are seeded by rating at generation time).
    seed_map: dict[str, int] = {}
    if is_ko:
        players = [m["user_id"] for m in pub["members"] if m.get("role") != "organiser"]
        ps = await DB.player_sports.find({"sport_id": c["sport_id"], "user_id": {"$in": players}}, {"_id": 0}).to_list(200)
        rmap = {p["user_id"]: p["rating"] for p in ps}
        for i, uid in enumerate(sorted(players, key=lambda x: rmap.get(x, 0), reverse=True), start=1):
            seed_map[uid] = i
    total_rounds = None
    for f in fixtures:
        if f.get("total_rounds"):
            total_rounds = f["total_rounds"]
            break
    for f in fixtures:
        if is_ko:
            f["round_name"] = _ko_round_name(f["round"], total_rounds or f.get("total_rounds"))
            for s in f["sides"]:
                s["seeds"] = [seed_map.get(uid) for uid in s["user_ids"]]
        else:
            f["round_name"] = f"ROUND {f['round']}"
    standings = await _compute_standings(cid) if c["type"] in ("league", "tournament") else []
    return {"competition": pub, "fixtures": fixtures, "standings": standings,
            "total_rounds": total_rounds, "seed_map": seed_map}


@api.post("/competitions/{cid}/register")
async def competition_register(cid: str, u: dict = Depends(current_user)):
    c = await DB.competitions.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Not found")
    if u.get("is_guest"):
        raise HTTPException(403, "Create an account to register")
    if c["status"] != "registration_open":
        raise HTTPException(400, "Registration is closed")
    existing = await DB.competition_members.find_one({"competition_id": cid, "user_id": u["id"]})
    if existing:
        return {"ok": True, "already": True}
    count = await DB.competition_members.count_documents({"competition_id": cid, "status": "approved"})
    if count >= c["max_participants"]:
        raise HTTPException(400, "Competition full")
    await ensure_player_sport(u["id"], c["sport_id"])
    await DB.competition_members.insert_one({
        "id": str(uuid.uuid4()), "competition_id": cid, "user_id": u["id"],
        "status": "approved", "role": "player", "joined_at": now_utc(),
    })
    return {"ok": True}


@api.post("/competitions/{cid}/withdraw")
async def competition_withdraw(cid: str, u: dict = Depends(current_user)):
    await DB.competition_members.delete_one({"competition_id": cid, "user_id": u["id"], "role": "player"})
    return {"ok": True}


class CompetitionMemberIn(BaseModel):
    user_id: str


@api.post("/competitions/{cid}/members")
async def competition_add_member(cid: str, body: CompetitionMemberIn, u: dict = Depends(current_user)):
    c = await DB.competitions.find_one({"id": cid}, {"_id": 0})
    if not c or c["organiser_id"] != u["id"]:
        raise HTTPException(403, "Only the organiser can manage players")
    if await DB.competition_members.find_one({"competition_id": cid, "user_id": body.user_id}):
        return {"ok": True, "already": True}
    if await DB.competition_members.count_documents({"competition_id": cid, "status": "approved"}) >= c["max_participants"]:
        raise HTTPException(400, "Competition full")
    if not await DB.users.find_one({"id": body.user_id}, {"_id": 0, "id": 1}):
        raise HTTPException(404, "Player not found")
    await ensure_player_sport(body.user_id, c["sport_id"])
    await DB.competition_members.insert_one({"id": str(uuid.uuid4()), "competition_id": cid, "user_id": body.user_id, "status": "approved", "role": "player", "joined_at": now_utc()})
    return {"ok": True}


@api.delete("/competitions/{cid}/members/{user_id}")
async def competition_remove_member(cid: str, user_id: str, u: dict = Depends(current_user)):
    c = await DB.competitions.find_one({"id": cid}, {"_id": 0})
    if not c or c["organiser_id"] != u["id"]:
        raise HTTPException(403, "Only the organiser can manage players")
    await DB.competition_members.delete_one({"competition_id": cid, "user_id": user_id, "role": "player"})
    return {"ok": True}


class AddFixtureIn(BaseModel):
    side0_user_ids: list[str]
    side1_user_ids: list[str]
    scheduled_at: Optional[str] = None


@api.post("/competitions/{cid}/fixtures")
async def competition_add_fixture(cid: str, body: AddFixtureIn, u: dict = Depends(current_user)):
    """Organiser adds a single fixture (used for Manual-fixture leagues and ad-hoc additions)."""
    c = await DB.competitions.find_one({"id": cid}, {"_id": 0})
    if not c or c["organiser_id"] != u["id"]:
        raise HTTPException(403, "Only the organiser can add fixtures")
    if not body.side0_user_ids or not body.side1_user_ids:
        raise HTTPException(400, "Both sides need at least one player")
    if set(body.side0_user_ids) & set(body.side1_user_ids):
        raise HTTPException(400, "A player cannot appear on both sides")
    last = await DB.fixtures.find({"competition_id": cid, "round": 1}, {"_id": 0}).sort("index", -1).limit(1).to_list(1)
    idx = (last[0]["index"] + 1) if last else 0
    fid = str(uuid.uuid4())
    await DB.fixtures.insert_one({
        "id": fid, "competition_id": cid, "round": 1, "index": idx,
        "sides": [{"side": 0, "user_ids": body.side0_user_ids}, {"side": 1, "user_ids": body.side1_user_ids}],
        "status": "scheduled" if body.scheduled_at else "unscheduled",
        "winner_side": None, "score": None, "match_id": None,
        "scheduled_at": body.scheduled_at or None, "created_at": now_utc(),
    })
    await DB.competitions.update_one({"id": cid}, {"$set": {"fixtures_generated": True, "status": "in_progress"}})
    return {"ok": True, "fixture_id": fid}


def _round_robin(players: list[str], times: int) -> list[tuple[str, str]]:
    pairs = []
    for _ in range(times):
        for i in range(len(players)):
            for j in range(i + 1, len(players)):
                pairs.append((players[i], players[j]))
    return pairs


def _round_robin_rounds(players: list[str], times: int) -> list[list[tuple[str, str]]]:
    """Circle method — returns matches grouped into balanced numbered rounds.

    Each player plays once per round (a player may sit out on a bye when the
    field is odd). Returns a list of rounds; each round is a list of (a, b)
    pairings. When times>1 the whole schedule repeats with sides swapped.
    """
    base = list(players)
    if len(base) % 2 == 1:
        base = base + [None]  # bye marker
    n = len(base)
    all_rounds: list[list[tuple[str, str]]] = []
    for cycle in range(max(1, times)):
        arr = list(base)
        for _ in range(n - 1):
            round_pairs: list[tuple[str, str]] = []
            for i in range(n // 2):
                a, b = arr[i], arr[n - 1 - i]
                if a is None or b is None:
                    continue
                # alternate home/away on repeat cycles for fairness
                round_pairs.append((a, b) if cycle % 2 == 0 else (b, a))
            if round_pairs:
                all_rounds.append(round_pairs)
            # rotate keeping first fixed
            arr = [arr[0]] + [arr[-1]] + arr[1:-1]
    return all_rounds


@api.post("/competitions/{cid}/generate-fixtures")
async def competition_generate(cid: str, u: dict = Depends(current_user)):
    c = await DB.competitions.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Not found")
    if c["organiser_id"] != u["id"]:
        raise HTTPException(403, "Only the organiser can generate fixtures")
    members = await DB.competition_members.find({"competition_id": cid, "status": "approved", "role": {"$ne": "organiser_only"}}, {"_id": 0}).to_list(200)
    players = [m["user_id"] for m in members]
    if len(players) < 2:
        raise HTTPException(400, "Need at least 2 participants")
    await DB.fixtures.delete_many({"competition_id": cid})

    if c["type"] == "league":
        initial_status = "unscheduled"
        if c.get("fixture_mode") == "manual":
            pairs = [tuple(pair) for pair in c.get("manual_pairs", []) if len(pair) == 2]
            if not pairs:
                raise HTTPException(400, "Add at least one manual pairing")
            if any(a not in players or b not in players or a == b for a, b in pairs):
                raise HTTPException(400, "Manual pairing contains an invalid participant")
            for idx, (a, b) in enumerate(pairs):
                await DB.fixtures.insert_one({
                    "id": str(uuid.uuid4()), "competition_id": cid, "round": 1, "index": idx,
                    "sides": [{"side": 0, "user_ids": [a]}, {"side": 1, "user_ids": [b]}],
                    "status": initial_status, "winner_side": None, "score": None, "match_id": None,
                    "scheduled_at": None, "created_at": now_utc(),
                })
        else:
            # Group the round-robin into balanced, numbered rounds so the UI can
            # show "Round 1, Round 2 …" instead of one long undifferentiated list.
            rounds = _round_robin_rounds(players, c.get("matches_per_opponent", 1))
            for r_idx, round_pairs in enumerate(rounds, start=1):
                for idx, (a, b) in enumerate(round_pairs):
                    await DB.fixtures.insert_one({
                        "id": str(uuid.uuid4()), "competition_id": cid, "round": r_idx, "index": idx,
                        "sides": [{"side": 0, "user_ids": [a]}, {"side": 1, "user_ids": [b]}],
                        "status": initial_status, "winner_side": None, "score": None, "match_id": None,
                        "scheduled_at": None, "created_at": now_utc(),
                    })
    else:  # knockout — seed by rating, add byes to next power of two
        ps = await DB.player_sports.find({"sport_id": c["sport_id"], "user_id": {"$in": players}}, {"_id": 0}).to_list(200)
        rmap = {p["user_id"]: p["rating"] for p in ps}
        if c.get("draw_mode") == "random":
            import random
            seeded = list(players); random.shuffle(seeded)
        elif c.get("draw_mode") == "manual" and c.get("manual_pairs"):
            seeded = [uid for pair in c["manual_pairs"] for uid in pair if uid in players]
            seeded += [uid for uid in players if uid not in seeded]
        else:
            seeded = sorted(players, key=lambda x: rmap.get(x, 0), reverse=True)
        size = 1
        while size < len(seeded):
            size *= 2
        # standard seeding order pairing highest vs lowest
        slots: list[Optional[str]] = seeded + [None] * (size - len(seeded))
        pairs = [(slots[i], slots[size - 1 - i]) for i in range(size // 2)]
        total_rounds = 0
        t = size
        while t > 1:
            total_rounds += 1; t //= 2
        for idx, (a, b) in enumerate(pairs):
            is_bye = (a is None) != (b is None)
            winner_side = None
            status = "scheduled"
            if is_bye:
                winner_side = 0 if a is not None else 1
                status = "bye"
            await DB.fixtures.insert_one({
                "id": str(uuid.uuid4()), "competition_id": cid, "round": 1, "index": idx,
                "sides": [{"side": 0, "user_ids": [a] if a else []}, {"side": 1, "user_ids": [b] if b else []}],
                "status": status, "winner_side": winner_side, "score": None, "match_id": None,
                "scheduled_at": None,
                "total_rounds": total_rounds, "created_at": now_utc(),
            })
        await _create_next_knockout_round(cid, 1)

    await DB.competitions.update_one({"id": cid}, {"$set": {"fixtures_generated": True, "status": "in_progress"}})
    return {"ok": True}


async def _create_next_knockout_round(cid: str, completed_round: int) -> None:
    """If all fixtures in `completed_round` have a winner, build the next round."""
    fixtures = await DB.fixtures.find({"competition_id": cid, "round": completed_round}, {"_id": 0}).sort("index", 1).to_list(200)
    if not fixtures:
        return
    if any(f["winner_side"] is None for f in fixtures):
        return
    if len(fixtures) == 1:
        return  # final done
    next_round = completed_round + 1
    exists = await DB.fixtures.count_documents({"competition_id": cid, "round": next_round})
    if exists:
        return
    winners = []
    for f in fixtures:
        ws = f["winner_side"]
        winners.append(f["sides"][ws]["user_ids"])
    for idx in range(0, len(winners), 2):
        a = winners[idx]; b = winners[idx + 1] if idx + 1 < len(winners) else []
        fixture_status = "bye" if (bool(a) != bool(b)) else "scheduled"
        winner_side = (0 if a else 1) if fixture_status == "bye" else None
        await DB.fixtures.insert_one({
            "id": str(uuid.uuid4()), "competition_id": cid, "round": next_round, "index": idx // 2,
            "sides": [{"side": 0, "user_ids": a}, {"side": 1, "user_ids": b}],
            "status": fixture_status, "winner_side": winner_side, "score": None, "match_id": None,
            "total_rounds": fixtures[0].get("total_rounds"), "created_at": now_utc(),
        })
    await _create_next_knockout_round(cid, next_round)


async def _progress_fixture(fixture_id: str, match_id: str) -> None:
    f = await DB.fixtures.find_one({"id": fixture_id}, {"_id": 0})
    if not f:
        return
    m = await DB.matches.find_one({"id": match_id}, {"_id": 0})
    if not m:
        return
    await DB.fixtures.update_one({"id": fixture_id}, {"$set": {
        "status": "complete", "winner_side": m["winner_side"], "match_id": match_id,
        "score": m.get("side_wins"),
    }})
    c = await DB.competitions.find_one({"id": f["competition_id"]}, {"_id": 0})
    if c and c["type"] == "knockout":
        await _create_next_knockout_round(f["competition_id"], f["round"])
        # champion?
        # _create_next_knockout_round may have just created a later round. The
        # final is therefore identified by the current maximum round, not by
        # the round of the fixture that was just completed.
        final = await DB.fixtures.find({"competition_id": f["competition_id"]}, {"_id": 0}).sort("round", -1).limit(1).to_list(1)
        if final:
            final_round = final[0]["round"]
            last_round = await DB.fixtures.find(
                {"competition_id": f["competition_id"], "round": final_round},
                {"_id": 0},
            ).to_list(50)
            if len(last_round) == 1 and last_round[0]["winner_side"] is not None:
                champ = last_round[0]["sides"][last_round[0]["winner_side"]]["user_ids"]
                await DB.competitions.update_one(
                    {"id": f["competition_id"]},
                    {"$set": {"status": "complete", "champion_ids": champ}},
                )


async def _compute_standings(cid: str) -> list[dict]:
    c = await DB.competitions.find_one({"id": cid}, {"_id": 0})
    members = await DB.competition_members.find({"competition_id": cid, "status": "approved"}, {"_id": 0}).to_list(200)
    stats = {m["user_id"]: {"user_id": m["user_id"], "played": 0, "wins": 0, "losses": 0, "points": 0} for m in members if m.get("role") != "organiser_only"}
    fixtures = await DB.fixtures.find({"competition_id": cid, "status": "complete"}, {"_id": 0}).to_list(500)
    for f in fixtures:
        ws = f["winner_side"]
        if ws is None:
            continue
        for s_idx, s in enumerate(f["sides"]):
            for uid in s["user_ids"]:
                if uid not in stats:
                    continue
                stats[uid]["played"] += 1
                if s_idx == ws:
                    stats[uid]["wins"] += 1
                    stats[uid]["points"] += c.get("points_win", 3)
                else:
                    stats[uid]["losses"] += 1
                    stats[uid]["points"] += c.get("points_loss", 0)
    ps = await DB.player_sports.find({"sport_id": c["sport_id"], "user_id": {"$in": list(stats.keys())}}, {"_id": 0}).to_list(200)
    rmap = {p["user_id"]: p["rating"] for p in ps}
    users = await DB.users.find({"id": {"$in": list(stats.keys())}}, {"_id": 0, "id": 1, "display_name": 1}).to_list(200)
    umap = {x["id"]: x.get("display_name", "Athlete") for x in users}
    rows = list(stats.values())
    for r in rows:
        r["rating"] = rmap.get(r["user_id"], 0)
        r["display_name"] = umap.get(r["user_id"], "Athlete")
    rows.sort(key=lambda r: (-r["points"], -r["wins"], -r["rating"]))
    for i, r in enumerate(rows, 1):
        r["position"] = i
    return rows


class ManualFixtureResultIn(BaseModel):
    games: list[list[int]]


@api.post("/fixtures/{fixture_id}/manual-result")
async def fixture_manual_result(fixture_id: str, body: ManualFixtureResultIn, u: dict = Depends(current_user)):
    f = await DB.fixtures.find_one({"id": fixture_id}, {"_id": 0})
    if not f:
        raise HTTPException(404, "Fixture not found")
    c = await DB.competitions.find_one({"id": f["competition_id"]}, {"_id": 0})
    if c["organiser_id"] != u["id"]:
        raise HTTPException(403, "Only the organiser can enter results")
    if f.get("status") == "complete":
        raise HTTPException(409, "Completed fixtures require the organiser result-correction flow")
    parsed = validate_score(c["sport_id"], body.games)
    winner_side = parsed["winner_side"]
    winner_uids = f["sides"][winner_side]["user_ids"]
    match_id = str(uuid.uuid4())
    doc = {
        "id": match_id, "sport_id": c["sport_id"],
        "participants": f["sides"][0]["user_ids"] + f["sides"][1]["user_ids"],
        "sides": f["sides"], "games": body.games, "side_wins": parsed["side_wins"],
        "total_points": parsed["total_points"], "winner_side": winner_side,
        "winner_user_id": winner_uids[0] if winner_uids else None,
        "submitted_by": u["id"], "status": "verified", "source": "manual",
        "competition_id": c["id"], "fixture_id": fixture_id, "created_at": now_utc(),
    }
    await DB.matches.insert_one(doc)
    await _apply_result_general(match_id)
    return {"ok": True, "match_id": match_id}


class FixtureUpdateIn(BaseModel):
    action: str = "update"  # update | remove | reorder
    side0_user_ids: Optional[list[str]] = None
    side1_user_ids: Optional[list[str]] = None
    scheduled_at: Optional[str] = None
    position: Optional[int] = None


@api.patch("/fixtures/{fixture_id}")
async def fixture_update(fixture_id: str, body: FixtureUpdateIn, u: dict = Depends(current_user)):
    f = await DB.fixtures.find_one({"id": fixture_id}, {"_id": 0})
    if not f:
        raise HTTPException(404, "Fixture not found")
    c = await DB.competitions.find_one({"id": f["competition_id"]}, {"_id": 0})
    if not c or c["organiser_id"] != u["id"]:
        raise HTTPException(403, "Only the organiser can manage fixtures")
    if f.get("status") == "complete":
        raise HTTPException(409, "Completed fixtures are locked")
    if body.action == "remove":
        await DB.fixtures.delete_one({"id": fixture_id})
        return {"ok": True, "removed": True}
    updates: dict[str, Any] = {}
    if body.side0_user_ids is not None and body.side1_user_ids is not None:
        updates["sides"] = [{"side": 0, "user_ids": body.side0_user_ids}, {"side": 1, "user_ids": body.side1_user_ids}]
    if body.scheduled_at is not None:
        updates["scheduled_at"] = body.scheduled_at or None
        updates["status"] = "scheduled" if body.scheduled_at else "unscheduled"
    if body.position is not None:
        updates["index"] = max(0, body.position)
    if updates:
        await DB.fixtures.update_one({"id": fixture_id}, {"$set": updates})
    return {"ok": True}


class EventCreateIn(BaseModel):
    name: str
    sport_id: str
    format: str  # league | knockout
    visibility: str = "public"
    venue: str
    city: str
    country: Optional[str] = None
    capacity: int = 32
    is_paid: bool = False
    fee: Optional[float] = None
    currency: str = "USD"
    description: Optional[str] = None
    registration_opens: Optional[str] = None
    registration_closes: Optional[str] = None
    starts_at: Optional[str] = None  # overall event date/time


@api.post("/events/create")
async def event_create(body: EventCreateIn, u: dict = Depends(current_user)):
    if u.get("is_guest"):
        raise HTTPException(403, "Create an account to create events")
    if body.sport_id not in SPORT_BY_ID or body.format not in ("league", "knockout"):
        raise HTTPException(400, "Invalid event sport or format")
    if body.capacity < 2 or (body.is_paid and (body.fee is None or body.fee < 0)):
        raise HTTPException(400, "Invalid event capacity or fee")
    if body.visibility == "public" and (not body.city or not body.country):
        raise HTTPException(400, "Public events need a country and city")
    eid = str(uuid.uuid4())
    doc = {"id": eid, **body.model_dump(), "organiser_id": u["id"], "registered_user_ids": [], "status": "open", "created_at": now_utc()}
    await DB.events.insert_one(doc)
    return {"event": {k: v for k, v in doc.items() if k != "_id"}}


async def _latest_registration(event_id: str, user_id: str) -> Optional[dict]:
    return await DB.event_registrations.find_one(
        {"event_id": event_id, "user_id": user_id}, {"_id": 0}, sort=[("created_at", -1)]
    )


@api.get("/events/{event_id}")
async def event_detail(event_id: str, u: dict = Depends(current_user)):
    event = await DB.events.find_one({"id": event_id}, {"_id": 0})
    if not event or (event.get("visibility") != "public" and event.get("organiser_id") != u["id"] and u["id"] not in event.get("registered_user_ids", [])):
        raise HTTPException(404, "Event not found")
    event["registered"] = len(event.get("registered_user_ids", []))
    event["is_registered"] = u["id"] in event.get("registered_user_ids", [])
    event["is_organiser"] = event.get("organiser_id") == u["id"]
    reg = await _latest_registration(event_id, u["id"])
    event["my_registration"] = {
        "status": reg.get("status"), "payment_status": reg.get("payment_status"),
        "id": reg.get("id"), "amount": reg.get("amount"), "currency": reg.get("currency"),
    } if reg else None
    event["payments_live"] = PAYMENTS_LIVE
    return {"event": event}


class EventRegisterIn(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None


@api.post("/events/{event_id}/register")
async def event_register(event_id: str, body: EventRegisterIn, request: Request, u: dict = Depends(current_user)):
    event = await DB.events.find_one({"id": event_id}, {"_id": 0})
    if not event or event.get("visibility") != "public":
        raise HTTPException(404, "Public event not found")
    if not body.name.strip():
        raise HTTPException(400, "Participant name is required")

    ids = event.get("registered_user_ids", [])
    already = u["id"] in ids
    if not already and len(ids) >= event["capacity"]:
        raise HTTPException(400, "Event is full")

    is_paid = bool(event.get("is_paid"))
    fee = float(event.get("fee") or 0)
    currency = event.get("currency") or "INR"

    # Cancel any stale pending registration before creating a fresh one.
    await DB.event_registrations.update_many(
        {"event_id": event_id, "user_id": u["id"], "status": "Pending"},
        {"$set": {"status": "Cancelled", "updated_at": now_utc()}},
    )

    reg_id = str(uuid.uuid4())
    base = {
        "id": reg_id, "event_id": event_id, "user_id": u["id"],
        "name": body.name.strip(), "email": (body.email or u.get("email") or "").strip(),
        "phone": (body.phone or "").strip(), "notes": (body.notes or "").strip(),
        "amount": fee, "currency": currency, "created_at": now_utc(), "updated_at": now_utc(),
    }

    # ---- FREE event: confirm immediately ----
    if not is_paid or fee <= 0:
        base.update({"status": "Confirmed", "payment_status": "free"})
        await DB.event_registrations.insert_one(dict(base))
        await DB.events.update_one({"id": event_id}, {"$addToSet": {"registered_user_ids": u["id"]}})
        return {"status": "Confirmed", "free": True}

    # ---- PAID event: create a Pending registration ----
    base.update({"status": "Pending", "payment_status": "created"})

    if PAYMENTS_LIVE:
        try:
            import httpx
            amount_sub = int(round(fee * 100))  # subunits
            async with httpx.AsyncClient(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET), timeout=15) as c:
                r = await c.post("https://api.razorpay.com/v1/orders", json={
                    "amount": amount_sub, "currency": currency, "receipt": f"reg_{reg_id[:18]}",
                    "payment_capture": 1, "notes": {"event_id": event_id, "reg_id": reg_id},
                })
            if r.is_error:
                raise HTTPException(502, "Could not create payment order")
            order = r.json()
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(502, "Payment provider unavailable")
        base["razorpay_order_id"] = order["id"]
        await DB.event_registrations.insert_one(dict(base))
        checkout_url = str(request.base_url).rstrip("/") + f"/api/payments/checkout-page?order_id={order['id']}"
        return {"status": "Pending", "pay": {
            "mode": "razorpay", "registration_id": reg_id, "order_id": order["id"],
            "key_id": RAZORPAY_KEY_ID, "amount": amount_sub, "currency": currency,
            "checkout_url": checkout_url,
        }}

    # TEST-MODE (no keys): return a marker so the app can complete a test payment.
    await DB.event_registrations.insert_one(dict(base))
    return {"status": "Pending", "pay": {"mode": "test", "registration_id": reg_id, "amount": fee, "currency": currency}}


async def _confirm_registration(reg: dict, payment_id: Optional[str] = None, payment_status: str = "captured") -> str:
    ids = None
    event = await DB.events.find_one({"id": reg["event_id"]}, {"_id": 0})
    if event:
        ids = event.get("registered_user_ids", [])
        if reg["user_id"] not in ids and len(ids) >= event.get("capacity", 0):
            await DB.event_registrations.update_one({"id": reg["id"]}, {"$set": {"status": "Failed", "payment_status": "event_full", "updated_at": now_utc()}})
            return "Failed"
    await DB.event_registrations.update_one({"id": reg["id"]}, {"$set": {
        "status": "Confirmed", "payment_status": payment_status,
        "razorpay_payment_id": payment_id, "updated_at": now_utc(),
    }})
    await DB.events.update_one({"id": reg["event_id"]}, {"$addToSet": {"registered_user_ids": reg["user_id"]}})
    return "Confirmed"


class MockConfirmIn(BaseModel):
    registration_id: str


@api.post("/events/{event_id}/pay/mock-confirm")
async def event_pay_mock_confirm(event_id: str, body: MockConfirmIn, u: dict = Depends(current_user)):
    """TEST-MODE only: completes a paid registration without a real charge."""
    if PAYMENTS_LIVE:
        raise HTTPException(400, "Live payments enabled — use the checkout flow")
    reg = await DB.event_registrations.find_one({"id": body.registration_id, "user_id": u["id"], "event_id": event_id}, {"_id": 0})
    if not reg:
        raise HTTPException(404, "Registration not found")
    status_ = await _confirm_registration(reg, payment_id="test_" + reg["id"][:12], payment_status="test_captured")
    return {"status": status_}


class VerifyIn(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


@api.post("/payments/verify")
async def payments_verify(body: VerifyIn):
    reg = await DB.event_registrations.find_one({"razorpay_order_id": body.razorpay_order_id}, {"_id": 0})
    if not reg:
        raise HTTPException(404, "Unknown order")
    expected = hmac.new(RAZORPAY_KEY_SECRET.encode(), f"{body.razorpay_order_id}|{body.razorpay_payment_id}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, body.razorpay_signature):
        await DB.event_registrations.update_one({"id": reg["id"]}, {"$set": {"status": "Failed", "payment_status": "signature_mismatch", "updated_at": now_utc()}})
        raise HTTPException(400, "Invalid payment signature")
    status_ = await _confirm_registration(reg, payment_id=body.razorpay_payment_id)
    return {"status": status_}


@api.get("/payments/checkout-page", response_class=HTMLResponse)
async def payments_checkout_page(order_id: str, request: Request):
    reg = await DB.event_registrations.find_one({"razorpay_order_id": order_id, "status": "Pending"}, {"_id": 0})
    if not reg:
        raise HTTPException(404, "Order not found")
    callback = str(request.base_url).rstrip("/") + "/api/payments/callback"
    amount_sub = int(round(float(reg["amount"]) * 100))
    return f"""<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="background:#0A0E27">
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
new Razorpay({{
  key: {json.dumps(RAZORPAY_KEY_ID)}, amount: {amount_sub}, currency: {json.dumps(reg['currency'])},
  name: "ATHLERA Event", description: "Event registration", order_id: {json.dumps(order_id)},
  callback_url: {json.dumps(callback)},
  prefill: {{name: {json.dumps(reg.get('name',''))}, email: {json.dumps(reg.get('email',''))}, contact: {json.dumps(reg.get('phone',''))}}},
  theme: {{color: "#1E63FF"}},
  modal: {{ondismiss: function(){{ location.href = "frontend://payment-result?status=cancelled"; }}}}
}}).open();
</script></body></html>"""


@api.post("/payments/callback", response_class=HTMLResponse)
async def payments_callback(request: Request):
    form = await request.form()
    try:
        order_id = str(form["razorpay_order_id"])
        payment_id = str(form["razorpay_payment_id"])
        signature = str(form["razorpay_signature"])
        reg = await DB.event_registrations.find_one({"razorpay_order_id": order_id}, {"_id": 0})
        expected = hmac.new(RAZORPAY_KEY_SECRET.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
        if reg and hmac.compare_digest(expected, signature):
            await _confirm_registration(reg, payment_id=payment_id)
            result = "success"
        else:
            result = "failed"
    except Exception:
        result = "failed"
    return f'<html><body><script>location.href="frontend://payment-result?status={result}";</script>Payment {result}</body></html>'


@api.post("/events/{event_id}/withdraw")
async def event_withdraw(event_id: str, u: dict = Depends(current_user)):
    await DB.events.update_one({"id": event_id}, {"$pull": {"registered_user_ids": u["id"]}})
    await DB.event_registrations.update_many(
        {"event_id": event_id, "user_id": u["id"], "status": {"$in": ["Confirmed", "Pending"]}},
        {"$set": {"status": "Cancelled", "updated_at": now_utc()}},
    )
    return {"ok": True, "registered": False}


# ==================== LOOKING TO PLAY / PLAY REQUESTS ====================
class LTPCreateIn(BaseModel):
    sport_id: str
    when_text: str
    area: str
    radius_km: int = 10
    message: Optional[str] = None


@api.post("/ltp/create")
async def ltp_create(body: LTPCreateIn, u: dict = Depends(current_user)):
    if u.get("is_guest"):
        raise HTTPException(403, "Create an account to post")
    ps = await ensure_player_sport(u["id"], body.sport_id)
    doc = {
        "id": str(uuid.uuid4()), "user_id": u["id"], "sport_id": body.sport_id,
        "when_text": body.when_text, "area": body.area, "radius_km": body.radius_km,
        "message": body.message, "rating": ps["rating"], "status": "open", "created_at": now_utc(),
    }
    await DB.ltp_posts.insert_one(doc)
    return {"ok": True, "post_id": doc["id"]}


@api.get("/ltp/list")
async def ltp_list(sport_id: Optional[str] = None, u: dict = Depends(current_user)):
    filt: dict[str, Any] = {"status": "open"}
    if sport_id:
        filt["sport_id"] = sport_id
    docs = await DB.ltp_posts.find(filt, {"_id": 0}).sort("created_at", -1).limit(50).to_list(50)
    uids = list({d["user_id"] for d in docs})
    users = await DB.users.find({"id": {"$in": uids}}, {"_id": 0, "id": 1, "display_name": 1, "city": 1}).to_list(200)
    umap = {x["id"]: x for x in users}
    out = []
    for d in docs:
        usr = umap.get(d["user_id"], {})
        out.append({**d, "display_name": usr.get("display_name", "Athlete"), "city": usr.get("city"),
                    "sport": SPORT_BY_ID[d["sport_id"]], "is_mine": d["user_id"] == u["id"]})
    return {"posts": out}


class PlayRequestIn(BaseModel):
    to_user_id: str
    sport_id: str
    proposed_time: Optional[str] = None
    message: Optional[str] = None


@api.post("/play-requests/create")
async def play_request_create(body: PlayRequestIn, u: dict = Depends(current_user)):
    if u.get("is_guest"):
        raise HTTPException(403, "Create an account to send requests")
    dup = await DB.play_requests.find_one({"from_user_id": u["id"], "to_user_id": body.to_user_id, "sport_id": body.sport_id, "status": "pending"})
    if dup:
        raise HTTPException(400, "You already have a pending request with this player")
    doc = {
        "id": str(uuid.uuid4()), "from_user_id": u["id"], "to_user_id": body.to_user_id,
        "sport_id": body.sport_id, "proposed_time": body.proposed_time, "message": body.message,
        "status": "pending", "created_at": now_utc(),
    }
    await DB.play_requests.insert_one(doc)
    return {"ok": True, "request_id": doc["id"]}


@api.get("/play-requests/mine")
async def play_requests_mine(u: dict = Depends(current_user)):
    incoming = await DB.play_requests.find({"to_user_id": u["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    outgoing = await DB.play_requests.find({"from_user_id": u["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    all_uids = list({r["from_user_id"] for r in incoming} | {r["to_user_id"] for r in outgoing})
    users = await DB.users.find({"id": {"$in": all_uids}}, {"_id": 0, "id": 1, "display_name": 1}).to_list(200)
    umap = {x["id"]: x.get("display_name", "Athlete") for x in users}
    for r in incoming:
        r["other_name"] = umap.get(r["from_user_id"], "Athlete")
    for r in outgoing:
        r["other_name"] = umap.get(r["to_user_id"], "Athlete")
    return {"incoming": incoming, "outgoing": outgoing}


class PlayRequestActionIn(BaseModel):
    request_id: str
    action: str  # accept | decline | cancel


@api.post("/play-requests/action")
async def play_request_action(body: PlayRequestActionIn, u: dict = Depends(current_user)):
    r = await DB.play_requests.find_one({"id": body.request_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Not found")
    status_map = {"accept": "accepted", "decline": "declined", "cancel": "cancelled"}
    if body.action not in status_map:
        raise HTTPException(400, "Bad action")
    await DB.play_requests.update_one({"id": body.request_id}, {"$set": {"status": status_map[body.action]}})
    return {"ok": True, "status": status_map[body.action]}


# ==================== NEARBY / MESSAGING ====================
@api.get("/social/nearby")
async def social_nearby(sport_id: Optional[str] = None, city: Optional[str] = None, u: dict = Depends(current_user)):
    filt: dict[str, Any] = {"user_id": {"$ne": u["id"]}}
    if sport_id:
        filt["sport_id"] = sport_id
    ps = await DB.player_sports.find(filt, {"_id": 0}).sort("rating", -1).limit(80).to_list(80)
    uids = list({p["user_id"] for p in ps})
    users = await DB.users.find({"id": {"$in": uids}}, {"_id": 0, "id": 1, "display_name": 1, "city": 1}).to_list(200)
    umap = {x["id"]: x for x in users}
    # Determine the viewer's reference area: explicit city param wins, else their
    # saved profile city. We never expose exact coordinates — only an approximate
    # area label and a coarse distance bucket.
    me = await DB.users.find_one({"id": u["id"]}, {"_id": 0, "city": 1})
    ref_city = (city or (me or {}).get("city") or "").strip().lower()
    import random
    seen = set()
    out = []
    for p in ps:
        if p["user_id"] in seen:
            continue
        seen.add(p["user_id"])
        usr = umap.get(p["user_id"], {})
        area = usr.get("city") or "Nearby"
        same_city = ref_city and area.strip().lower() == ref_city
        random.seed(hash(p["user_id"]))
        # Approximate distance: players in the same city read as very close; others further out.
        dist = round(random.uniform(0.4, 4.0), 1) if same_city else round(random.uniform(6.0, 40.0), 1)
        angle = round(random.uniform(0, 360), 1)  # coarse bearing for the radar view only
        out.append({
            "user_id": p["user_id"], "display_name": usr.get("display_name", "Athlete"),
            "area": area, "distance_km": dist, "same_city": bool(same_city), "angle": angle,
            "sport_id": p["sport_id"], "sport": SPORT_BY_ID[p["sport_id"]], "rating": p["rating"],
        })
    # If a city filter is active, surface same-city players first and drop far-away noise.
    if ref_city:
        out = [o for o in out if o["same_city"]] + [o for o in out if not o["same_city"]]
    out.sort(key=lambda x: (not x["same_city"], x["distance_km"]) if ref_city else (x["distance_km"],))
    return {"players": out[:30], "ref_city": ref_city or None}


class MessageSendIn(BaseModel):
    to_user_id: str
    text: str


def _conv_id(a: str, b: str) -> str:
    return "conv_" + "_".join(sorted([a, b]))


@api.post("/messages/send")
async def message_send(body: MessageSendIn, u: dict = Depends(current_user)):
    if u.get("is_guest"):
        raise HTTPException(403, "Create an account to message")
    conv = _conv_id(u["id"], body.to_user_id)
    await DB.conversations.update_one(
        {"id": conv},
        {"$set": {"id": conv, "members": sorted([u["id"], body.to_user_id]), "updated_at": now_utc()},
         "$setOnInsert": {"created_at": now_utc()}},
        upsert=True,
    )
    doc = {"id": str(uuid.uuid4()), "conversation_id": conv, "from_user_id": u["id"],
           "text": body.text, "created_at": now_utc()}
    await DB.messages.insert_one(doc)
    return {"ok": True, "conversation_id": conv}


@api.get("/messages/{other_user_id}")
async def messages_thread(other_user_id: str, u: dict = Depends(current_user)):
    conv = _conv_id(u["id"], other_user_id)
    msgs = await DB.messages.find({"conversation_id": conv}, {"_id": 0}).sort("created_at", 1).limit(200).to_list(200)
    other = await DB.users.find_one({"id": other_user_id}, {"_id": 0, "id": 1, "display_name": 1})
    return {"conversation_id": conv, "messages": msgs, "other": other or {"id": other_user_id, "display_name": "Athlete"}}


@api.get("/messages")
async def message_threads(u: dict = Depends(current_user)):
    convs = await DB.conversations.find({"members": u["id"]}, {"_id": 0}).sort("updated_at", -1).to_list(50)
    out = []
    for c in convs:
        other_id = [m for m in c["members"] if m != u["id"]]
        other_id = other_id[0] if other_id else u["id"]
        other = await DB.users.find_one({"id": other_id}, {"_id": 0, "display_name": 1})
        last = await DB.messages.find({"conversation_id": c["id"]}, {"_id": 0}).sort("created_at", -1).limit(1).to_list(1)
        out.append({"conversation_id": c["id"], "other_user_id": other_id,
                    "other_name": (other or {}).get("display_name", "Athlete"),
                    "last": last[0]["text"] if last else ""})
    return {"threads": out}


# ==================== MATCH HISTORY (with filters) ====================
@api.get("/matches/history")
async def matches_history(
    u: dict = Depends(current_user),
    sport_id: Optional[str] = None,
    opponent_id: Optional[str] = None,
    result: Optional[str] = None,   # win | loss
    source: Optional[str] = None,   # live | manual
    type: Optional[str] = None,     # oneoff | league | knockout
    competition_id: Optional[str] = None,
):
    filt: dict[str, Any] = {"participants": u["id"], "status": "verified"}
    if sport_id:
        filt["sport_id"] = sport_id
    if source:
        filt["source"] = source
    if competition_id:
        filt["competition_id"] = competition_id
    if type == "oneoff":
        filt["competition_id"] = None
    if opponent_id:
        filt["participants"] = {"$all": [u["id"], opponent_id]}
    docs = await DB.matches.find(filt, {"_id": 0}).sort("created_at", -1).limit(300).to_list(300)
    other_ids = list({p for m in docs for p in m["participants"] if p != u["id"]})
    users = await DB.users.find({"id": {"$in": other_ids}}, {"_id": 0, "id": 1, "display_name": 1}).to_list(500)
    umap = {x["id"]: x.get("display_name", "Athlete") for x in users}
    comp_ids = list({m["competition_id"] for m in docs if m.get("competition_id")})
    comps = await DB.competitions.find({"id": {"$in": comp_ids}}, {"_id": 0, "id": 1, "type": 1, "name": 1}).to_list(200)
    cmap = {x["id"]: x for x in comps}
    out = []
    for m in docs:
        won = m.get("winner_user_id") == u["id"] or (u["id"] in (m["sides"][m["winner_side"]]["user_ids"] if m.get("winner_side") is not None else []))
        if result == "win" and not won:
            continue
        if result == "loss" and won:
            continue
        comp = cmap.get(m.get("competition_id")) if m.get("competition_id") else None
        comp_type = (comp or {}).get("type") if comp else "oneoff"
        if type in ("league", "knockout") and comp_type != type:
            continue
        rc = (m.get("rating_changes") or {}).get(u["id"], {})
        others = [p for p in m["participants"] if p != u["id"]]
        out.append({
            "id": m["id"], "sport_id": m["sport_id"], "sport": SPORT_BY_ID[m["sport_id"]],
            "games": m.get("games", []), "won": won, "source": m.get("source", "manual"),
            "competition_id": m.get("competition_id"),
            "competition_name": (comp or {}).get("name"),
            "comp_type": comp_type,
            "opponent_name": umap.get(others[0], "Athlete") if others else "Athlete",
            "rating_before": rc.get("before"), "rating_after": rc.get("after"), "rating_delta": rc.get("delta"),
            "created_at": m["created_at"].isoformat() if isinstance(m.get("created_at"), datetime) else m.get("created_at"),
        })
    return {"matches": out}


@api.get("/matches/{match_id}")
async def match_detail(match_id: str, u: dict = Depends(current_user)):
    m = await DB.matches.find_one({"id": match_id}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Match not found")
    users = await DB.users.find({"id": {"$in": m["participants"]}}, {"_id": 0, "id": 1, "display_name": 1}).to_list(20)
    umap = {x["id"]: x.get("display_name", "Athlete") for x in users}
    comp = None
    if m.get("competition_id"):
        comp = await DB.competitions.find_one({"id": m["competition_id"]}, {"_id": 0, "id": 1, "name": 1, "type": 1, "sport_id": 1})
    sides = []
    for s in m["sides"]:
        sides.append({
            "side": s["side"],
            "user_ids": s["user_ids"],
            "names": [umap.get(uid, "Athlete") for uid in s["user_ids"]],
            "won": m.get("winner_side") == s["side"],
        })
    # live event history (Point / Let / Stroke / etc.) if this was a live match
    events = []
    st = m.get("state") or {}
    for e in (st.get("log") or []):
        events.append({"seq": e.get("seq"), "type": e.get("type"), "side": e.get("side"),
                       "scored_side": e.get("scored_side"), "note": e.get("note")})
    rc = m.get("rating_changes") or {}
    my_rc = rc.get(u["id"], {})
    return {
        "id": m["id"], "sport_id": m["sport_id"], "sport": SPORT_BY_ID[m["sport_id"]],
        "sides": sides, "games": m.get("games", []), "side_wins": m.get("side_wins"),
        "winner_side": m.get("winner_side"), "source": m.get("source", "manual"),
        "competition": comp, "created_at": m["created_at"].isoformat() if isinstance(m.get("created_at"), datetime) else m.get("created_at"),
        "events": events,
        "my_rating": {"before": my_rc.get("before"), "after": my_rc.get("after"), "delta": my_rc.get("delta")},
        "rating_changes": {uid: {"name": umap.get(uid, "Athlete"), **v} for uid, v in rc.items()},
    }


@api.get("/sports/{sport_id}/rating-history")
async def sport_rating_history(sport_id: str, u: dict = Depends(current_user)):
    docs = await DB.rating_history.find({"user_id": u["id"], "sport_id": sport_id}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return {"history": [{"before": d["before"], "after": d["after"], "delta": d["delta"],
                         "created_at": d["created_at"].isoformat() if isinstance(d.get("created_at"), datetime) else d.get("created_at")} for d in docs]}


app.include_router(api)


@app.on_event("shutdown")
async def _shutdown():
    if client:
        client.close()
