"""ATHLERA V4 — new/changed features tests.

Covers:
  * Social feed: match_result item shape + like toggle + comment post/list
  * Knockout bracket: round_name (QUARTER-FINALS/SEMI-FINALS/FINAL), seeds populated
  * League numbered rounds: fixtures grouped with ROUND N in round_name
  * Match history: TYPE filter (oneoff/league/knockout) and match detail shape
  * Nearby city matching: same-city first, no exact coordinates
  * Private competition visibility: organiser sees own private in competitions/list
"""
from __future__ import annotations

import os
import uuid

import pytest
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"

ONBOARD_ALL = [
    {"sport_id": s, "has_accredited": False, "level_id": "intermediate"}
    for s in ("squash", "badminton", "tennis", "padel", "pickleball")
]


def _h(t: str) -> dict:
    return {"Authorization": f"Bearer {t}"}


def _rand_email() -> str:
    return f"qa+v4_{uuid.uuid4().hex[:10]}@athlera.dev"


def _register(dn="QA V4", city=None, sports=ONBOARD_ALL):
    email = _rand_email()
    body = {"email": email, "password": "secret123", "display_name": dn}
    if city:
        body["city"] = city
    r = requests.post(f"{BASE}/auth/register", json=body)
    assert r.status_code == 201, r.text
    tok = r.json()["access_token"]
    user = r.json()["user"]
    if city:
        requests.patch(f"{BASE}/auth/me", headers=_h(tok), json={"city": city})
    if sports:
        ob = requests.post(f"{BASE}/onboarding/submit", headers=_h(tok),
                           json={"submissions": sports})
        assert ob.status_code == 200, ob.text
    return {"email": email, "token": tok, "user": user}


@pytest.fixture(scope="module")
def ua():
    return _register(dn="QA V4 A", city="London")


@pytest.fixture(scope="module")
def ub():
    return _register(dn="QA V4 B", city="London")


@pytest.fixture(scope="module")
def uc():
    return _register(dn="QA V4 C", city="Paris")


# =============== SOCIAL FEED ===============
class TestSocialFeed:
    def test_feed_returns_items_and_shape(self, ua):
        r = requests.get(f"{BASE}/social/feed", headers=_h(ua["token"]))
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        # every item must expose the frontend-required fields
        for it in items[:5]:
            for k in ("id", "type", "like_count", "comment_count", "liked_by_me"):
                assert k in it, f"missing {k}: {it}"

    def test_like_toggle_and_comment_post(self, ua, ub):
        # Produce at least one match_result item via a manual submit
        # Use manual matches/submit + confirm loop; simpler: pick an existing feed item if any.
        feed = requests.get(f"{BASE}/social/feed", headers=_h(ua["token"])).json()["items"]
        # Seed at least one match if none exist
        if not feed:
            # simple squash manual submit
            opp = requests.get(f"{BASE}/opponents/search", params={"sport_id": "squash"},
                               headers=_h(ua["token"])).json()["opponents"][0]["user_id"]
            sub = requests.post(f"{BASE}/matches/submit", headers=_h(ua["token"]), json={
                "sport_id": "squash", "opponent_user_id": opp,
                "games": [[11, 5], [11, 7], [11, 6]], "best_of": 5,
            })
            assert sub.status_code == 200, sub.text
            feed = requests.get(f"{BASE}/social/feed", headers=_h(ua["token"])).json()["items"]
        assert feed, "expected at least one feed item"
        item = feed[0]
        # Toggle like ON
        r = requests.post(f"{BASE}/social/feed/{item['id']}/like", headers=_h(ub["token"]))
        assert r.status_code == 200, r.text
        assert r.json()["liked"] is True
        count_after = r.json()["like_count"]
        assert count_after >= 1
        # Post a comment
        c = requests.post(f"{BASE}/social/feed/{item['id']}/comment",
                          headers=_h(ub["token"]), json={"text": "TEST_v4 nice match"})
        assert c.status_code == 200, c.text
        assert c.json()["comment_count"] >= 1
        # List comments and verify persisted
        gl = requests.get(f"{BASE}/social/feed/{item['id']}/comments", headers=_h(ub["token"]))
        assert gl.status_code == 200
        texts = [c["text"] for c in gl.json()["comments"]]
        assert any("TEST_v4" in t for t in texts)
        # Toggle like OFF
        r2 = requests.post(f"{BASE}/social/feed/{item['id']}/like", headers=_h(ub["token"]))
        assert r2.status_code == 200
        assert r2.json()["liked"] is False

    def test_comment_empty_rejected(self, ua):
        feed = requests.get(f"{BASE}/social/feed", headers=_h(ua["token"])).json()["items"]
        if not feed:
            pytest.skip("no feed items")
        r = requests.post(f"{BASE}/social/feed/{feed[0]['id']}/comment",
                          headers=_h(ua["token"]), json={"text": "   "})
        assert r.status_code == 400


