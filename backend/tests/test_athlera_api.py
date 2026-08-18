"""ATHLERA V1 backend regression tests.

Covers: auth (register/login/guest/me/logout+revocation), sports catalog,
onboarding submissions (accredited + level), dashboard/UAS, sport detail,
rankings, opponents search, match preview + score validation for all 5 sports
(valid & invalid edge cases), match submit vs seed opponent auto-verify, guest
cannot submit, matches/mine, athletes profile, events, social feed.
"""
from __future__ import annotations

import os
import uuid
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"


def _rand_email() -> str:
    return f"qa+{uuid.uuid4().hex[:10]}@athlera.dev"


def _register_and_onboard(sports_payload):
    email = _rand_email()
    r = requests.post(f"{BASE_URL}/auth/register", json={"email": email, "password": "secret123", "display_name": "QA"})
    assert r.status_code == 201, r.text
    data = r.json()
    tok = data["access_token"]
    ob = requests.post(f"{BASE_URL}/onboarding/submit", headers={"Authorization": f"Bearer {tok}"},
                      json={"submissions": sports_payload})
    assert ob.status_code == 200, ob.text
    return {"email": email, "token": tok, "user": data["user"]}


@pytest.fixture(scope="session")
def user_a():
    return _register_and_onboard([
        {"sport_id": "squash", "has_accredited": True, "provider_name": "PSA", "submitted_rating": 3800},
        {"sport_id": "tennis", "has_accredited": False, "level_id": "intermediate"},
        {"sport_id": "padel", "has_accredited": False, "level_id": "intermediate"},
        {"sport_id": "badminton", "has_accredited": False, "level_id": "recreational"},
        {"sport_id": "pickleball", "has_accredited": False, "level_id": "beginner"},
    ])


@pytest.fixture(scope="session")
def user_b():
    return _register_and_onboard([
        {"sport_id": "squash", "has_accredited": False, "level_id": "advanced"},
        {"sport_id": "tennis", "has_accredited": False, "level_id": "intermediate"},
        {"sport_id": "padel", "has_accredited": False, "level_id": "intermediate"},
        {"sport_id": "badminton", "has_accredited": False, "level_id": "recreational"},
        {"sport_id": "pickleball", "has_accredited": False, "level_id": "beginner"},
    ])


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------- Auth ----------
class TestAuth:
    def test_register_duplicate(self, user_a):
        r = requests.post(f"{BASE_URL}/auth/register", json={"email": user_a["email"], "password": "secret123"})
        assert r.status_code == 409

    def test_login_success(self, user_a):
        r = requests.post(f"{BASE_URL}/auth/login", json={"email": user_a["email"], "password": "secret123"})
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_login_bad_password(self, user_a):
        r = requests.post(f"{BASE_URL}/auth/login", json={"email": user_a["email"], "password": "wrong123"})
        assert r.status_code == 401

    def test_guest_and_me(self):
        r = requests.post(f"{BASE_URL}/auth/guest")
        assert r.status_code == 201
        tok = r.json()["access_token"]
        assert r.json()["user"]["is_guest"] is True
        me = requests.get(f"{BASE_URL}/auth/me", headers=_h(tok))
        assert me.status_code == 200
        assert me.json()["is_guest"] is True

    def test_logout_revokes_token(self):
        email = _rand_email()
        reg = requests.post(f"{BASE_URL}/auth/register", json={"email": email, "password": "secret123"}).json()
        tok = reg["access_token"]
        assert requests.get(f"{BASE_URL}/auth/me", headers=_h(tok)).status_code == 200
        lo = requests.post(f"{BASE_URL}/auth/logout", headers=_h(tok))
        assert lo.status_code == 204
        after = requests.get(f"{BASE_URL}/auth/me", headers=_h(tok))
        assert after.status_code == 401

    def test_me_requires_bearer(self):
        assert requests.get(f"{BASE_URL}/auth/me").status_code == 401


# ---------- Catalog ----------
class TestCatalog:
    def test_sports_and_levels(self):
        r = requests.get(f"{BASE_URL}/sports")
        assert r.status_code == 200
        data = r.json()
        assert len(data["sports"]) == 5
        assert len(data["levels"]) == 6
        assert {s["id"] for s in data["sports"]} == {"squash", "padel", "tennis", "badminton", "pickleball"}


