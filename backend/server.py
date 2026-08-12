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
    # Must be a majority-of-games win
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

    for user_ps, new_rating, is_winner in [
        (w_ps, round(calc["new_winner"], dec), True),
        (l_ps, round(calc["new_loser"], dec), False),
    ]:
        matches_played = user_ps.get("matches_played", 0) + 1
        wins = user_ps.get("wins", 0) + (1 if is_winner else 0)
        peak = max(user_ps.get("peak_rating", new_rating), new_rating)
        still_provisional = user_ps.get("provisional", True) and matches_played < 5
        await DB.player_sports.update_one(
            {"user_id": user_ps["user_id"], "sport_id": sport_id},
            {"$set": {
                "rating": new_rating,
                "peak_rating": peak,
                "matches_played": matches_played,
                "wins": wins,
                "provisional": still_provisional,
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

    await DB.matches.update_one({"id": match_id}, {"$set": {"rating_applied": True, "status": "verified"}})


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
async def upcoming_events():
    # V1: return demo/seed public competitions to make the tab feel alive.
    demo = [
        {"id": "evt-1", "name": "London Winter Open", "sport_id": "squash", "city": "London", "venue": "Battersea SRC", "date": "2026-06-14", "format": "Knockout", "entry_fee": "£25", "capacity": 32, "registered": 18},
        {"id": "evt-2", "name": "Mumbai Padel Nights", "sport_id": "padel", "city": "Mumbai", "venue": "BKC Padel Club", "date": "2026-06-21", "format": "League", "entry_fee": "₹1,500", "capacity": 24, "registered": 12},
        {"id": "evt-3", "name": "Singapore Racquet Series", "sport_id": "tennis", "city": "Singapore", "venue": "Tanglin Club", "date": "2026-07-02", "format": "Tournament", "entry_fee": "S$40", "capacity": 48, "registered": 22},
        {"id": "evt-4", "name": "Barcelona Smash Cup", "sport_id": "badminton", "city": "Barcelona", "venue": "Poliesportiu La Mar Bella", "date": "2026-07-09", "format": "Knockout", "entry_fee": "€15", "capacity": 32, "registered": 27},
        {"id": "evt-5", "name": "Dubai Pickle Bash", "sport_id": "pickleball", "city": "Dubai", "venue": "Reform Social", "date": "2026-06-28", "format": "League", "entry_fee": "AED 100", "capacity": 32, "registered": 8},
    ]
    return {"events": demo}


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
    # V1: derive a lightweight feed from recent verified matches across all users
    matches = await DB.matches.find({"status": "verified"}, {"_id": 0}).sort("created_at", -1).limit(20).to_list(20)
    users = await DB.users.find({}, {"_id": 0, "id": 1, "display_name": 1}).to_list(500)
    umap = {x["id"]: x for x in users}
    items = []
    for m in matches:
        winner = umap.get(m["winner_user_id"], {}).get("display_name", "Athlete")
        loser_id = [p for p in m["participants"] if p != m["winner_user_id"]][0]
        loser = umap.get(loser_id, {}).get("display_name", "Athlete")
        items.append({
            "id": m["id"],
            "type": "match_result",
            "sport_id": m["sport_id"],
            "text": f"{winner} defeated {loser}",
            "score": " · ".join([f"{g[0]}-{g[1]}" for g in m["games"]]),
            "created_at": m["created_at"].isoformat() if isinstance(m.get("created_at"), datetime) else m.get("created_at"),
        })
    return {"items": items}


app.include_router(api)


@app.on_event("shutdown")
async def _shutdown():
    if client:
        client.close()
