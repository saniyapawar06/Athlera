"""ATHLERA backend — FastAPI + Motor (MongoDB) + JWT auth.

Everything is served under the /api prefix.  Uses UUID strings for entity IDs
(never returns raw _id).  Ratings, UAS and match finalisation happen
server-side.
"""
from __future__ import annotations

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
from fastapi import APIRouter, Depends, FastAPI, HTTPException, status
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

# City -> Country mapping so Global / Country / City scoping works with existing
# location data (privacy-preserving: we only ever expose city/country, never exact GPS).
CITY_COUNTRY = {
    "london": "United Kingdom", "manchester": "United Kingdom", "birmingham": "United Kingdom",
    "mumbai": "India", "delhi": "India", "bangalore": "India", "bengaluru": "India",
    "singapore": "Singapore",
    "barcelona": "Spain", "madrid": "Spain",
    "dubai": "United Arab Emirates", "abu dhabi": "United Arab Emirates",
    "new york": "United States", "los angeles": "United States", "san francisco": "United States",
    "sydney": "Australia", "melbourne": "Australia",
    "tokyo": "Japan", "osaka": "Japan",
    "toronto": "Canada", "vancouver": "Canada",
    "paris": "France", "berlin": "Germany",
}


def country_of(city: Optional[str]) -> Optional[str]:
    if not city:
        return None
    return CITY_COUNTRY.get(city.strip().lower())


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


@api.get("/me/dashboard")
async def dashboard(u: dict = Depends(current_user)):
    ps = await DB.player_sports.find({"user_id": u["id"]}, {"_id": 0}).sort("rating", -1).to_list(50)
    uas_info = await _uas_for_user(u["id"])
    cards = []
    for entry in ps:
        rank, total = await _rank_for_user(u["id"], entry["sport_id"], entry["rating"])
        pct = uas_info["percentiles"].get(entry["sport_id"], 0.0)
        sport = SPORT_BY_ID[entry["sport_id"]]
        cards.append({
            **entry,
            "sport_name": sport["name"],
            "decimals": sport["decimals"],
            "accent": sport["accent"],
            "rank": rank,
            "population": total,
            "percentile": pct,
            "band": band_for_percentile(pct),
        })
    total_matches = await DB.matches.count_documents({"participants": u["id"], "status": "verified"})
    return {
        "user": public_user(u),
        "uas": uas_info["uas"],
        "sports_counted": uas_info["sports_counted"],
        "total_matches": total_matches,
        "cards": cards,
    }


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
async def rankings_sport(sport_id: str, limit: int = 100, city: Optional[str] = None, country: Optional[str] = None):
    if sport_id not in SPORT_BY_ID:
        raise HTTPException(404, "Sport not found")
    docs = await DB.player_sports.find({"sport_id": sport_id}, {"_id": 0}).sort("rating", -1).limit(500).to_list(500)
    user_ids = [d["user_id"] for d in docs]
    users = await DB.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "display_name": 1, "city": 1, "username": 1}).to_list(1000)
    umap = {u["id"]: u for u in users}
    city_f = (city or "").strip().lower() or None
    country_f = (country or "").strip().lower() or None
    rows = []
    for d in docs:
        usr = umap.get(d["user_id"], {})
        uc = (usr.get("city") or "")
        ucountry = country_of(uc)
        if city_f and uc.lower() != city_f:
            continue
        if country_f and (ucountry or "").lower() != country_f:
            continue
        rows.append({
            "rank": len(rows) + 1,
            "user_id": d["user_id"],
            "display_name": usr.get("display_name") or "Athlete",
            "username": usr.get("username"),
            "city": usr.get("city"),
            "country": ucountry,
            "rating": d["rating"],
            "provisional": d.get("provisional", False),
            "matches_played": d.get("matches_played", 0),
        })
        if len(rows) >= limit:
            break
    return {"sport": SPORT_BY_ID[sport_id], "rows": rows}


