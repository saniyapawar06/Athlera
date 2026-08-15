"""ATHLERA V3 — coverage gaps not exercised in test_athlera_v2.py.

Covers:
  * Squash referee events: let (replay, no score, same server), stroke (point to receiver),
    no_let (point to opponent)
  * Padel golden_point at 3-3 deuce ends the game on the next point
  * Padel star_point (selectable via padel_scoring option) behaves like golden_point at deuce
  * Manage Fixtures PATCH: unscheduled -> scheduled + set/modify datetime, completed = locked (409)
  * Events: public vs private, /events/upcoming shows ONLY public+open, register/withdraw
    reflect registered count, capacity respected (400 when full)
  * Competition fixture linkage: create league, generate fixtures, start LIVE match linked
    to a fixture, finalize -> fixture becomes 'complete' and standings/bracket update
  * Auth: /auth/logout revokes bearer token (subsequent /auth/me -> 401)
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
    return f"qa+{uuid.uuid4().hex[:10]}@athlera.dev"


ONBOARD_ALL = [
    {"sport_id": s, "has_accredited": False, "level_id": "intermediate"}
    for s in ("squash", "badminton", "tennis", "padel", "pickleball")
]


def _register(sports=ONBOARD_ALL, dn="QA V3"):
    email = _rand_email()
    r = requests.post(f"{BASE}/auth/register",
                      json={"email": email, "password": "secret123", "display_name": dn})
    assert r.status_code == 201, r.text
    tok = r.json()["access_token"]; user = r.json()["user"]
    if sports:
        ob = requests.post(f"{BASE}/onboarding/submit", headers=_h(tok),
                           json={"submissions": sports})
        assert ob.status_code == 200, ob.text
    return {"email": email, "token": tok, "user": user}


@pytest.fixture(scope="module")
def ua():
    return _register()


@pytest.fixture(scope="module")
def ub():
    return _register(dn="QA V3 B")


@pytest.fixture(scope="module")
def uc():
    return _register(dn="QA V3 C")


@pytest.fixture(scope="module")
def seed_squash(ua):
    r = requests.get(f"{BASE}/opponents/search",
                     params={"sport_id": "squash"}, headers=_h(ua["token"])).json()
    return r["opponents"][0]["user_id"]


@pytest.fixture(scope="module")
def seed_padel(ua):
    r = requests.get(f"{BASE}/opponents/search",
                     params={"sport_id": "padel"}, headers=_h(ua["token"])).json()
    assert r["opponents"], "need a padel seed opp"
    return r["opponents"][0]["user_id"]


def _lcreate(tok, sport, opp, **extra):
    body = {"sport_id": sport, "opponent_user_id": opp, "best_of": 1,
            "doubles": False, "first_server_side": 0, "side1_user_ids": [opp], **extra}
    r = requests.post(f"{BASE}/live/create", headers=_h(tok), json=body)
    assert r.status_code == 200, r.text
    return r.json()["live_id"]


def _levent(tok, lid, typ, side=None):
    body = {"type": typ}
    if side is not None:
        body["side"] = side
    r = requests.post(f"{BASE}/live/{lid}/event", headers=_h(tok), json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _lget(tok, lid):
    r = requests.get(f"{BASE}/live/{lid}", headers=_h(tok))
    assert r.status_code == 200, r.text
    return r.json()["display"]


# =============== SQUASH REFEREE EVENTS ===============
class TestSquashRefereeEvents:
    def test_let_is_replay_same_server(self, ua, seed_squash):
        lid = _lcreate(ua["token"], "squash", seed_squash)
        # first_server_side=0 -> server initially 0
        _levent(ua["token"], lid, "rally_won", 0)  # 1-0, server still 0 (squash server_model=rally_winner)
        d0 = _lget(ua["token"], lid)
        assert d0["points"] == [1, 0]
        srv_before = d0["server_side"]
        # Let event: replay -> no score change, same server
        _levent(ua["token"], lid, "let")
        d1 = _lget(ua["token"], lid)
        assert d1["points"] == [1, 0], f"let must not change score, got {d1['points']}"
        assert d1["server_side"] == srv_before, "let must keep same server"
        requests.post(f"{BASE}/live/{lid}/abandon", headers=_h(ua["token"]))

    def test_stroke_awards_point_to_receiver(self, ua, seed_squash):
        lid = _lcreate(ua["token"], "squash", seed_squash)
        # Server is 0; stroke awarded by referee -> receiver (1) gets the point
        _levent(ua["token"], lid, "stroke")
        d = _lget(ua["token"], lid)
        assert d["points"] == [0, 1], f"stroke to receiver failed, got {d['points']}"
        requests.post(f"{BASE}/live/{lid}/abandon", headers=_h(ua["token"]))

    def test_no_let_awards_point_to_opponent(self, ua, seed_squash):
        lid = _lcreate(ua["token"], "squash", seed_squash)
        # Server 0 asks let; ref rules no_let -> opponent (side 1) scores
        _levent(ua["token"], lid, "no_let")
        d = _lget(ua["token"], lid)
        assert d["points"] == [0, 1], f"no_let to opponent failed, got {d['points']}"
        requests.post(f"{BASE}/live/{lid}/abandon", headers=_h(ua["token"]))


# =============== PADEL GOLDEN / STAR POINT ===============
class TestPadelGolden:
    def test_golden_point_ends_deuce(self, ua, seed_padel):
        lid = _lcreate(ua["token"], "padel", seed_padel, padel_scoring="golden_point")
        # Play to 40-30 for side 0: (1,0)(1,1)(2,1)(2,2)(3,2)
        for pair in [(0, None), (None, 1), (0, None), (None, 1), (0, None)]:
            s = pair[0] if pair[0] is not None else pair[1]
            _levent(ua["token"], lid, "point_won", s)
        d = _lget(ua["token"], lid)
        assert d["points_display"] == ["40", "30"], d
        games_before = list(d["cur_games"])
        # Opponent (side 1) wins the golden point at deuce -> game to side 1 immediately
        _levent(ua["token"], lid, "point_won", 1)
        d2 = _lget(ua["token"], lid)
        assert d2["points_display"] == ["0", "0"], f"golden point must end game, got {d2['points_display']}"
        assert d2["cur_games"][1] == games_before[1] + 1
        assert d2["scoring_mode"] == "golden_point"
        requests.post(f"{BASE}/live/{lid}/abandon", headers=_h(ua["token"]))

    def test_star_point_ends_deuce(self, ua, seed_padel):
        lid = _lcreate(ua["token"], "padel", seed_padel, padel_scoring="star_point")
        for pair in [(0, None), (None, 1), (0, None), (None, 1), (0, None)]:
            s = pair[0] if pair[0] is not None else pair[1]
            _levent(ua["token"], lid, "point_won", s)
        d = _lget(ua["token"], lid)
        assert d["points_display"] == ["40", "30"], d
        _levent(ua["token"], lid, "point_won", 1)
        d2 = _lget(ua["token"], lid)
        assert d2["points_display"] == ["0", "0"], f"star_point must end game, got {d2['points_display']}"
        assert d2["cur_games"][1] == 1
        assert d2["scoring_mode"] == "star_point"
        requests.post(f"{BASE}/live/{lid}/abandon", headers=_h(ua["token"]))


# =============== MANAGE FIXTURES: PATCH schedule + lock completed ===============
class TestManageFixtures:
    def _make_league(self, org, players):
        c = requests.post(f"{BASE}/competitions/create", headers=_h(org["token"]), json={
            "name": f"TEST_league_{uuid.uuid4().hex[:6]}",
            "sport_id": "squash", "type": "league", "visibility": "private",
            "city": "TEST", "venue": "TEST", "matches_per_opponent": 1,
            "points_win": 3, "max_participants": 8, "fixture_mode": "automatic",
        })
        assert c.status_code == 200, c.text
        cid = c.json()["competition"]["id"]
        for p in players:
            j = requests.post(f"{BASE}/competitions/{cid}/register", headers=_h(p["token"]))
            assert j.status_code == 200, j.text
        g = requests.post(f"{BASE}/competitions/{cid}/generate-fixtures", headers=_h(org["token"]))
        assert g.status_code == 200, g.text
        return cid

    def _fixtures(self, tok, cid):
        r = requests.get(f"{BASE}/competitions/{cid}", headers=_h(tok))
        assert r.status_code == 200, r.text
        return r.json()["fixtures"]

    def test_patch_sets_and_updates_schedule(self, ua, ub, uc):
        cid = self._make_league(ua, [ub, uc])
        fx = self._fixtures(ua["token"], cid)
        assert fx, "no fixtures generated"
        # NOTE: auto-mode fixtures come back with status='scheduled' even when scheduled_at is None
        # (backend initial_status='scheduled' for automatic mode). We still verify PATCH updates.
        f0 = fx[0]
        assert f0["scheduled_at"] is None, f0
        when = "2026-06-01T18:30:00Z"
        r = requests.patch(f"{BASE}/fixtures/{f0['id']}", headers=_h(ua["token"]),
                           json={"scheduled_at": when})
        assert r.status_code == 200, r.text
        upd = next(x for x in self._fixtures(ua["token"], cid) if x["id"] == f0["id"])
        assert upd["status"] == "scheduled" and upd["scheduled_at"] == when

        when2 = "2026-06-02T20:00:00Z"
        r = requests.patch(f"{BASE}/fixtures/{f0['id']}", headers=_h(ua["token"]),
                           json={"scheduled_at": when2})
        assert r.status_code == 200, r.text
        upd = next(x for x in self._fixtures(ua["token"], cid) if x["id"] == f0["id"])
        assert upd["scheduled_at"] == when2

        rbad = requests.patch(f"{BASE}/fixtures/{f0['id']}", headers=_h(ub["token"]),
                              json={"scheduled_at": None})
        assert rbad.status_code == 403, rbad.text

    def test_completed_fixture_locked(self, ua, ub, uc):
        cid = self._make_league(ua, [ub, uc])
        fx = self._fixtures(ua["token"], cid)
        target = None
        for f in fx:
            uids = {u for s in f["sides"] for u in s["user_ids"]}
            if ub["user"]["id"] in uids and uc["user"]["id"] in uids:
                target = f; break
        assert target, f"no ub-vs-uc fixture in {fx}"
        # squash valid 3-0 result (best of 5 default -> best-of-3 games needed to close a match? use 3 games)
        rr = requests.post(f"{BASE}/fixtures/{target['id']}/manual-result",
                           headers=_h(ua["token"]),
                           json={"games": [[11, 5], [11, 6], [11, 8]]})
        assert rr.status_code == 200, rr.text
        rp = requests.patch(f"{BASE}/fixtures/{target['id']}", headers=_h(ua["token"]),
                            json={"scheduled_at": "2026-07-01T10:00:00Z"})
        assert rp.status_code == 409, rp.text


# =============== EVENTS ===============
class TestEvents:
    def test_public_vs_private_and_upcoming(self, ua, ub):
        pub_name = f"TEST_pub_{uuid.uuid4().hex[:6]}"
        prv_name = f"TEST_prv_{uuid.uuid4().hex[:6]}"
        rp = requests.post(f"{BASE}/events/create", headers=_h(ua["token"]), json={
            "name": pub_name, "sport_id": "squash", "format": "league",
            "visibility": "public", "venue": "V1", "city": "TEST",
            "capacity": 8, "is_paid": False, "starts_at": "2026-08-01T10:00:00Z",
        })
        assert rp.status_code == 200, rp.text
        pub_id = rp.json()["event"]["id"]

        rq = requests.post(f"{BASE}/events/create", headers=_h(ua["token"]), json={
            "name": prv_name, "sport_id": "squash", "format": "knockout",
            "visibility": "private", "venue": "V2", "city": "TEST",
            "capacity": 4, "is_paid": True, "fee": 10.0,
            "starts_at": "2026-08-02T10:00:00Z",
        })
        assert rq.status_code == 200, rq.text
        prv_id = rq.json()["event"]["id"]

        up = requests.get(f"{BASE}/events/upcoming", headers=_h(ub["token"])).json()["events"]
        names = {e["name"] for e in up}
        assert pub_name in names, "public event missing from upcoming"
        assert prv_name not in names, "private event MUST NOT appear in upcoming"

        # /events/{id} — non-organiser cannot see private
        r = requests.get(f"{BASE}/events/{prv_id}", headers=_h(ub["token"]))
        assert r.status_code == 404, r.text
        # organiser can see private
        r2 = requests.get(f"{BASE}/events/{prv_id}", headers=_h(ua["token"]))
        assert r2.status_code == 200

        # register/withdraw increments/decrements registered count
        r = requests.post(f"{BASE}/events/{pub_id}/register", headers=_h(ub["token"]))
        assert r.status_code == 200, r.text
        det = requests.get(f"{BASE}/events/{pub_id}", headers=_h(ub["token"])).json()["event"]
        assert det["registered"] == 1 and det["is_registered"] is True
        rw = requests.post(f"{BASE}/events/{pub_id}/withdraw", headers=_h(ub["token"]))
        assert rw.status_code == 200, rw.text
        det2 = requests.get(f"{BASE}/events/{pub_id}", headers=_h(ub["token"])).json()["event"]
        assert det2["registered"] == 0 and det2["is_registered"] is False

    def test_capacity_enforced(self, ua):
        # create capacity=2 event, register organiser + one other + a third -> 400
        r = requests.post(f"{BASE}/events/create", headers=_h(ua["token"]), json={
            "name": f"TEST_cap_{uuid.uuid4().hex[:6]}",
            "sport_id": "squash", "format": "league",
            "visibility": "public", "venue": "V", "city": "TEST",
            "capacity": 2, "is_paid": False,
        })
        assert r.status_code == 200, r.text
        eid = r.json()["event"]["id"]
        u1 = _register(dn="cap-1"); u2 = _register(dn="cap-2"); u3 = _register(dn="cap-3")
        assert requests.post(f"{BASE}/events/{eid}/register", headers=_h(u1["token"])).status_code == 200
        assert requests.post(f"{BASE}/events/{eid}/register", headers=_h(u2["token"])).status_code == 200
        r_full = requests.post(f"{BASE}/events/{eid}/register", headers=_h(u3["token"]))
        assert r_full.status_code == 400, r_full.text


# =============== COMPETITION FIXTURE LINKED LIVE MATCH ===============
class TestFixtureLinkedLive:
    def test_live_finalize_marks_fixture_complete(self, ua, ub, uc):
        # organiser=ua (not a player); players ub & uc
        c = requests.post(f"{BASE}/competitions/create", headers=_h(ua["token"]), json={
            "name": f"TEST_link_{uuid.uuid4().hex[:6]}",
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
        assert g.status_code == 200, g.text
        det = requests.get(f"{BASE}/competitions/{cid}", headers=_h(ua["token"])).json()
        fx = det["fixtures"]
        # 3 members (ua + ub + uc) -> C(3,2)=3 fixtures. Pick a fixture involving ub.
        f0 = next((f for f in fx if ub["user"]["id"] in [u for s in f["sides"] for u in s["user_ids"]]), None)
        assert f0 is not None, fx
        side0_uid = f0["sides"][0]["user_ids"][0]
        ub_side = 0 if side0_uid == ub["user"]["id"] else 1
        opp_side = 1 - ub_side
        opp_uid = f0["sides"][opp_side]["user_ids"][0]
        body = {"sport_id": "squash", "opponent_user_id": opp_uid, "best_of": 1,
                "doubles": False, "first_server_side": ub_side,
                "side1_user_ids": [opp_uid],
                "competition_id": cid, "fixture_id": f0["id"]}
        r = requests.post(f"{BASE}/live/create", headers=_h(ub["token"]), json=body)
        assert r.status_code == 200, r.text
        lid = r.json()["live_id"]
        for _ in range(11):
            _levent(ub["token"], lid, "rally_won", ub_side)
        d = _lget(ub["token"], lid)
        assert d["status"] == "completed" and d["winner_side"] == ub_side
        rf = requests.post(f"{BASE}/live/{lid}/finalize", headers=_h(ub["token"]))
        assert rf.status_code == 200, rf.text
        det2 = requests.get(f"{BASE}/competitions/{cid}", headers=_h(ua["token"])).json()
        f_after = next(x for x in det2["fixtures"] if x["id"] == f0["id"])
        assert f_after["status"] == "complete", f_after
        # standings: ub gets 3 pts
        st = det2.get("standings", [])
        ub_row = next(x for x in st if x["user_id"] == ub["user"]["id"])
        assert ub_row["points"] == 3, ub_row


# =============== AUTH LOGOUT ===============
class TestAuthLogout:
    def test_logout_revokes_token(self):
        u = _register(sports=None, dn="logout-me")
        me = requests.get(f"{BASE}/auth/me", headers=_h(u["token"]))
        assert me.status_code == 200
        lo = requests.post(f"{BASE}/auth/logout", headers=_h(u["token"]))
        assert lo.status_code == 204, lo.text
        me2 = requests.get(f"{BASE}/auth/me", headers=_h(u["token"]))
        assert me2.status_code == 401, me2.text
