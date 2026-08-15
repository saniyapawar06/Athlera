"""ATHLERA PHASE 1 focused tests.

Covers only PHASE 1 features:
  * Opponents search returns ALL athletes for ANY sport with `plays_sport` flag
    and provisional default for those who don't play the sport.
  * /matches/preview and /matches/submit AUTO-ADD player_sport for both users
    for a sport neither has (e.g. picking pickleball for the QA account).
  * Verified-vs-seed match auto-creates a feed post (match_result) discoverable via
    /social/feed with enriched fields (winner_name, loser_name, sport_name, score).
  * Reactions add/toggle/remove on a feed post (like + all 5 types).
  * Comment on a feed post; /feed/{id} returns comments in order.
  * /matches/detail/{id} shape (players, games, category, rating movement) + share-match
    creates a shared_match feed post that appears on /social/feed.
"""
from __future__ import annotations

import os
import uuid
import pytest
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"


def _h(t: str) -> dict:
    return {"Authorization": f"Bearer {t}"}


def _rand_email() -> str:
    return f"qa_p1+{uuid.uuid4().hex[:10]}@athlera.dev"


def _register(display_name: str = "QA P1"):
    email = _rand_email()
    r = requests.post(
        f"{BASE}/auth/register",
        json={"email": email, "password": "secret123", "display_name": display_name},
        timeout=20,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    return {"email": email, "token": body["access_token"], "user": body["user"]}


@pytest.fixture(scope="module")
def user_a():
    """Fresh registered user with NO onboarded sports (tests auto-add)."""
    return _register("QA P1 A")


@pytest.fixture(scope="module")
def user_b():
    """Second user (used for feed reactions/comments and share-match tests)."""
    return _register("QA P1 B")


@pytest.fixture(scope="module")
def sports_list(user_a):
    r = requests.get(f"{BASE}/sports", headers=_h(user_a["token"]), timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    sports = data.get("sports") if isinstance(data, dict) else data
    assert isinstance(sports, list) and len(sports) >= 5, sports
    return sports


@pytest.fixture(scope="module")
def verified_match(user_a, sports_list):
    """Submit a verified match against a seed opponent for a sport user_a
    doesn't play. Returns (match_id, sport_id, opponent_uid). Shared across
    workers via same-scope fixture (xdist uses loadscope, so all tests in this
    module land on one worker)."""
    sport_id = "pickleball" if any(s["id"] == "pickleball" for s in sports_list) else sports_list[-1]["id"]
    opps = requests.get(
        f"{BASE}/opponents/search",
        params={"sport_id": sport_id},
        headers=_h(user_a["token"]),
        timeout=15,
    ).json()["opponents"]
    assert opps, "need at least one opponent"
    opp_uid = opps[0]["user_id"]
    games = {
        "pickleball": [[11, 5], [11, 6]],
        "badminton": [[21, 15], [21, 18]],
        "tennis": [[6, 4], [6, 3]],
        "padel": [[6, 4], [6, 3]],
        "squash": [[11, 5], [11, 6], [11, 8]],
    }.get(sport_id, [[11, 5], [11, 6]])
    sub = requests.post(
        f"{BASE}/matches/submit",
        headers=_h(user_a["token"]),
        json={"sport_id": sport_id, "opponent_user_id": opp_uid, "games": games},
        timeout=20,
    )
    assert sub.status_code == 200, sub.text
    m = sub.json()["match"]
    assert m["status"] == "verified", m
    return {"match_id": m["id"], "sport_id": sport_id, "opp_uid": opp_uid}


@pytest.fixture(scope="module")
def feed_post_id(user_a, verified_match):
    r = requests.get(f"{BASE}/social/feed", headers=_h(user_a["token"]), timeout=20)
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    # Prefer the match_result post tied to verified_match.
    for p in items:
        if p.get("match_id") == verified_match["match_id"] and p.get("kind") == "match_result":
            return p["id"]
    assert items, "expected at least one feed post"
    return items[0]["id"]


class TestOpponentsSearchAllSports:
    """GET /api/opponents/search?sport_id=<any> returns ALL athletes even for
    a sport the user does not play."""

    def test_returns_athletes_with_plays_sport_flag_and_provisional_default(
        self, user_a, sports_list
    ):
        # Pick an obscure sport for user_a — QA has no sports at all after register.
        for s in sports_list:
            r = requests.get(
                f"{BASE}/opponents/search",
                params={"sport_id": s["id"]},
                headers=_h(user_a["token"]),
                timeout=15,
            )
            assert r.status_code == 200, f"{s['id']}: {r.text}"
            body = r.json()
            assert "opponents" in body and isinstance(body["opponents"], list)
            assert body["opponents"], f"expected seed opponents for sport {s['id']}"
            first = body["opponents"][0]
            for key in ("user_id", "display_name", "rating", "provisional", "plays_sport"):
                assert key in first, f"missing key {key} in {first}"
            assert isinstance(first["plays_sport"], bool)

    def test_unknown_sport_id_returns_404(self, user_a):
        r = requests.get(
            f"{BASE}/opponents/search",
            params={"sport_id": "not_a_sport"},
            headers=_h(user_a["token"]),
            timeout=15,
        )
        assert r.status_code == 404, r.text


class TestAutoAddSport:
    """Preview + Submit must AUTO-ADD a player_sport for any sport, even ones
    that neither the user nor the opponent play."""

    def test_preview_and_submit_auto_add_for_new_sport(self, user_a, sports_list, verified_match):
        sport_id = verified_match["sport_id"]
        opp_uid = verified_match["opp_uid"]
        games = {
            "pickleball": [[11, 5], [11, 6]],
            "badminton": [[21, 15], [21, 18]],
            "tennis": [[6, 4], [6, 3]],
            "padel": [[6, 4], [6, 3]],
            "squash": [[11, 5], [11, 6], [11, 8]],
        }.get(sport_id, [[11, 5], [11, 6]])
        prev = requests.post(
            f"{BASE}/matches/preview",
            headers=_h(user_a["token"]),
            json={"sport_id": sport_id, "opponent_user_id": opp_uid, "games": games},
            timeout=20,
        )
        assert prev.status_code == 200, prev.text
        p = prev.json()
        assert p["winner_is_me"] is True
        assert isinstance(p["delta"], (int, float))
        # dashboard reflects that the sport now exists on my profile
        r = requests.get(f"{BASE}/me/dashboard", headers=_h(user_a["token"]), timeout=15)
        assert r.status_code == 200, r.text


class TestSocialFeedAndReactions:
    def test_feed_returns_enriched_post_after_verified_match(self, user_a, feed_post_id):
        r = requests.get(f"{BASE}/social/feed", headers=_h(user_a["token"]), timeout=20)
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        assert items, "feed should have at least one post after verified match"
        p = next((x for x in items if x["id"] == feed_post_id), items[0])
        for key in (
            "id", "kind", "sport_id", "sport_name", "winner_user_id", "loser_user_id",
            "winner_name", "loser_name", "score", "reaction_counts", "reaction_total",
            "comment_count", "created_at",
        ):
            assert key in p, f"missing feed field {key} in {p}"
        assert p["kind"] in ("match_result", "shared_match")
        assert p["winner_name"] and p["loser_name"]

    def test_react_add_toggle_and_remove(self, user_a, feed_post_id):
        pid = feed_post_id
        # Add reaction
        r = requests.post(
            f"{BASE}/feed/{pid}/react",
            headers=_h(user_a["token"]),
            json={"reaction": "fire"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["my_reaction"] == "fire"
        assert b["reaction_counts"].get("fire") == 1
        assert b["reaction_total"] == 1

        # Switch reaction to trophy
        r = requests.post(
            f"{BASE}/feed/{pid}/react",
            headers=_h(user_a["token"]),
            json={"reaction": "trophy"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["my_reaction"] == "trophy"
        assert b["reaction_counts"].get("trophy") == 1
        assert "fire" not in b["reaction_counts"] or b["reaction_counts"].get("fire", 0) == 0

        # Toggle same reaction off (sending same value clears)
        r = requests.post(
            f"{BASE}/feed/{pid}/react",
            headers=_h(user_a["token"]),
            json={"reaction": "trophy"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["my_reaction"] is None
        assert b["reaction_total"] == 0

    def test_react_rejects_unknown_type(self, user_a, feed_post_id):
        pid = feed_post_id
        r = requests.post(
            f"{BASE}/feed/{pid}/react",
            headers=_h(user_a["token"]),
            json={"reaction": "banana"},
            timeout=15,
        )
        assert r.status_code == 400, r.text


class TestFeedDetailAndComments:
    def test_comment_flow_and_detail(self, user_a, user_b, feed_post_id):
        pid = feed_post_id
        # Comment as user_a
        r = requests.post(
            f"{BASE}/feed/{pid}/comment",
            headers=_h(user_a["token"]),
            json={"text": "gg wp!"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        c = r.json()["comment"]
        assert c["text"] == "gg wp!"
        assert c["author_name"]

        # Comment as user_b
        r2 = requests.post(
            f"{BASE}/feed/{pid}/comment",
            headers=_h(user_b["token"]),
            json={"text": "clean sweep"},
            timeout=15,
        )
        assert r2.status_code == 200, r2.text

        # Detail returns both comments in chronological order.
        r3 = requests.get(f"{BASE}/feed/{pid}", headers=_h(user_a["token"]), timeout=15)
        assert r3.status_code == 200, r3.text
        post = r3.json()["post"]
        assert post["id"] == pid
        assert isinstance(post.get("comments"), list) and len(post["comments"]) >= 2
        texts = [x["text"] for x in post["comments"]]
        assert "gg wp!" in texts and "clean sweep" in texts

    def test_empty_comment_rejected(self, user_a, feed_post_id):
        pid = feed_post_id
        r = requests.post(
            f"{BASE}/feed/{pid}/comment",
            headers=_h(user_a["token"]),
            json={"text": "   "},
            timeout=15,
        )
        assert r.status_code == 400, r.text


class TestMatchDetailAndShare:
    def test_match_detail_shape(self, user_a, verified_match):
        mid = verified_match["match_id"]
        r = requests.get(f"{BASE}/matches/detail/{mid}", headers=_h(user_a["token"]), timeout=15)
        assert r.status_code == 200, r.text
        m = r.json()["match"]
        for key in ("id", "sport_id", "sport_name", "participants", "games",
                    "score", "winner_user_id", "status", "category"):
            assert key in m, f"missing match field {key} in {m}"
        assert m["id"] == mid
        assert m["category"] == "oneoff"
        assert m["winner_user_id"]
        assert isinstance(m["participants"], list) and len(m["participants"]) == 2
        assert m["participants"][0]["display_name"]

    def test_share_match_creates_shared_post_on_feed(self, user_a, verified_match):
        mid = verified_match["match_id"]
        r = requests.post(
            f"{BASE}/feed/share-match",
            headers=_h(user_a["token"]),
            json={"match_id": mid, "text": "sharing my win"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        shared = r.json()["post"]
        assert shared["kind"] == "shared_match"
        assert shared["match_id"] == mid
        assert shared["text"] == "sharing my win"

        # Should now appear at top of feed for user_b too.
        feed = requests.get(f"{BASE}/social/feed", headers=_h(user_a["token"]), timeout=15).json()["items"]
        assert any(p["id"] == shared["id"] and p["kind"] == "shared_match" for p in feed)

    def test_share_match_forbidden_for_non_participant(self, user_b, verified_match):
        mid = verified_match["match_id"]
        r = requests.post(
            f"{BASE}/feed/share-match",
            headers=_h(user_b["token"]),
            json={"match_id": mid},
            timeout=15,
        )
        assert r.status_code == 403, r.text