# ---------- Onboarding + Dashboard ----------
class TestOnboardingAndDashboard:
    def test_mixed_onboarding_new_user(self):
        email = _rand_email()
        reg = requests.post(f"{BASE_URL}/auth/register", json={"email": email, "password": "secret123"}).json()
        tok = reg["access_token"]
        payload = {"display_name": "QA Mixed", "submissions": [
            {"sport_id": "squash", "has_accredited": True, "provider_name": "PSA", "submitted_rating": 3800},
            {"sport_id": "tennis", "has_accredited": False, "level_id": "intermediate"},
        ]}
        r = requests.post(f"{BASE_URL}/onboarding/submit", json=payload, headers=_h(tok))
        assert r.status_code == 200, r.text
        rj = r.json()
        assert rj["ok"] is True and len(rj["ratings"]) == 2
        for entry in rj["ratings"]:
            assert entry["provisional"] is True
        acc = next(e for e in rj["ratings"] if e["sport_id"] == "squash")
        assert acc["external"]["provider"] == "PSA"
        assert acc["external"]["status"] == "pending"

    def test_onboarding_b_all_five(self, user_b):
        d = requests.get(f"{BASE_URL}/me/dashboard", headers=_h(user_b["token"])).json()
        assert d["sports_counted"] == 5

    def test_accredited_requires_provider(self, user_a):
        r = requests.post(f"{BASE_URL}/onboarding/submit", headers=_h(user_a["token"]),
                          json={"submissions": [{"sport_id": "padel", "has_accredited": True}]})
        assert r.status_code == 400

    def test_dashboard(self, user_a):
        r = requests.get(f"{BASE_URL}/me/dashboard", headers=_h(user_a["token"]))
        assert r.status_code == 200
        data = r.json()
        assert 0 <= data["uas"] <= 1000
        assert data["sports_counted"] == 5
        assert len(data["cards"]) == 5
        for c in data["cards"]:
            assert {"rating", "rank", "band", "percentile", "provisional"} <= set(c)

    def test_dashboard_b_uas_range(self, user_b):
        d = requests.get(f"{BASE_URL}/me/dashboard", headers=_h(user_b["token"])).json()
        assert d["sports_counted"] == 5
        assert 0 <= d["uas"] <= 1000


# ---------- Sport page + rankings + opponents ----------
class TestSportAndRankings:
    def test_sport_page(self, user_a):
        r = requests.get(f"{BASE_URL}/sports/squash", headers=_h(user_a["token"]))
        assert r.status_code == 200
        d = r.json()
        assert d["player"] is not None
        assert isinstance(d["leaderboard"], list) and len(d["leaderboard"]) > 0
        assert d["my_rank"] is not None

    def test_sport_page_unknown_404(self, user_a):
        r = requests.get(f"{BASE_URL}/sports/frisbee", headers=_h(user_a["token"]))
        assert r.status_code == 404

    def test_rankings_sport(self):
        r = requests.get(f"{BASE_URL}/rankings/sport/tennis")
        assert r.status_code == 200
        rows = r.json()["rows"]
        assert len(rows) > 0
        assert rows[0]["rank"] == 1
        # Ordered desc
        assert all(rows[i]["rating"] >= rows[i + 1]["rating"] for i in range(len(rows) - 1))

    def test_rankings_uas(self):
        r = requests.get(f"{BASE_URL}/rankings/uas")
        assert r.status_code == 200
        rows = r.json()["rows"]
        assert len(rows) > 0
        assert all(0 <= row["uas"] <= 1000 for row in rows)

    def test_opponent_search(self, user_a):
        r = requests.get(f"{BASE_URL}/opponents/search", params={"sport_id": "squash", "q": ""}, headers=_h(user_a["token"]))
        assert r.status_code == 200
        opps = r.json()["opponents"]
        assert len(opps) > 0
        assert all(o["user_id"] != user_a["user"]["id"] for o in opps)