@api.get("/rankings/uas")
async def rankings_uas(limit: int = 100, city: Optional[str] = None, country: Optional[str] = None):
    # Aggregate: compute UAS for every user with at least one sport.
    pipeline = [{"$group": {"_id": "$user_id"}}]
    user_ids = [r["_id"] async for r in DB.player_sports.aggregate(pipeline)]
    scored = []
    for uid in user_ids:
        info = await _uas_for_user(uid)
        if info["sports_counted"] == 0: continue
        scored.append({"user_id": uid, "uas": info["uas"], "sports_counted": info["sports_counted"]})
    scored.sort(key=lambda x: (-x["uas"], -x["sports_counted"]))
    users = await DB.users.find({"id": {"$in": [s["user_id"] for s in scored]}}, {"_id": 0, "id": 1, "display_name": 1, "city": 1}).to_list(2000)
    umap = {u["id"]: u for u in users}
    city_f = (city or "").strip().lower() or None
    country_f = (country or "").strip().lower() or None
    rows = []
    for s in scored:
        u = umap.get(s["user_id"], {})
        uc = (u.get("city") or "")
        ucountry = country_of(uc)
        if city_f and uc.lower() != city_f:
            continue
        if country_f and (ucountry or "").lower() != country_f:
            continue
        rows.append({
            "rank": len(rows) + 1, "user_id": s["user_id"], "uas": s["uas"], "sports_counted": s["sports_counted"],
            "display_name": u.get("display_name") or "Athlete", "city": u.get("city"), "country": ucountry,
        })
        if len(rows) >= limit:
            break
    return {"rows": rows}


# ---------- Opponent search ----------
@api.get("/opponents/search")
async def opponents_search(sport_id: str, q: str = "", u: dict = Depends(current_user)):
    """Return ALL athletes as potential opponents for any ATHLERA sport.

    Players who already have a rating for the sport are shown with their real
    rating first; everyone else is shown with the sport's provisional default so
    a user can score a match against them (the sport is auto-added on scoring)."""
    if sport_id not in SPORT_BY_ID:
        raise HTTPException(404, "Sport not found")
    q = (q or "").strip().lower()
    sport = SPORT_BY_ID[sport_id]
    ps_docs = await DB.player_sports.find(
        {"sport_id": sport_id, "user_id": {"$ne": u["id"]}}, {"_id": 0}
    ).to_list(2000)
    ps_map = {d["user_id"]: d for d in ps_docs}
    users = await DB.users.find(
        {"id": {"$ne": u["id"]}},
        {"_id": 0, "id": 1, "display_name": 1, "username": 1, "city": 1},
    ).to_list(3000)
    prov_default = round(sport["default_rating"], sport["decimals"])
    rated: list[dict] = []
    unrated: list[dict] = []
    for usr in users:
        name = (usr.get("display_name") or "").lower()
        uname = (usr.get("username") or "").lower()
        if q and q not in name and q not in uname:
            continue
        d = ps_map.get(usr["id"])
        row = {
            "user_id": usr["id"],
            "display_name": usr.get("display_name") or "Athlete",
            "username": usr.get("username"),
            "city": usr.get("city"),
            "rating": d["rating"] if d else prov_default,
            "provisional": d.get("provisional", True) if d else True,
            "plays_sport": bool(d),
        }
        (rated if d else unrated).append(row)
    rated.sort(key=lambda r: r["rating"], reverse=True)
    unrated.sort(key=lambda r: r["display_name"].lower())
    return {"opponents": (rated + unrated)[:60]}


# ---------- Match preview & submit ----------
async def _get_ps(user_id: str, sport_id: str) -> Optional[dict]:
    return await DB.player_sports.find_one({"user_id": user_id, "sport_id": sport_id}, {"_id": 0})


@api.post("/matches/preview")
async def match_preview(body: MatchPreviewIn, u: dict = Depends(current_user)):
    if body.sport_id not in SPORT_BY_ID:
        raise HTTPException(404, "Sport not found")
    my_ps = await _get_ps(u["id"], body.sport_id)
    if not my_ps:
        my_ps = await ensure_player_sport(u["id"], body.sport_id)
    opp_ps = await _get_ps(body.opponent_user_id, body.sport_id)
    if not opp_ps:
        opp_ps = await ensure_player_sport(body.opponent_user_id, body.sport_id)

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
    return {"match": {k: v for k, v in doc.items() if k != "_id"}}


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
    # Auto-generate a social feed post for this verified result.
    try:
        await _create_match_feed_post(match_id, rating_changes)
    except Exception as exc:  # never block match finalisation on feed
        log.warning("feed post failed: %s", exc)
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
async def upcoming_events(u: dict = Depends(current_user), city: Optional[str] = None, country: Optional[str] = None):
    # Only PUBLIC events appear in discovery.
    docs = await DB.events.find({"visibility": "public", "status": "open"}, {"_id": 0}).sort("starts_at", 1).limit(200).to_list(200)
    city_f = (city or "").strip().lower() or None
    country_f = (country or "").strip().lower() or None
    out = []
    for e in docs:
        ecity = (e.get("city") or "")
        ecountry = e.get("country") or country_of(ecity)
        if city_f and ecity.lower() != city_f:
            continue
        if country_f and (ecountry or "").lower() != country_f:
            continue
        out.append({**e, "country": ecountry,
                    "registered": len(e.get("registered_user_ids", [])),
                    "entry_fee": f'{e.get("fee")} {e.get("currency")}' if e.get("is_paid") else "FREE"})
    return {"events": out}


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