# =============== KNOCKOUT BRACKET (round_name + seeds) ===============
class TestKnockoutBracket:
    def _make_ko(self, organiser, players, size=4):
        c = requests.post(f"{BASE}/competitions/create", headers=_h(organiser["token"]), json={
            "name": f"TEST_ko_{uuid.uuid4().hex[:6]}",
            "sport_id": "squash", "type": "knockout", "visibility": "private",
            "city": "TEST", "venue": "TEST", "max_participants": size,
            "fixture_mode": "automatic",
        })
        assert c.status_code == 200, c.text
        cid = c.json()["competition"]["id"]
        for p in players:
            r = requests.post(f"{BASE}/competitions/{cid}/register", headers=_h(p["token"]))
            assert r.status_code == 200, r.text
        g = requests.post(f"{BASE}/competitions/{cid}/generate-fixtures",
                          headers=_h(organiser["token"]))
        assert g.status_code == 200, g.text
        return cid

    def test_ko_round_names_and_seeds(self, ua, ub, uc):
        ud = _register(dn="QA V4 D")
        ue = _register(dn="QA V4 E")
        cid = self._make_ko(ua, [ub, uc, ud, ue], size=8)
        det = requests.get(f"{BASE}/competitions/{cid}", headers=_h(ua["token"])).json()
        fx = det["fixtures"]
        assert fx
        names = {f["round_name"] for f in fx}
        # 4 players in a bracket generate QF (with byes) OR SF+F, depending on rounding.
        # Assert we see a valid KO round name and no fallback "ROUND N".
        assert names, "expected KO fixtures"
        assert any(n in names for n in ("QUARTER-FINALS", "SEMI-FINALS", "FINAL", "ROUND OF 16")), names
        assert all(not n.startswith("ROUND ") for n in names), names
        # seeds populated for at least one non-bye side
        seeded = 0
        for f in fx:
            for s in f["sides"]:
                if any(v is not None for v in s.get("seeds", [])):
                    seeded += 1
        assert seeded >= 1, "expected at least one side to have seed populated"


# =============== LEAGUE numbered rounds ===============
class TestLeagueRounds:
    def test_league_rounds_are_grouped(self, ua, ub, uc):
        c = requests.post(f"{BASE}/competitions/create", headers=_h(ua["token"]), json={
            "name": f"TEST_lg_{uuid.uuid4().hex[:6]}",
            "sport_id": "squash", "type": "league", "visibility": "private",
            "city": "TEST", "venue": "TEST", "matches_per_opponent": 1,
            "points_win": 3, "max_participants": 4, "fixture_mode": "automatic",
        })
        assert c.status_code == 200, c.text
        cid = c.json()["competition"]["id"]
        for p in (ub, uc):
            assert requests.post(f"{BASE}/competitions/{cid}/register",
                                 headers=_h(p["token"])).status_code == 200
        g = requests.post(f"{BASE}/competitions/{cid}/generate-fixtures",
                          headers=_h(ua["token"]))
        assert g.status_code == 200
        det = requests.get(f"{BASE}/competitions/{cid}", headers=_h(ua["token"])).json()
        fx = det["fixtures"]
        assert fx
        rounds = {f["round_name"] for f in fx}
        # league round_name should be "ROUND N"
        assert all(rn.startswith("ROUND ") for rn in rounds), rounds
        assert len(rounds) >= 1


# =============== MATCH HISTORY (type filter + detail) ===============
class TestMatchHistory:
    def test_history_type_and_detail(self, ua):
        # find a seed opponent to guarantee auto-verified match
        opps = requests.get(f"{BASE}/opponents/search", params={"sport_id": "squash"},
                            headers=_h(ua["token"])).json()["opponents"]
        assert opps
        mid = None
        for opp in opps:
            sub = requests.post(f"{BASE}/matches/submit", headers=_h(ua["token"]), json={
                "sport_id": "squash", "opponent_user_id": opp["user_id"],
                "games": [[11, 6], [11, 4], [11, 9]], "best_of": 5,
            })
            if sub.status_code != 200:
                continue
            m = sub.json()["match"]
            if m.get("status") == "verified":
                mid = m["id"]
                break
        assert mid, "could not find seed opponent to auto-verify a match"
        # history?type=oneoff must include this one-off match
        h = requests.get(f"{BASE}/matches/history", params={"type": "oneoff"},
                         headers=_h(ua["token"])).json()["matches"]
        assert any(m["id"] == mid for m in h), "oneoff filter should include this match"
        # history?type=league must NOT include this one-off match
        h2 = requests.get(f"{BASE}/matches/history", params={"type": "league"},
                          headers=_h(ua["token"])).json()["matches"]
        assert all(m["id"] != mid for m in h2), "league filter must exclude one-off"
        # match detail shape
        d = requests.get(f"{BASE}/matches/{mid}", headers=_h(ua["token"]))
        assert d.status_code == 200, d.text
        body = d.json()
        for k in ("id", "sport_id", "sides", "games", "my_rating", "events"):
            assert k in body, f"missing {k}: {body.keys()}"
        assert len(body["sides"]) == 2
        assert body["games"] == [[11, 6], [11, 4], [11, 9]]