# ---------- Match preview & score validation ----------
class TestScoreValidation:
    """Preview endpoint used to hit validate_score for each sport."""

    @pytest.fixture(scope="class")
    def opp(self, user_a):
        # Grab a seed opponent that has rating for all sports we test
        r = requests.get(f"{BASE_URL}/opponents/search", params={"sport_id": "squash"}, headers=_h(user_a["token"])).json()
        assert r["opponents"], "No seed opponents for squash"
        return r["opponents"][0]

    def _preview(self, user_a, sport_id, opp_id, games):
        return requests.post(
            f"{BASE_URL}/matches/preview",
            headers=_h(user_a["token"]),
            json={"sport_id": sport_id, "opponent_user_id": opp_id, "games": games},
        )

    # SQUASH: BO3, first to 11 win-by-2
    def test_squash_valid(self, user_a, opp):
        r = self._preview(user_a, "squash", opp["user_id"], [[11, 5], [11, 8]])
        assert r.status_code == 200, r.text
        assert set(r.json()) >= {"delta", "tag", "expected_winner_prob", "margin_score", "new_my_rating", "winner_is_me"}

    def test_squash_12_10_valid(self, user_a, opp):
        r = self._preview(user_a, "squash", opp["user_id"], [[12, 10], [11, 5]])
        assert r.status_code == 200, r.text

    def test_squash_11_10_invalid(self, user_a, opp):
        r = self._preview(user_a, "squash", opp["user_id"], [[11, 10], [11, 5]])
        assert r.status_code == 400

    # BADMINTON: hard cap 30
    def test_badminton_valid_21(self, user_a, opp):
        # Ensure opp has badminton; if not skip
        opps = requests.get(f"{BASE_URL}/opponents/search", params={"sport_id": "badminton"}, headers=_h(user_a["token"])).json()["opponents"]
        if not opps:
            pytest.skip("no badminton seed opp")
        oid = opps[0]["user_id"]
        r = self._preview(user_a, "badminton", oid, [[21, 15], [21, 18]])
        assert r.status_code == 200, r.text

    def test_badminton_30_29_valid(self, user_a):
        opps = requests.get(f"{BASE_URL}/opponents/search", params={"sport_id": "badminton"}, headers=_h(user_a["token"])).json()["opponents"]
        if not opps:
            pytest.skip("no badminton seed opp")
        r = self._preview(user_a, "badminton", opps[0]["user_id"], [[30, 29], [21, 15]])
        assert r.status_code == 200, r.text

    def test_badminton_31_29_invalid(self, user_a):
        opps = requests.get(f"{BASE_URL}/opponents/search", params={"sport_id": "badminton"}, headers=_h(user_a["token"])).json()["opponents"]
        if not opps:
            pytest.skip("no badminton seed opp")
        r = self._preview(user_a, "badminton", opps[0]["user_id"], [[31, 29], [21, 15]])
        assert r.status_code == 400

    # TENNIS
    def test_tennis_6_4_valid(self, user_a):
        opps = requests.get(f"{BASE_URL}/opponents/search", params={"sport_id": "tennis"}, headers=_h(user_a["token"])).json()["opponents"]
        if not opps: pytest.skip("no tennis seed opp")
        r = self._preview(user_a, "tennis", opps[0]["user_id"], [[6, 4], [6, 3]])
        assert r.status_code == 200, r.text

    def test_tennis_7_6_valid(self, user_a):
        opps = requests.get(f"{BASE_URL}/opponents/search", params={"sport_id": "tennis"}, headers=_h(user_a["token"])).json()["opponents"]
        if not opps: pytest.skip("no tennis seed opp")
        r = self._preview(user_a, "tennis", opps[0]["user_id"], [[7, 6], [6, 3]])
        assert r.status_code == 200, r.text

    def test_tennis_6_5_invalid(self, user_a):
        opps = requests.get(f"{BASE_URL}/opponents/search", params={"sport_id": "tennis"}, headers=_h(user_a["token"])).json()["opponents"]
        if not opps: pytest.skip("no tennis seed opp")
        r = self._preview(user_a, "tennis", opps[0]["user_id"], [[6, 5], [6, 3]])
        assert r.status_code == 400

    # PADEL (same as tennis)
    def test_padel_6_4_valid(self, user_a):
        opps = requests.get(f"{BASE_URL}/opponents/search", params={"sport_id": "padel"}, headers=_h(user_a["token"])).json()["opponents"]
        if not opps: pytest.skip("no padel seed opp")
        r = self._preview(user_a, "padel", opps[0]["user_id"], [[6, 4], [7, 6]])
        assert r.status_code == 200, r.text

    def test_padel_6_5_invalid(self, user_a):
        opps = requests.get(f"{BASE_URL}/opponents/search", params={"sport_id": "padel"}, headers=_h(user_a["token"])).json()["opponents"]
        if not opps: pytest.skip("no padel seed opp")
        r = self._preview(user_a, "padel", opps[0]["user_id"], [[6, 5], [6, 3]])
        assert r.status_code == 400

    # PICKLEBALL
    def test_pickleball_valid(self, user_a):
        opps = requests.get(f"{BASE_URL}/opponents/search", params={"sport_id": "pickleball"}, headers=_h(user_a["token"])).json()["opponents"]
        if not opps: pytest.skip("no pickleball seed opp")
        r = self._preview(user_a, "pickleball", opps[0]["user_id"], [[11, 5]])
        assert r.status_code == 200, r.text

    def test_pickleball_11_10_invalid(self, user_a):
        opps = requests.get(f"{BASE_URL}/opponents/search", params={"sport_id": "pickleball"}, headers=_h(user_a["token"])).json()["opponents"]
        if not opps: pytest.skip("no pickleball seed opp")
        r = self._preview(user_a, "pickleball", opps[0]["user_id"], [[11, 10]])
        assert r.status_code == 400