REACTION_TYPES = ["like", "fire", "clap", "muscle", "trophy"]


async def _create_match_feed_post(match_id: str, rating_changes: dict | None = None) -> None:
    m = await DB.matches.find_one({"id": match_id}, {"_id": 0})
    if not m:
        return
    if await DB.feed_posts.find_one({"match_id": match_id, "kind": "match_result"}, {"_id": 0, "id": 1}):
        return  # already posted
    winner_id = m["winner_user_id"]
    loser_id = [p for p in m["participants"] if p != winner_id][0]
    rc = rating_changes or m.get("rating_changes") or {}
    win_delta = (rc.get(winner_id) or {}).get("delta")
    post = {
        "id": str(uuid.uuid4()),
        "kind": "match_result",
        "user_id": winner_id,
        "match_id": match_id,
        "competition_id": m.get("competition_id"),
        "sport_id": m["sport_id"],
        "participants": m["participants"],
        "winner_user_id": winner_id,
        "loser_user_id": loser_id,
        "score": " · ".join([f"{g[0]}-{g[1]}" for g in m.get("games", [])]),
        "rating_delta": win_delta,
        "tag": (m.get("preview") or {}).get("tag"),
        "text": None,
        "reactions": {},
        "comments": [],
        "created_at": now_utc(),
    }
    await DB.feed_posts.insert_one(post)


async def _enrich_feed_posts(posts: list[dict], me_id: str) -> list[dict]:
    uids: set[str] = set()
    for p in posts:
        uids.update(p.get("participants") or [])
        if p.get("user_id"):
            uids.add(p["user_id"])
        for c in p.get("comments", []):
            uids.add(c["user_id"])
        for rid in (p.get("reactions") or {}).keys():
            uids.add(rid)
    users = await DB.users.find({"id": {"$in": list(uids)}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}).to_list(2000)
    umap = {x["id"]: x for x in users}

    def nm(uid: str) -> str:
        return (umap.get(uid) or {}).get("display_name") or "Athlete"

    out = []
    for p in posts:
        reactions = p.get("reactions") or {}
        counts: dict[str, int] = {}
        for rtype in reactions.values():
            counts[rtype] = counts.get(rtype, 0) + 1
        sport = SPORT_BY_ID.get(p.get("sport_id"), {})
        comments = sorted(p.get("comments", []), key=lambda c: c.get("created_at") or now_utc())
        out.append({
            "id": p["id"],
            "kind": p.get("kind", "match_result"),
            "author_id": p.get("user_id"),
            "author_name": nm(p.get("user_id")) if p.get("user_id") else None,
            "sport_id": p.get("sport_id"),
            "sport_name": sport.get("name"),
            "sport_accent": sport.get("accent"),
            "match_id": p.get("match_id"),
            "competition_id": p.get("competition_id"),
            "winner_user_id": p.get("winner_user_id"),
            "loser_user_id": p.get("loser_user_id"),
            "winner_name": nm(p["winner_user_id"]) if p.get("winner_user_id") else None,
            "loser_name": nm(p["loser_user_id"]) if p.get("loser_user_id") else None,
            "score": p.get("score"),
            "rating_delta": p.get("rating_delta"),
            "tag": p.get("tag"),
            "text": p.get("text"),
            "reaction_counts": counts,
            "reaction_total": sum(counts.values()),
            "my_reaction": reactions.get(me_id),
            "comment_count": len(comments),
            "recent_comments": [
                {"id": c["id"], "user_id": c["user_id"], "author_name": nm(c["user_id"]),
                 "text": c["text"], "created_at": _iso(c.get("created_at"))}
                for c in comments[-2:]
            ],
            "created_at": _iso(p.get("created_at")),
        })
    return out


def _iso(v):
    return v.isoformat() if isinstance(v, datetime) else v