# =============== NEARBY city ===============
class TestNearby:
    def test_nearby_city_surfaces_same_city_first(self, ua):
        # Seeded users cycle across ["London","Mumbai","Singapore",...] so filtering by
        # city=London must surface only same-city players first with same_city=True.
        r = requests.get(f"{BASE}/social/nearby",
                         params={"sport_id": "squash", "city": "London"},
                         headers=_h(ua["token"]))
        assert r.status_code == 200, r.text
        body = r.json()
        players = body["players"]
        assert body.get("ref_city") == "london"
        # If any players are returned, all same_city=True must come before any same_city=False
        seen_non_same = False
        for p in players:
            if not p.get("same_city"):
                seen_non_same = True
            elif seen_non_same:
                pytest.fail("same_city player surfaced AFTER a non-same-city player")
        # No exact coords exposed
        for p in players:
            for banned in ("lat", "lng", "latitude", "longitude", "coords"):
                assert banned not in p, f"{banned} leaked in nearby response"


# =============== PRIVATE COMPETITION VISIBILITY ===============
class TestPrivateCompVisibility:
    def test_organisers_private_league_shows_in_list(self, ua):
        name = f"TEST_priv_{uuid.uuid4().hex[:6]}"
        c = requests.post(f"{BASE}/competitions/create", headers=_h(ua["token"]), json={
            "name": name,
            "sport_id": "squash", "type": "league", "visibility": "private",
            "city": "TEST", "venue": "TEST", "matches_per_opponent": 1,
            "points_win": 3, "max_participants": 4, "fixture_mode": "automatic",
        })
        assert c.status_code == 200, c.text
        cid = c.json()["competition"]["id"]
        r = requests.get(f"{BASE}/competitions/list", params={"sport_id": "squash"},
                         headers=_h(ua["token"]))
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()["competitions"]]
        assert cid in ids, "organiser's private competition missing from competitions/list"

    def test_other_user_cannot_see_private(self, ua, ub):
        name = f"TEST_privB_{uuid.uuid4().hex[:6]}"
        c = requests.post(f"{BASE}/competitions/create", headers=_h(ua["token"]), json={
            "name": name,
            "sport_id": "squash", "type": "league", "visibility": "private",
            "city": "TEST", "venue": "TEST", "matches_per_opponent": 1,
            "points_win": 3, "max_participants": 4, "fixture_mode": "automatic",
        })
        assert c.status_code == 200, c.text
        cid = c.json()["competition"]["id"]
        r = requests.get(f"{BASE}/competitions/list", params={"sport_id": "squash"},
                         headers=_h(ub["token"]))
        ids = [x["id"] for x in r.json()["competitions"]]
        assert cid not in ids, "private competition leaked to non-member/non-organiser"


# =============== AUTH login for QA account ===============
class TestQAAccountLogin:
    def test_qa_login_and_me(self):
        r = requests.post(f"{BASE}/auth/login",
                          json={"email": "qa.tester@athlera.dev", "password": "Test1234!"})
        assert r.status_code == 200, r.text
        tok = r.json()["access_token"]
        me = requests.get(f"{BASE}/auth/me", headers=_h(tok))
        assert me.status_code == 200
        assert me.json()["email"] == "qa.tester@athlera.dev"
        assert me.json()["onboarded"] is True

    def test_qa_ko_cup_bracket(self):
        r = requests.post(f"{BASE}/auth/login",
                          json={"email": "qa.tester@athlera.dev", "password": "Test1234!"})
        tok = r.json()["access_token"]
        cid = "3ce7d4d4-233e-41a0-82b0-9151099b90f2"
        det = requests.get(f"{BASE}/competitions/{cid}", headers=_h(tok))
        assert det.status_code == 200, det.text
        body = det.json()
        assert body["competition"]["type"] == "knockout"
        fx = body["fixtures"]
        assert fx, "expected fixtures on seeded QA KO Cup"
        names = {f["round_name"] for f in fx}
        # QF or SF must exist
        assert any(n in names for n in ("QUARTER-FINALS", "SEMI-FINALS", "FINAL")), names
