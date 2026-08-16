"""ATHLERA V2 regression tests.

Covers V2 additions: live scoring engine for all 5 sports (create/event/finalize/undo/abandon),
sport-specific completion rules (squash, badminton, tennis/padel, pickleball side-out),
competitions (league round-robin + manual result + standings + 5-player knockout seeding
and progression to champion), organiser-only restrictions, auto-add sport at low provisional,
Looking-to-Play + play requests dedupe + accept, nearby, messaging, match history filters,
rating history, and guest-403 on protected endpoints.
"""
from __future__ import annotations

import os
import uuid
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"


def _rand_email() -> str:
    return f"qa+{uuid.uuid4().hex[:10]}@athlera.dev"


def _h(t: str) -> dict:
    return {"Authorization": f"Bearer {t}"}


def _register(sports=None):
    email = _rand_email()
    r = requests.post(f"{BASE_URL}/auth/register",
                      json={"email": email, "password": "secret123", "display_name": "QA V2"})
    assert r.status_code == 201, r.text
    tok = r.json()["access_token"]
    user = r.json()["user"]
    if sports:
        ob = requests.post(f"{BASE_URL}/onboarding/submit", headers=_h(tok),
                           json={"submissions": sports})
        assert ob.status_code == 200, ob.text
    return {"email": email, "token": tok, "user": user}


DEFAULT_SPORTS = [
    {"sport_id": "squash", "has_accredited": False, "level_id": "intermediate"},
    {"sport_id": "badminton", "has_accredited": False, "level_id": "intermediate"},
    {"sport_id": "tennis", "has_accredited": False, "level_id": "intermediate"},
    {"sport_id": "padel", "has_accredited": False, "level_id": "intermediate"},
    {"sport_id": "pickleball", "has_accredited": False, "level_id": "intermediate"},
]


@pytest.fixture(scope="session")
def user_a():
    return _register(DEFAULT_SPORTS)


@pytest.fixture(scope="session")
def seed_opp(user_a):
    """Pick a seed opponent that has ratings for the sports we test."""
    r = requests.get(f"{BASE_URL}/opponents/search",
                     params={"sport_id": "squash"}, headers=_h(user_a["token"])).json()
    assert r["opponents"], "no squash seed opp"
    return r["opponents"][0]["user_id"]


# =============== LIVE SCORING ===============
def _live_create(tok: str, sport_id: str, opp_id: str, best_of: int = 1, **kw):
    body = {"sport_id": sport_id, "opponent_user_id": opp_id, "best_of": best_of,
            "doubles": False, "first_server_side": 0, "side1_user_ids": [opp_id],
            **kw}
    r = requests.post(f"{BASE_URL}/live/create", headers=_h(tok), json=body)
    assert r.status_code == 200, r.text
    return r.json()["live_id"]