@api.get("/social/feed")
async def social_feed(u: dict = Depends(current_user)):
    posts = await DB.feed_posts.find({}, {"_id": 0}).sort("created_at", -1).limit(60).to_list(60)
    # Backfill: if no posts yet, derive from recent verified matches so the feed isn't empty.
    if not posts:
        matches = await DB.matches.find({"status": "verified"}, {"_id": 0}).sort("created_at", -1).limit(20).to_list(20)
        for m in matches:
            try:
                await _create_match_feed_post(m["id"], m.get("rating_changes"))
            except Exception:
                pass
        posts = await DB.feed_posts.find({}, {"_id": 0}).sort("created_at", -1).limit(60).to_list(60)
    return {"items": await _enrich_feed_posts(posts, u["id"])}


class ReactIn(BaseModel):
    reaction: Optional[str] = None  # None clears


class CommentIn(BaseModel):
    text: str


class ShareMatchIn(BaseModel):
    match_id: str
    text: Optional[str] = None


@api.post("/feed/{post_id}/react")
async def feed_react(post_id: str, body: ReactIn, u: dict = Depends(current_user)):
    post = await DB.feed_posts.find_one({"id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(404, "Post not found")
    reactions = post.get("reactions") or {}
    if body.reaction is None or reactions.get(u["id"]) == body.reaction:
        reactions.pop(u["id"], None)
    else:
        if body.reaction not in REACTION_TYPES:
            raise HTTPException(400, "Unknown reaction")
        reactions[u["id"]] = body.reaction
    await DB.feed_posts.update_one({"id": post_id}, {"$set": {"reactions": reactions}})
    counts: dict[str, int] = {}
    for rtype in reactions.values():
        counts[rtype] = counts.get(rtype, 0) + 1
    return {"reaction_counts": counts, "reaction_total": sum(counts.values()), "my_reaction": reactions.get(u["id"])}


@api.post("/feed/{post_id}/comment")
async def feed_comment(post_id: str, body: CommentIn, u: dict = Depends(current_user)):
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "Comment cannot be empty")
    post = await DB.feed_posts.find_one({"id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(404, "Post not found")
    comment = {"id": str(uuid.uuid4()), "user_id": u["id"], "text": text[:500], "created_at": now_utc()}
    await DB.feed_posts.update_one({"id": post_id}, {"$push": {"comments": comment}})
    return {"comment": {**comment, "author_name": u.get("display_name") or "Athlete", "created_at": _iso(comment["created_at"])}}


@api.get("/feed/{post_id}")
async def feed_detail(post_id: str, u: dict = Depends(current_user)):
    post = await DB.feed_posts.find_one({"id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(404, "Post not found")
    enriched = (await _enrich_feed_posts([post], u["id"]))[0]
    uids = list({c["user_id"] for c in post.get("comments", [])})
    users = await DB.users.find({"id": {"$in": uids}}, {"_id": 0, "id": 1, "display_name": 1}).to_list(1000)
    umap = {x["id"]: x for x in users}
    enriched["comments"] = [
        {"id": c["id"], "user_id": c["user_id"], "author_name": (umap.get(c["user_id"]) or {}).get("display_name") or "Athlete",
         "text": c["text"], "created_at": _iso(c.get("created_at"))}
        for c in sorted(post.get("comments", []), key=lambda c: c.get("created_at") or now_utc())
    ]
    return {"post": enriched}


@api.post("/feed/share-match")
async def feed_share_match(body: ShareMatchIn, u: dict = Depends(current_user)):
    m = await DB.matches.find_one({"id": body.match_id}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Match not found")
    if u["id"] not in m.get("participants", []):
        raise HTTPException(403, "You can only share your own matches")
    winner_id = m["winner_user_id"]
    loser_id = [p for p in m["participants"] if p != winner_id][0]
    rc = m.get("rating_changes") or {}
    post = {
        "id": str(uuid.uuid4()),
        "kind": "shared_match",
        "user_id": u["id"],
        "match_id": body.match_id,
        "competition_id": m.get("competition_id"),
        "sport_id": m["sport_id"],
        "participants": m["participants"],
        "winner_user_id": winner_id,
        "loser_user_id": loser_id,
        "score": " · ".join([f"{g[0]}-{g[1]}" for g in m.get("games", [])]),
        "rating_delta": (rc.get(u["id"]) or {}).get("delta"),
        "tag": (m.get("preview") or {}).get("tag"),
        "text": (body.text or "").strip()[:500] or None,
        "reactions": {},
        "comments": [],
        "created_at": now_utc(),
    }
    await DB.feed_posts.insert_one(post)
    return {"post": (await _enrich_feed_posts([post], u["id"]))[0]}


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
    filt: dict[str, Any] = {"visibility": "public"}
    if sport_id:
        filt["sport_id"] = sport_id
    docs = await DB.competitions.find(filt, {"_id": 0}).sort("created_at", -1).limit(50).to_list(50)
    return {"competitions": [await _competition_public(c, u["id"]) for c in docs]}


@api.get("/competitions/mine")
async def competitions_mine(u: dict = Depends(current_user)):
    mem = await DB.competition_members.find({"user_id": u["id"], "status": "approved"}, {"_id": 0}).to_list(200)
    cids = [m["competition_id"] for m in mem]
    docs = await DB.competitions.find({"id": {"$in": cids}}, {"_id": 0}).to_list(200)
    return {"competitions": [await _competition_public(c, u["id"]) for c in docs]}


@api.get("/competitions/{cid}")
async def competition_detail(cid: str, u: dict = Depends(current_user)):
    c = await DB.competitions.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Competition not found")
    pub = await _competition_public(c, u["id"])
    fixtures = await DB.fixtures.find({"competition_id": cid}, {"_id": 0}).sort([("round", 1), ("created_at", 1)]).to_list(500)
    standings = await _compute_standings(cid) if c["type"] in ("league", "tournament") else []
    return {"competition": pub, "fixtures": fixtures, "standings": standings}


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
        if c.get("fixture_mode") == "manual":
            pairs = [tuple(pair) for pair in c.get("manual_pairs", []) if len(pair) == 2]
            if not pairs:
                raise HTTPException(400, "Add at least one manual pairing")
            if any(a not in players or b not in players or a == b for a, b in pairs):
                raise HTTPException(400, "Manual pairing contains an invalid participant")
        else:
            pairs = _round_robin(players, c.get("matches_per_opponent", 1))
        # No date/time is set at generation time, so every league fixture starts
        # Unscheduled; organisers add dates later via Manage Fixtures.
        initial_status = "unscheduled"
        for idx, (a, b) in enumerate(pairs):
            await DB.fixtures.insert_one({
                "id": str(uuid.uuid4()), "competition_id": cid, "round": 1, "index": idx,
                "sides": [{"side": 0, "user_ids": [a]}, {"side": 1, "user_ids": [b]}],
                "status": initial_status, "winner_side": None, "score": None, "match_id": None,
                "scheduled_at": None,
                "created_at": now_utc(),
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
            status = "unscheduled"
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
        fixture_status = "bye" if (bool(a) != bool(b)) else "unscheduled"
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
        final = await DB.fixtures.find({"competition_id": f["competition_id"]}, {"_id": 0}).sort("round", -1).limit(1).to_list(1)
        if final and final[0]["round"] == f["round"]:
            last_round = await DB.fixtures.find({"competition_id": f["competition_id"], "round": f["round"]}, {"_id": 0}).to_list(50)
            if len(last_round) == 1 and last_round[0]["winner_side"] is not None:
                champ = last_round[0]["sides"][last_round[0]["winner_side"]]["user_ids"]
                await DB.competitions.update_one({"id": f["competition_id"]}, {"$set": {"status": "complete", "champion_ids": champ}})


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
    registration_opens: Optional[str] = None
    registration_closes: Optional[str] = None
    starts_at: Optional[str] = None


@api.post("/events/create")
async def event_create(body: EventCreateIn, u: dict = Depends(current_user)):
    if u.get("is_guest"):
        raise HTTPException(403, "Create an account to create events")
    if body.sport_id not in SPORT_BY_ID or body.format not in ("league", "knockout"):
        raise HTTPException(400, "Invalid event sport or format")
    if body.capacity < 2 or (body.is_paid and (body.fee is None or body.fee < 0)):
        raise HTTPException(400, "Invalid event capacity or fee")
    eid = str(uuid.uuid4())
    payload = body.model_dump()
    payload["country"] = body.country or country_of(body.city)
    doc = {"id": eid, **payload, "organiser_id": u["id"], "registered_user_ids": [], "status": "open", "created_at": now_utc()}
    await DB.events.insert_one(doc)
    return {"event": {k: v for k, v in doc.items() if k != "_id"}}


@api.get("/events/{event_id}")
async def event_detail(event_id: str, u: dict = Depends(current_user)):
    event = await DB.events.find_one({"id": event_id}, {"_id": 0})
    if not event or (event.get("visibility") != "public" and event.get("organiser_id") != u["id"] and u["id"] not in event.get("registered_user_ids", [])):
        raise HTTPException(404, "Event not found")
    reg_ids = event.get("registered_user_ids", [])
    parts = await DB.users.find({"id": {"$in": reg_ids}}, {"_id": 0, "id": 1, "display_name": 1, "city": 1}).to_list(500)
    event["registered"] = len(reg_ids)
    event["is_registered"] = u["id"] in reg_ids
    event["is_organiser"] = event.get("organiser_id") == u["id"]
    event["country"] = event.get("country") or country_of(event.get("city"))
    event["participants"] = [{"user_id": p["id"], "display_name": p.get("display_name") or "Athlete", "city": p.get("city")} for p in parts]
    return {"event": event}


@api.post("/events/{event_id}/manage")
async def event_manage(event_id: str, body: dict, u: dict = Depends(current_user)):
    """Organiser-only admin: edit info, remove a participant, or open/close the event."""
    event = await DB.events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(404, "Event not found")
    if event.get("organiser_id") != u["id"]:
        raise HTTPException(403, "Only the organiser can manage this event")
    action = body.get("action")
    if action == "remove_participant":
        await DB.events.update_one({"id": event_id}, {"$pull": {"registered_user_ids": body.get("user_id")}})
    elif action == "set_status":
        await DB.events.update_one({"id": event_id}, {"$set": {"status": body.get("status", "open")}})
    elif action == "edit":
        allowed = {k: body[k] for k in ("name", "venue", "city", "country", "capacity", "is_paid", "fee", "currency", "starts_at", "visibility") if k in body}
        if "city" in allowed and "country" not in allowed:
            allowed["country"] = country_of(allowed["city"])
        if allowed:
            await DB.events.update_one({"id": event_id}, {"$set": allowed})
    else:
        raise HTTPException(400, "Unknown action")
    return {"ok": True}


@api.post("/events/{event_id}/register")
async def event_register(event_id: str, u: dict = Depends(current_user)):
    event = await DB.events.find_one({"id": event_id}, {"_id": 0})
    if not event or event.get("visibility") != "public":
        raise HTTPException(404, "Public event not found")
    ids = event.get("registered_user_ids", [])
    if u["id"] not in ids:
        if len(ids) >= event["capacity"]:
            raise HTTPException(400, "Event is full")
        await DB.events.update_one({"id": event_id}, {"$push": {"registered_user_ids": u["id"]}})
    return {"ok": True, "registered": True}


@api.post("/events/{event_id}/withdraw")
async def event_withdraw(event_id: str, u: dict = Depends(current_user)):
    await DB.events.update_one({"id": event_id}, {"$pull": {"registered_user_ids": u["id"]}})
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
        is_mine = d["user_id"] == u["id"]
        resp_count = await DB.ltp_responses.count_documents({"post_id": d["id"]})
        my_resp = None if is_mine else await DB.ltp_responses.find_one({"post_id": d["id"], "from_user_id": u["id"]}, {"_id": 0, "id": 1})
        out.append({**d, "display_name": usr.get("display_name", "Athlete"), "city": usr.get("city"),
                    "sport": SPORT_BY_ID[d["sport_id"]], "is_mine": is_mine,
                    "response_count": resp_count, "has_responded": bool(my_resp)})
    return {"posts": out}


class LTPRespondIn(BaseModel):
    message: Optional[str] = None
    start_conversation: bool = False


@api.post("/ltp/{post_id}/respond")
async def ltp_respond(post_id: str, body: LTPRespondIn, u: dict = Depends(current_user)):
    if u.get("is_guest"):
        raise HTTPException(403, "Create an account to respond")
    post = await DB.ltp_posts.find_one({"id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(404, "Post not found")
    if post["user_id"] == u["id"]:
        raise HTTPException(400, "You cannot respond to your own post")
    creator = post["user_id"]
    existing = await DB.ltp_responses.find_one({"post_id": post_id, "from_user_id": u["id"]}, {"_id": 0})
    if existing:
        await DB.ltp_responses.update_one({"id": existing["id"]}, {"$set": {"message": body.message or existing.get("message"), "updated_at": now_utc()}})
        resp_id = existing["id"]
    else:
        resp_id = str(uuid.uuid4())
        await DB.ltp_responses.insert_one({
            "id": resp_id, "post_id": post_id, "from_user_id": u["id"], "to_user_id": creator,
            "sport_id": post["sport_id"], "message": body.message, "status": "interested",
            "created_at": now_utc(),
        })
    conv_id = None
    if body.start_conversation or body.message:
        conv_id = _conv_id(u["id"], creator)
        await DB.conversations.update_one(
            {"id": conv_id},
            {"$set": {"id": conv_id, "members": sorted([u["id"], creator]), "updated_at": now_utc()},
             "$setOnInsert": {"created_at": now_utc()}},
            upsert=True,
        )
        text = body.message or f"Hi! I'm interested in playing {SPORT_BY_ID[post['sport_id']]['name']} ({post.get('when_text','')})."
        await DB.messages.insert_one({"id": str(uuid.uuid4()), "conversation_id": conv_id,
                                      "from_user_id": u["id"], "text": text, "created_at": now_utc()})
    return {"ok": True, "response_id": resp_id, "conversation_id": conv_id, "creator_id": creator}


@api.get("/ltp/{post_id}/responses")
async def ltp_responses_list(post_id: str, u: dict = Depends(current_user)):
    post = await DB.ltp_posts.find_one({"id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(404, "Post not found")
    if post["user_id"] != u["id"]:
        raise HTTPException(403, "Only the post creator can view responses")
    resps = await DB.ltp_responses.find({"post_id": post_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    uids = [r["from_user_id"] for r in resps]
    users = await DB.users.find({"id": {"$in": uids}}, {"_id": 0, "id": 1, "display_name": 1, "city": 1}).to_list(200)
    umap = {x["id"]: x for x in users}
    ps = await DB.player_sports.find({"sport_id": post["sport_id"], "user_id": {"$in": uids}}, {"_id": 0, "user_id": 1, "rating": 1, "provisional": 1}).to_list(200)
    rmap = {p["user_id"]: p for p in ps}
    out = []
    for r in resps:
        usr = umap.get(r["from_user_id"], {})
        rating = rmap.get(r["from_user_id"])
        out.append({
            "id": r["id"], "from_user_id": r["from_user_id"],
            "display_name": usr.get("display_name", "Athlete"), "city": usr.get("city"),
            "rating": rating["rating"] if rating else None, "provisional": rating.get("provisional", True) if rating else True,
            "message": r.get("message"), "status": r.get("status", "interested"),
            "created_at": _iso(r.get("created_at")),
        })
    return {"post": {"id": post["id"], "sport_id": post["sport_id"], "sport": SPORT_BY_ID[post["sport_id"]],
                     "when_text": post.get("when_text"), "area": post.get("area")}, "responses": out}


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
async def social_nearby(sport_id: Optional[str] = None, u: dict = Depends(current_user)):
    filt: dict[str, Any] = {"user_id": {"$ne": u["id"]}}
    if sport_id:
        filt["sport_id"] = sport_id
    ps = await DB.player_sports.find(filt, {"_id": 0}).sort("rating", -1).limit(60).to_list(60)
    uids = list({p["user_id"] for p in ps})
    users = await DB.users.find({"id": {"$in": uids}}, {"_id": 0, "id": 1, "display_name": 1, "city": 1}).to_list(200)
    umap = {x["id"]: x for x in users}
    import random
    seen = set()
    out = []
    for p in ps:
        if p["user_id"] in seen:
            continue
        seen.add(p["user_id"])
        usr = umap.get(p["user_id"], {})
        random.seed(hash(p["user_id"]))
        out.append({
            "user_id": p["user_id"], "display_name": usr.get("display_name", "Athlete"),
            "area": usr.get("city", "Nearby"), "distance_km": round(random.uniform(0.5, 12.0), 1),
            "sport_id": p["sport_id"], "sport": SPORT_BY_ID[p["sport_id"]], "rating": p["rating"],
        })
        if len(out) >= 30:
            break
    out.sort(key=lambda x: x["distance_km"])
    return {"players": out}


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
    category: Optional[str] = None,  # oneoff | league | knockout
    competition_id: Optional[str] = None,
):
    filt: dict[str, Any] = {"participants": u["id"], "status": "verified"}
    if sport_id:
        filt["sport_id"] = sport_id
    if source:
        filt["source"] = source
    if competition_id:
        filt["competition_id"] = competition_id
    if opponent_id:
        filt["participants"] = {"$all": [u["id"], opponent_id]}
    docs = await DB.matches.find(filt, {"_id": 0}).sort("created_at", -1).limit(200).to_list(200)
    other_ids = list({p for m in docs for p in m["participants"] if p != u["id"]})
    users = await DB.users.find({"id": {"$in": other_ids}}, {"_id": 0, "id": 1, "display_name": 1}).to_list(500)
    umap = {x["id"]: x.get("display_name", "Athlete") for x in users}
    comp_ids = list({m.get("competition_id") for m in docs if m.get("competition_id")})
    comps = await DB.competitions.find({"id": {"$in": comp_ids}}, {"_id": 0, "id": 1, "type": 1, "name": 1}).to_list(500)
    cmap = {c["id"]: c for c in comps}
    out = []
    for m in docs:
        won = m.get("winner_user_id") == u["id"] or (u["id"] in (m["sides"][m["winner_side"]]["user_ids"] if m.get("winner_side") is not None else []))
        if result == "win" and not won:
            continue
        if result == "loss" and won:
            continue
        comp = cmap.get(m.get("competition_id"))
        cat = "knockout" if (comp and comp.get("type") == "knockout") else "league" if comp else "oneoff"
        if category and cat != category:
            continue
        rc = (m.get("rating_changes") or {}).get(u["id"], {})
        others = [p for p in m["participants"] if p != u["id"]]
        out.append({
            "id": m["id"], "sport_id": m["sport_id"], "sport": SPORT_BY_ID[m["sport_id"]],
            "games": m.get("games", []), "won": won, "source": m.get("source", "manual"),
            "competition_id": m.get("competition_id"),
            "competition_name": (comp or {}).get("name"),
            "category": cat,
            "score": " · ".join([f"{g[0]}-{g[1]}" for g in m.get("games", [])]),
            "opponent_name": umap.get(others[0], "Athlete") if others else "Athlete",
            "rating_before": rc.get("before"), "rating_after": rc.get("after"), "rating_delta": rc.get("delta"),
            "created_at": m["created_at"].isoformat() if isinstance(m.get("created_at"), datetime) else m.get("created_at"),
        })
    return {"matches": out}


@api.get("/sports/{sport_id}/rating-history")
async def sport_rating_history(sport_id: str, u: dict = Depends(current_user)):
    docs = await DB.rating_history.find({"user_id": u["id"], "sport_id": sport_id}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return {"history": [{"before": d["before"], "after": d["after"], "delta": d["delta"],
                         "created_at": d["created_at"].isoformat() if isinstance(d.get("created_at"), datetime) else d.get("created_at")} for d in docs]}


@api.get("/matches/detail/{match_id}")
async def match_detail(match_id: str, u: dict = Depends(current_user)):
    m = await DB.matches.find_one({"id": match_id}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Match not found")
    users = await DB.users.find({"id": {"$in": m.get("participants", [])}},
                                {"_id": 0, "id": 1, "display_name": 1, "username": 1}).to_list(20)
    umap = {x["id"]: x for x in users}
    sport = SPORT_BY_ID.get(m["sport_id"], {})
    comp = None
    if m.get("competition_id"):
        comp = await DB.competitions.find_one({"id": m["competition_id"]}, {"_id": 0, "id": 1, "name": 1, "type": 1})
    shared = await DB.feed_posts.find_one({"match_id": match_id, "user_id": u["id"], "kind": "shared_match"}, {"_id": 0, "id": 1})
    return {
        "match": {
            "id": m["id"],
            "sport_id": m["sport_id"],
            "sport_name": sport.get("name"),
            "sport_accent": sport.get("accent"),
            "decimals": sport.get("decimals", 0),
            "participants": [{"user_id": p, "display_name": (umap.get(p) or {}).get("display_name") or "Athlete"} for p in m.get("participants", [])],
            "sides": m.get("sides"),
            "games": m.get("games", []),
            "score": " · ".join([f"{g[0]}-{g[1]}" for g in m.get("games", [])]),
            "winner_user_id": m.get("winner_user_id"),
            "status": m.get("status"),
            "note": m.get("note"),
            "preview": m.get("preview"),
            "rating_changes": m.get("rating_changes"),
            "competition": comp,
            "category": ("knockout" if (comp and comp.get("type") == "knockout") else "league" if comp else "oneoff"),
            "created_at": _iso(m.get("created_at")),
            "already_shared": bool(shared),
        }
    }


app.include_router(api)


@app.on_event("shutdown")
async def _shutdown():
    if client:
        client.close()