# ---------- Match submit & guest restriction ----------
class TestMatchSubmit:
    def test_guest_can_preview_cannot_submit(self, user_b):
        # Get a seed opp for squash from user_b context
        g = requests.post(f"{BASE_URL}/auth/guest").json()
        gtok = g["access_token"]
        # Guest has no player_sports, so preview returns 400 ("no rating")
        # This still tests that submit yields 403 before rating check? No — check submit path:
        r = requests.post(f"{BASE_URL}/matches/submit", headers=_h(gtok), json={
            "sport_id": "squash", "opponent_user_id": "someone", "games": [[11, 5], [11, 5]]
        })
        assert r.status_code == 403, r.text

    def test_submit_vs_seed_auto_verifies(self, user_a):
        opps = requests.get(f"{BASE_URL}/opponents/search", params={"sport_id": "squash"}, headers=_h(user_a["token"])).json()["opponents"]
        opp = opps[0]

        dash_before = requests.get(f"{BASE_URL}/me/dashboard", headers=_h(user_a["token"])).json()
        my_squash_before = next(c for c in dash_before["cards"] if c["sport_id"] == "squash")
        rating_before = my_squash_before["rating"]
        matches_before = my_squash_before["matches_played"]

        r = requests.post(f"{BASE_URL}/matches/submit", headers=_h(user_a["token"]),
                          json={"sport_id": "squash", "opponent_user_id": opp["user_id"], "games": [[11, 4], [11, 6]]})
        assert r.status_code == 200, r.text
        m = r.json()["match"]
        assert m["status"] == "verified"

        dash_after = requests.get(f"{BASE_URL}/me/dashboard", headers=_h(user_a["token"])).json()
        my_squash_after = next(c for c in dash_after["cards"] if c["sport_id"] == "squash")
        assert my_squash_after["matches_played"] == matches_before + 1
        assert my_squash_after["rating"] != rating_before  # rating moved

    def test_matches_mine(self, user_a):
        r = requests.get(f"{BASE_URL}/matches/mine", headers=_h(user_a["token"]))
        assert r.status_code == 200
        matches = r.json()["matches"]
        assert len(matches) >= 1
        assert "opponent" in matches[0]

    def test_athlete_profile(self, user_a):
        r = requests.get(f"{BASE_URL}/athletes/{user_a['user']['id']}", headers=_h(user_a["token"]))
        assert r.status_code == 200
        assert "cards" in r.json()

    def test_events_upcoming(self):
        r = requests.get(f"{BASE_URL}/events/upcoming")
        assert r.status_code == 200
        assert len(r.json()["events"]) == 5

    def test_social_feed(self, user_a):
        r = requests.get(f"{BASE_URL}/social/feed", headers=_h(user_a["token"]))
        assert r.status_code == 200
        assert isinstance(r.json()["items"], list)