def _live_event(tok: str, live_id: str, ev_type: str, side=None):
    body = {"type": ev_type}
    if side is not None:
        body["side"] = side
    r = requests.post(f"{BASE_URL}/live/{live_id}/event", headers=_h(tok), json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _live_get(tok: str, live_id: str):
    r = requests.get(f"{BASE_URL}/live/{live_id}", headers=_h(tok))
    assert r.status_code == 200, r.text
    return r.json()


class TestLiveSquash:
    """Squash BO1 to 11 win-by-2."""
    def test_squash_11_10_not_complete(self, user_a, seed_opp):
        lid = _live_create(user_a["token"], "squash", seed_opp, 1)
        # Alternate to reach 10-10, then push to 11-10 (not complete, needs win-by-2)
        for _ in range(10):
            _live_event(user_a["token"], lid, "rally_won", 0)
            _live_event(user_a["token"], lid, "rally_won", 1)
        _live_event(user_a["token"], lid, "rally_won", 0)
        disp = _live_get(user_a["token"], lid)["display"]
        assert disp["status"] == "in_progress" and disp["points"] == [11, 10], disp
        # Now 12-10 -> complete
        _live_event(user_a["token"], lid, "rally_won", 0)
        disp = _live_get(user_a["token"], lid)["display"]
        assert disp["status"] == "completed"
        assert disp["winner_side"] == 0
        # finalize
        r = requests.post(f"{BASE_URL}/live/{lid}/finalize", headers=_h(user_a["token"]))
        assert r.status_code == 200, r.text
        rc = r.json()["rating_changes"]
        assert user_a["user"]["id"] in rc
        assert "before" in rc[user_a["user"]["id"]] and "after" in rc[user_a["user"]["id"]]

    def test_squash_undo(self, user_a, seed_opp):
        lid = _live_create(user_a["token"], "squash", seed_opp, 1)
        _live_event(user_a["token"], lid, "rally_won", 0)
        _live_event(user_a["token"], lid, "rally_won", 0)
        d1 = _live_get(user_a["token"], lid)["display"]
        assert d1["points"] == [2, 0]
        _live_event(user_a["token"], lid, "rally_won", 1)
        _live_event(user_a["token"], lid, "undo")
        d2 = _live_get(user_a["token"], lid)["display"]
        assert d2["points"] == [2, 0], d2
        requests.post(f"{BASE_URL}/live/{lid}/abandon", headers=_h(user_a["token"]))


class TestLiveBadminton:
    """Badminton BO1 to 21, cap 30."""
    def test_badminton_21(self, user_a, seed_opp):
        lid = _live_create(user_a["token"], "badminton", seed_opp, 1)
        for _ in range(21):
            _live_event(user_a["token"], lid, "rally_won", 0)
        for _ in range(15):
            _live_event(user_a["token"], lid, "rally_won", 1)
        disp = _live_get(user_a["token"], lid)["display"]
        assert disp["status"] == "completed"
        assert disp["winner_side"] == 0
        requests.post(f"{BASE_URL}/live/{lid}/abandon", headers=_h(user_a["token"]))

    def test_badminton_cap_30(self, user_a, seed_opp):
        lid = _live_create(user_a["token"], "badminton", seed_opp, 1)
        # Alternate to reach 20-20 (deuce) then 29-29 (win-by-2 disabled by cap 30)
        for _ in range(29):
            _live_event(user_a["token"], lid, "rally_won", 0)
            _live_event(user_a["token"], lid, "rally_won", 1)
        # 29-29 -> not complete
        d = _live_get(user_a["token"], lid)["display"]
        assert d["status"] == "in_progress" and d["points"] == [29, 29], d
        _live_event(user_a["token"], lid, "rally_won", 0)
        d = _live_get(user_a["token"], lid)["display"]
        assert d["status"] == "completed" and d["winner_side"] == 0
        requests.post(f"{BASE_URL}/live/{lid}/abandon", headers=_h(user_a["token"]))


class TestLiveTennis:
    """Tennis BO1 -> first set to 6 win-by-2 (tb at 6-6)."""
    def test_tennis_6_4(self, user_a, seed_opp):
        lid = _live_create(user_a["token"], "tennis", seed_opp, 1)
        # Win 6 games with 4 clean points each; side 0 servers alternate; use point_won side=0 for game
        def win_game(side):
            for _ in range(4):
                _live_event(user_a["token"], lid, "point_won", side)
        for _ in range(6):
            win_game(0)
        d = _live_get(user_a["token"], lid)["display"]
        assert d["status"] == "completed", d
        assert d["winner_side"] == 0
        requests.post(f"{BASE_URL}/live/{lid}/abandon", headers=_h(user_a["token"]))

    def test_tennis_tiebreak(self, user_a, seed_opp):
        lid = _live_create(user_a["token"], "tennis", seed_opp, 1)
        def win_game(side):
            for _ in range(4):
                _live_event(user_a["token"], lid, "point_won", side)
        for _ in range(6):
            win_game(0); win_game(1)
        d = _live_get(user_a["token"], lid)["display"]
        assert d["tiebreak"] is True, d
        for _ in range(7):
            _live_event(user_a["token"], lid, "point_won", 0)
        d = _live_get(user_a["token"], lid)["display"]
        assert d["status"] == "completed", d
        requests.post(f"{BASE_URL}/live/{lid}/abandon", headers=_h(user_a["token"]))


class TestLivePadel:
    def test_padel_6_0(self, user_a, seed_opp):
        lid = _live_create(user_a["token"], "padel", seed_opp, 1)
        def win_game(side):
            for _ in range(4):
                _live_event(user_a["token"], lid, "point_won", side)
        for _ in range(6):
            win_game(0)
        d = _live_get(user_a["token"], lid)["display"]
        assert d["status"] == "completed" and d["winner_side"] == 0
        requests.post(f"{BASE_URL}/live/{lid}/abandon", headers=_h(user_a["token"]))


class TestLivePickleball:
    """Pickleball side-out: only serving side scores; receiving-win triggers side-out."""
    def test_pickleball_side_out(self, user_a, seed_opp):
        lid = _live_create(user_a["token"], "pickleball", seed_opp, 1)
        # first_server_side=0. rally_won by side 1 (receiver) -> side-out, no score change
        d = _live_event(user_a["token"], lid, "rally_won", 1)["display"]
        assert d["points"] == [0, 0], d
        assert d["server_side"] == 1
        # Now side 1 (server) wins rally -> +1 to side 1
        d = _live_event(user_a["token"], lid, "rally_won", 1)["display"]
        assert d["points"] == [0, 1]
        assert d["server_side"] == 1
        # Side 0 (receiver) wins -> side-out, points unchanged
        d = _live_event(user_a["token"], lid, "rally_won", 0)["display"]
        assert d["points"] == [0, 1]
        assert d["server_side"] == 0
        requests.post(f"{BASE_URL}/live/{lid}/abandon", headers=_h(user_a["token"]))

    def test_pickleball_11_9_finalize_ratings(self, user_a, seed_opp):
        # dashboard rating before
        dash_before = requests.get(f"{BASE_URL}/me/dashboard", headers=_h(user_a["token"])).json()
        pb_before = next(c for c in dash_before["cards"] if c["sport_id"] == "pickleball")["rating"]
        lid = _live_create(user_a["token"], "pickleball", seed_opp, 1)
        # Force server 0 to keep winning to 11
        for _ in range(11):
            _live_event(user_a["token"], lid, "rally_won", 0)
        d = _live_get(user_a["token"], lid)["display"]
        assert d["status"] == "completed" and d["winner_side"] == 0, d
        r = requests.post(f"{BASE_URL}/live/{lid}/finalize", headers=_h(user_a["token"]))
        assert r.status_code == 200, r.text
        # rating changed
        dash_after = requests.get(f"{BASE_URL}/me/dashboard", headers=_h(user_a["token"])).json()
        pb_after = next(c for c in dash_after["cards"] if c["sport_id"] == "pickleball")["rating"]
        assert pb_after != pb_before


# =============== AUTO-ADD SPORT ===============
class TestAutoAddSport:
    def test_ensure_creates_low_provisional(self):
        # Register user without any sports
        u = _register(sports=None)
        r = requests.post(f"{BASE_URL}/player-sports/ensure?sport_id=tennis", headers=_h(u["token"]))
        assert r.status_code == 200, r.text
        # Should now show tennis in dashboard as provisional
        d = requests.get(f"{BASE_URL}/me/dashboard", headers=_h(u["token"])).json()
        tennis = [c for c in d["cards"] if c["sport_id"] == "tennis"]
        assert tennis and tennis[0]["provisional"] is True

    def test_live_create_auto_adds_sport(self, seed_opp):
        u = _register(sports=None)
        lid = _live_create(u["token"], "squash", seed_opp, 1)
        assert lid
        d = requests.get(f"{BASE_URL}/me/dashboard", headers=_h(u["token"])).json()
        assert any(c["sport_id"] == "squash" for c in d["cards"])


# =============== COMPETITIONS ===============
class TestCompetitionLeague:
    def test_league_full_flow(self, user_a):
        # Create 3 additional users (total 4) to register for the league
        u1 = _register(DEFAULT_SPORTS)
        u2 = _register(DEFAULT_SPORTS)
        u3 = _register(DEFAULT_SPORTS)
        r = requests.post(f"{BASE_URL}/competitions/create", headers=_h(user_a["token"]), json={
            "name": f"TEST_League_{uuid.uuid4().hex[:6]}", "sport_id": "squash",
            "type": "league", "visibility": "public", "city": "London",
            "matches_per_opponent": 1, "max_participants": 8,
        })
        assert r.status_code == 200, r.text
        cid = r.json()["competition"]["id"]
        # Others register
        for u in (u1, u2, u3):
            reg = requests.post(f"{BASE_URL}/competitions/{cid}/register", headers=_h(u["token"]))
            assert reg.status_code == 200, reg.text
        # Non-organiser cannot generate fixtures
        no = requests.post(f"{BASE_URL}/competitions/{cid}/generate-fixtures", headers=_h(u1["token"]))
        assert no.status_code == 403
        # Organiser generates -> 4 players, matches_per_opponent=1 -> C(4,2)=6 fixtures
        gen = requests.post(f"{BASE_URL}/competitions/{cid}/generate-fixtures", headers=_h(user_a["token"]))
        assert gen.status_code == 200, gen.text
        detail = requests.get(f"{BASE_URL}/competitions/{cid}", headers=_h(user_a["token"])).json()
        assert len(detail["fixtures"]) == 6, detail
        # Non-organiser cannot manual-result
        fid = detail["fixtures"][0]["id"]
        no2 = requests.post(f"{BASE_URL}/fixtures/{fid}/manual-result",
                            headers=_h(u1["token"]), json={"games": [[11, 5], [11, 4]]})
        assert no2.status_code == 403
        # Organiser manual-result on first fixture
        mr = requests.post(f"{BASE_URL}/fixtures/{fid}/manual-result",
                           headers=_h(user_a["token"]), json={"games": [[11, 5], [11, 4]]})
        assert mr.status_code == 200, mr.text
        detail2 = requests.get(f"{BASE_URL}/competitions/{cid}", headers=_h(user_a["token"])).json()
        # standings should include the winner with 3 points
        assert any(row["points"] == 3 for row in detail2["standings"]), detail2["standings"]


class TestCompetitionKnockout:
    def test_knockout_5_to_champion(self, user_a):
        players = [_register(DEFAULT_SPORTS) for _ in range(4)]  # +user_a = 5
        r = requests.post(f"{BASE_URL}/competitions/create", headers=_h(user_a["token"]), json={
            "name": f"TEST_KO_{uuid.uuid4().hex[:6]}", "sport_id": "squash",
            "type": "knockout", "visibility": "public", "city": "London",
            "max_participants": 16,
        })
        assert r.status_code == 200, r.text
        cid = r.json()["competition"]["id"]
        for u in players:
            reg = requests.post(f"{BASE_URL}/competitions/{cid}/register", headers=_h(u["token"]))
            assert reg.status_code == 200, reg.text
        gen = requests.post(f"{BASE_URL}/competitions/{cid}/generate-fixtures", headers=_h(user_a["token"]))
        assert gen.status_code == 200, gen.text
        detail = requests.get(f"{BASE_URL}/competitions/{cid}", headers=_h(user_a["token"])).json()
        r1 = [f for f in detail["fixtures"] if f["round"] == 1]
        assert len(r1) == 4, r1
        byes = [f for f in r1 if f["status"] == "bye"]
        assert len(byes) == 3, byes
        # Complete the single scheduled round-1 match, then progress rounds
        max_iters = 10
        while max_iters > 0:
            max_iters -= 1
            comp = requests.get(f"{BASE_URL}/competitions/{cid}", headers=_h(user_a["token"])).json()
            scheduled = [f for f in comp["fixtures"] if f["status"] == "scheduled"]
            if not scheduled:
                break
            fid = scheduled[0]["id"]
            mr = requests.post(f"{BASE_URL}/fixtures/{fid}/manual-result",
                               headers=_h(user_a["token"]), json={"games": [[11, 3], [11, 5]]})
            assert mr.status_code == 200, mr.text
        # final competition status
        final = requests.get(f"{BASE_URL}/competitions/{cid}", headers=_h(user_a["token"])).json()
        assert final["competition"]["status"] == "complete", final["competition"]
        assert final["competition"].get("champion_ids")


# =============== LOOKING TO PLAY & PLAY REQUESTS ===============
class TestLTPAndPlayRequests:
    def test_ltp_create_and_list(self, user_a):
        r = requests.post(f"{BASE_URL}/ltp/create", headers=_h(user_a["token"]),
                          json={"sport_id": "squash", "when_text": "Sat evening",
                                "area": "London", "radius_km": 8, "message": "TEST"})
        assert r.status_code == 200, r.text
        lst = requests.get(f"{BASE_URL}/ltp/list?sport_id=squash", headers=_h(user_a["token"]))
        assert lst.status_code == 200
        posts = lst.json()["posts"]
        assert any(p.get("message") == "TEST" for p in posts)

    def test_play_request_dedupe_and_action(self, user_a, seed_opp):
        r1 = requests.post(f"{BASE_URL}/play-requests/create", headers=_h(user_a["token"]),
                           json={"to_user_id": seed_opp, "sport_id": "squash", "message": "hi"})
        # If a prior test session created a pending one, this may 400; try to clean state
        if r1.status_code == 400:
            mine = requests.get(f"{BASE_URL}/play-requests/mine", headers=_h(user_a["token"])).json()
            for pr in mine["outgoing"]:
                if pr["status"] == "pending" and pr["to_user_id"] == seed_opp:
                    requests.post(f"{BASE_URL}/play-requests/action", headers=_h(user_a["token"]),
                                  json={"request_id": pr["id"], "action": "cancel"})
            r1 = requests.post(f"{BASE_URL}/play-requests/create", headers=_h(user_a["token"]),
                               json={"to_user_id": seed_opp, "sport_id": "squash", "message": "hi"})
        assert r1.status_code == 200, r1.text
        rid = r1.json()["request_id"]
        # duplicate blocked
        r2 = requests.post(f"{BASE_URL}/play-requests/create", headers=_h(user_a["token"]),
                           json={"to_user_id": seed_opp, "sport_id": "squash", "message": "hi"})
        assert r2.status_code == 400, r2.text
        # cancel
        act = requests.post(f"{BASE_URL}/play-requests/action", headers=_h(user_a["token"]),
                            json={"request_id": rid, "action": "cancel"})
        assert act.status_code == 200 and act.json()["status"] == "cancelled"

    def test_social_nearby(self, user_a):
        r = requests.get(f"{BASE_URL}/social/nearby?sport_id=squash", headers=_h(user_a["token"]))
        assert r.status_code == 200
        players = r.json()["players"]
        assert players and "distance_km" in players[0]


# =============== MESSAGING ===============
class TestMessaging:
    def test_send_and_thread(self, user_a, seed_opp):
        r = requests.post(f"{BASE_URL}/messages/send", headers=_h(user_a["token"]),
                          json={"to_user_id": seed_opp, "text": "TEST hello"})
        assert r.status_code == 200, r.text
        th = requests.get(f"{BASE_URL}/messages/{seed_opp}", headers=_h(user_a["token"])).json()
        assert any(m["text"] == "TEST hello" for m in th["messages"])
        lst = requests.get(f"{BASE_URL}/messages", headers=_h(user_a["token"])).json()
        assert any(t["other_user_id"] == seed_opp for t in lst["threads"])


# =============== MATCH HISTORY & RATING HISTORY ===============
class TestHistory:
    def test_history_filters(self, user_a, seed_opp):
        # Submit a manual match first for filter coverage
        requests.post(f"{BASE_URL}/matches/submit", headers=_h(user_a["token"]),
                      json={"sport_id": "squash", "opponent_user_id": seed_opp,
                            "games": [[11, 5], [11, 4]]})
        r = requests.get(f"{BASE_URL}/matches/history?sport_id=squash", headers=_h(user_a["token"]))
        assert r.status_code == 200
        assert all(m["sport_id"] == "squash" for m in r.json()["matches"])
        r = requests.get(f"{BASE_URL}/matches/history?result=win", headers=_h(user_a["token"]))
        assert r.status_code == 200
        assert all(m["won"] is True for m in r.json()["matches"])
        r = requests.get(f"{BASE_URL}/matches/history?source=manual", headers=_h(user_a["token"]))
        assert r.status_code == 200
        assert all(m["source"] == "manual" for m in r.json()["matches"])
        r = requests.get(f"{BASE_URL}/matches/history?source=live", headers=_h(user_a["token"]))
        assert r.status_code == 200
        assert all(m["source"] == "live" for m in r.json()["matches"])

    def test_rating_history(self, user_a):
        r = requests.get(f"{BASE_URL}/sports/squash/rating-history", headers=_h(user_a["token"]))
        assert r.status_code == 200
        assert isinstance(r.json()["history"], list)


# =============== GUEST 403 ===============
class TestGuestBlocked:
    @pytest.fixture(scope="class")
    def guest(self):
        r = requests.post(f"{BASE_URL}/auth/guest")
        return r.json()["access_token"]

    def test_live_create_blocked(self, guest):
        r = requests.post(f"{BASE_URL}/live/create", headers=_h(guest),
                          json={"sport_id": "squash", "opponent_user_id": "x",
                                "side1_user_ids": ["x"], "best_of": 1, "doubles": False,
                                "first_server_side": 0})
        assert r.status_code == 403, r.text

    def test_competitions_create_blocked(self, guest):
        r = requests.post(f"{BASE_URL}/competitions/create", headers=_h(guest),
                          json={"name": "X", "sport_id": "squash", "type": "league",
                                "visibility": "public", "city": "London"})
        assert r.status_code == 403

    def test_ltp_create_blocked(self, guest):
        r = requests.post(f"{BASE_URL}/ltp/create", headers=_h(guest),
                          json={"sport_id": "squash", "when_text": "Sat", "area": "L"})
        assert r.status_code == 403

    def test_play_request_blocked(self, guest):
        r = requests.post(f"{BASE_URL}/play-requests/create", headers=_h(guest),
                          json={"to_user_id": "x", "sport_id": "squash"})
        assert r.status_code == 403

    def test_messages_send_blocked(self, guest):
        r = requests.post(f"{BASE_URL}/messages/send", headers=_h(guest),
                          json={"to_user_id": "x", "text": "hi"})
        assert r.status_code == 403
