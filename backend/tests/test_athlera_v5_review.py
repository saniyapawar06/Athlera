"""ATHLERA V5 — review-request coverage.

Covers:
  * POST /events/create validation (public event needs country+city+starts_at)
  * GET /events/upcoming filters (country, city, paid=free|paid, date, sport_id, near_city ordering)
  * Paid event registration -> Pending + pay.mode=test, mock-confirm -> Confirmed
  * Free event register -> Confirmed instantly; withdraw -> Cancelled; capacity full rejected
  * GET /events/{id} returns my_registration + payments_live=false
  * GET /me/dashboard exposes gamification fields
  * GET /social/feed items include `type`; GET /social/nearby includes `angle`+`same_city`
  * PATCH /fixtures/{id} with scheduled_at (organiser); POST /competitions/{cid}/fixtures with scheduled_at
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"

QA_EMAIL = "qa.tester@athlera.dev"
QA_PASS = "Test1234!"

ONBOARD_ALL = [
    {"sport_id": s, "has_accredited": False, "level_id": "intermediate"}
    for s in ("squash", "badminton", "tennis", "padel", "pickleball")
]


def _h(t: str) -> dict:
    return {"Authorization": f"Bearer {t}"}


def _future_iso(days=7, hour=18) -> str:
    d = datetime.now(timezone.utc) + timedelta(days=days)
    d = d.replace(hour=hour, minute=0, second=0, microsecond=0)
    return d.isoformat().replace("+00:00", "Z")


def _register_user(dn="QA V5", city=None):
    email = f"qa+v5_{uuid.uuid4().hex[:10]}@athlera.dev"
    body = {"email": email, "password": "secret123", "display_name": dn}
    if city:
        body["city"] = city
    r = requests.post(f"{BASE}/auth/register", json=body)
    assert r.status_code == 201, r.text
    tok = r.json()["access_token"]
    if city:
        requests.patch(f"{BASE}/auth/me", headers=_h(tok), json={"city": city})
    ob = requests.post(f"{BASE}/onboarding/submit", headers=_h(tok),
                       json={"submissions": ONBOARD_ALL})
    assert ob.status_code == 200
    return {"email": email, "token": tok, "user": r.json()["user"]}


@pytest.fixture(scope="module")
def qa_tok():
    r = requests.post(f"{BASE}/auth/login", json={"email": QA_EMAIL, "password": QA_PASS})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def user_a():
    return _register_user(dn="QA V5 A", city="London")


@pytest.fixture(scope="module")
def user_b():
    return _register_user(dn="QA V5 B", city="London")


# =============== EVENTS: CREATE + VALIDATION ===============
class TestEventCreateValidation:
    def test_public_event_requires_country_and_city(self, qa_tok):
        # Omit `country` — public rule requires both country+city; venue+city are
        # Pydantic-required. Missing country should surface 400 from the handler.
        body = {
            "name": "TEST_v5_no_geo",
            "sport_id": "squash",
            "format": "league",
            "visibility": "public",
            "capacity": 8,
            "is_paid": False,
            "starts_at": _future_iso(),
            "venue": "TEST venue",
            "city": "Mumbai",
        }
        r = requests.post(f"{BASE}/events/create", json=body, headers=_h(qa_tok))
        assert r.status_code == 400, r.text
        body["country"] = "IN"
        r2 = requests.post(f"{BASE}/events/create", json=body, headers=_h(qa_tok))
        assert r2.status_code == 200, r2.text
        ev = r2.json()["event"]
        assert ev["country"] == "IN" and ev["city"] == "Mumbai"
        assert ev["starts_at"]

    def test_create_paid_event(self, qa_tok):
        body = {
            "name": "TEST_v5_paid",
            "sport_id": "tennis", "format": "knockout",
            "visibility": "public", "capacity": 4,
            "is_paid": True, "fee": 200, "currency": "INR",
            "country": "IN", "city": "Bengaluru",
            "venue": "TEST venue",
            "starts_at": _future_iso(3),
        }
        r = requests.post(f"{BASE}/events/create", json=body, headers=_h(qa_tok))
        assert r.status_code == 200, r.text
        return r.json()["event"]


# =============== EVENTS: UPCOMING FILTERS ===============
class TestEventsUpcomingFilters:
    @pytest.fixture(scope="class")
    def seeded(self, qa_tok):
        base = {
            "sport_id": "squash", "format": "league",
            "visibility": "public", "capacity": 8,
            "venue": "TEST venue", "starts_at": _future_iso(5),
        }
        # Free in Mumbai IN
        r1 = requests.post(f"{BASE}/events/create", headers=_h(qa_tok), json={
            **base, "name": f"TEST_v5_free_mum_{uuid.uuid4().hex[:5]}",
            "is_paid": False, "country": "IN", "city": "Mumbai",
        })
        assert r1.status_code == 200, r1.text
        # Paid in Bengaluru IN
        r2 = requests.post(f"{BASE}/events/create", headers=_h(qa_tok), json={
            **base, "name": f"TEST_v5_paid_blr_{uuid.uuid4().hex[:5]}",
            "is_paid": True, "fee": 100, "currency": "INR",
            "country": "IN", "city": "Bengaluru", "sport_id": "tennis",
        })
        assert r2.status_code == 200, r2.text
        # Free in London UK
        r3 = requests.post(f"{BASE}/events/create", headers=_h(qa_tok), json={
            **base, "name": f"TEST_v5_free_lon_{uuid.uuid4().hex[:5]}",
            "is_paid": False, "country": "GB", "city": "London",
        })
        assert r3.status_code == 200, r3.text
        return {
            "mum": r1.json()["event"], "blr": r2.json()["event"], "lon": r3.json()["event"]
        }

    def test_country_filter(self, qa_tok, seeded):
        r = requests.get(f"{BASE}/events/upcoming", params={"country": "IN"}, headers=_h(qa_tok))
        assert r.status_code == 200
        evs = r.json()["events"]
        ids = {e["id"] for e in evs}
        assert seeded["mum"]["id"] in ids and seeded["blr"]["id"] in ids
        assert seeded["lon"]["id"] not in ids
        assert all(e.get("country") == "IN" for e in evs)

    def test_city_filter(self, qa_tok, seeded):
        r = requests.get(f"{BASE}/events/upcoming", params={"city": "Mumbai"}, headers=_h(qa_tok))
        evs = r.json()["events"]
        ids = {e["id"] for e in evs}
        assert seeded["mum"]["id"] in ids
        assert seeded["blr"]["id"] not in ids

    def test_paid_free_filter(self, qa_tok, seeded):
        rf = requests.get(f"{BASE}/events/upcoming", params={"paid": "free"}, headers=_h(qa_tok))
        assert all(e.get("is_paid") is False for e in rf.json()["events"])
        rp = requests.get(f"{BASE}/events/upcoming", params={"paid": "paid"}, headers=_h(qa_tok))
        assert all(e.get("is_paid") is True for e in rp.json()["events"])
        ids_paid = {e["id"] for e in rp.json()["events"]}
        assert seeded["blr"]["id"] in ids_paid

    def test_date_filter(self, qa_tok, seeded):
        d = seeded["mum"]["starts_at"][:10]
        r = requests.get(f"{BASE}/events/upcoming", params={"date": d}, headers=_h(qa_tok))
        evs = r.json()["events"]
        assert all(e.get("starts_at", "")[:10] == d for e in evs)

    def test_sport_filter(self, qa_tok, seeded):
        r = requests.get(f"{BASE}/events/upcoming", params={"sport_id": "tennis"}, headers=_h(qa_tok))
        evs = r.json()["events"]
        assert all(e["sport_id"] == "tennis" for e in evs)
        assert seeded["blr"]["id"] in {e["id"] for e in evs}

    def test_near_city_ordering(self, qa_tok, seeded):
        r = requests.get(f"{BASE}/events/upcoming",
                         params={"near_city": "Mumbai", "country": "IN"},
                         headers=_h(qa_tok))
        evs = r.json()["events"]
        # same_city=True must precede same_city=False
        seen_false = False
        for e in evs:
            if not e.get("same_city"):
                seen_false = True
            elif seen_false:
                pytest.fail("same_city=True after same_city=False")


# =============== EVENTS: REGISTER / PAY / WITHDRAW ===============
class TestEventRegistration:
    def _mk_event(self, qa_tok, **over):
        body = {
            "name": f"TEST_v5_reg_{uuid.uuid4().hex[:6]}",
            "sport_id": "squash", "format": "league",
            "visibility": "public", "capacity": 2,
            "is_paid": False, "country": "IN", "city": "Mumbai",
            "venue": "TEST venue",
            "starts_at": _future_iso(6),
        }
        body.update(over)
        r = requests.post(f"{BASE}/events/create", json=body, headers=_h(qa_tok))
        assert r.status_code == 200, r.text
        return r.json()["event"]

    def test_free_event_confirms_and_withdraw(self, qa_tok, user_a):
        ev = self._mk_event(qa_tok)
        r = requests.post(f"{BASE}/events/{ev['id']}/register",
                          headers=_h(user_a["token"]),
                          json={"name": "TEST User A"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "Confirmed" and body.get("free") is True

        # detail shows my_registration=Confirmed + payments_live=false
        d = requests.get(f"{BASE}/events/{ev['id']}", headers=_h(user_a["token"])).json()["event"]
        assert d["is_registered"] is True
        assert d["my_registration"]["status"] == "Confirmed"
        assert d["payments_live"] is False

        # withdraw
        w = requests.post(f"{BASE}/events/{ev['id']}/withdraw", headers=_h(user_a["token"]))
        assert w.status_code == 200, w.text
        d2 = requests.get(f"{BASE}/events/{ev['id']}", headers=_h(user_a["token"])).json()["event"]
        assert d2["is_registered"] is False
        assert d2["my_registration"]["status"] == "Cancelled"

    def test_paid_event_pending_then_mock_confirm(self, qa_tok, user_a):
        ev = self._mk_event(qa_tok, is_paid=True, fee=250, currency="INR",
                            capacity=4, sport_id="tennis")
        r = requests.post(f"{BASE}/events/{ev['id']}/register",
                          headers=_h(user_a["token"]),
                          json={"name": "TEST User A", "email": "a@example.com", "phone": "+9100000"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "Pending"
        assert body["pay"]["mode"] == "test"
        reg_id = body["pay"]["registration_id"]

        # detail: not yet in registered_user_ids
        d = requests.get(f"{BASE}/events/{ev['id']}", headers=_h(user_a["token"])).json()["event"]
        assert d["is_registered"] is False
        assert d["my_registration"]["status"] == "Pending"

        # mock confirm
        c = requests.post(f"{BASE}/events/{ev['id']}/pay/mock-confirm",
                          headers=_h(user_a["token"]),
                          json={"registration_id": reg_id})
        assert c.status_code == 200, c.text
        assert c.json()["status"] == "Confirmed"

        d2 = requests.get(f"{BASE}/events/{ev['id']}", headers=_h(user_a["token"])).json()["event"]
        assert d2["is_registered"] is True
        assert d2["my_registration"]["status"] == "Confirmed"

    def test_capacity_full_rejected(self, qa_tok, user_a, user_b):
        ev = self._mk_event(qa_tok, capacity=2)
        # Fill both slots with the QA organiser account plus user_a
        r1 = requests.post(f"{BASE}/events/{ev['id']}/register",
                           headers=_h(user_a["token"]), json={"name": "A"})
        assert r1.status_code == 200
        r_qa = requests.post(f"{BASE}/events/{ev['id']}/register",
                             headers=_h(qa_tok), json={"name": "QA"})
        assert r_qa.status_code == 200
        # Third registration should be rejected
        r2 = requests.post(f"{BASE}/events/{ev['id']}/register",
                           headers=_h(user_b["token"]), json={"name": "B"})
        assert r2.status_code == 400, r2.text
        assert "full" in r2.text.lower()


# =============== DASHBOARD GAMIFICATION ===============
class TestDashboardGamification:
    def test_dashboard_has_gamification(self, qa_tok):
        r = requests.get(f"{BASE}/me/dashboard", headers=_h(qa_tok))
        assert r.status_code == 200, r.text
        body = r.json()
        assert "gamification" in body
        g = body["gamification"]
        for k in ("current_streak", "longest_streak", "recent_form",
                  "matches_this_week", "best_rank", "badges"):
            assert k in g, f"missing gamification.{k}"
        assert isinstance(g["recent_form"], list)
        assert isinstance(g["badges"], list)


# =============== SOCIAL FEED + NEARBY ===============
class TestSocialFeedType:
    def test_feed_items_have_type(self, qa_tok):
        r = requests.get(f"{BASE}/social/feed", headers=_h(qa_tok))
        assert r.status_code == 200
        items = r.json()["items"]
        for it in items[:10]:
            assert "type" in it, f"feed item missing type: {it}"


class TestNearbyPlayers:
    def test_nearby_has_angle_and_same_city(self, qa_tok):
        r = requests.get(f"{BASE}/social/nearby",
                         params={"sport_id": "squash", "city": "London"},
                         headers=_h(qa_tok))
        assert r.status_code == 200, r.text
        players = r.json()["players"]
        for p in players[:10]:
            assert "same_city" in p, f"nearby item missing same_city: {p}"
            assert "angle" in p, f"nearby item missing angle: {p}"
            # No exact coords
            for banned in ("lat", "lng", "latitude", "longitude", "coords"):
                assert banned not in p


# =============== FIXTURE SCHEDULING ===============
class TestFixtureScheduling:
    def test_patch_fixture_scheduled_at(self, qa_tok):
        # find QA KO Cup by name for organiser (QA account)
        r = requests.get(f"{BASE}/competitions/list",
                         params={"sport_id": "squash"}, headers=_h(qa_tok))
        assert r.status_code == 200
        comps = r.json()["competitions"]
        ko = next((c for c in comps if "QA KO Cup" in c.get("name", "")), None)
        assert ko, "QA KO Cup missing"
        det = requests.get(f"{BASE}/competitions/{ko['id']}", headers=_h(qa_tok)).json()
        fx = det.get("fixtures") or []
        target = next((f for f in fx if f.get("status") != "played"), None)
        assert target, "no unplayed fixture"
        new_dt = _future_iso(10, hour=17)
        p = requests.patch(f"{BASE}/fixtures/{target['id']}",
                           headers=_h(qa_tok),
                           json={"scheduled_at": new_dt})
        assert p.status_code == 200, p.text
        # re-fetch and verify persisted
        det2 = requests.get(f"{BASE}/competitions/{ko['id']}", headers=_h(qa_tok)).json()
        got = next(f for f in det2["fixtures"] if f["id"] == target["id"])
        assert got.get("scheduled_at") == new_dt

    def test_add_fixture_with_scheduled_at(self, qa_tok):
        r = requests.get(f"{BASE}/competitions/list",
                         params={"sport_id": "tennis"}, headers=_h(qa_tok))
        comps = r.json()["competitions"]
        lg = next((c for c in comps if "QA Manual League" in c.get("name", "")), None)
        assert lg, "QA Manual League missing"
        det = requests.get(f"{BASE}/competitions/{lg['id']}", headers=_h(qa_tok)).json()
        members = det.get("competition", {}).get("members") or []
        players = [m["user_id"] for m in members if m.get("role") != "organiser"]
        assert len(players) >= 2, f"need at least 2 participants, got {len(players)}"
        p1, p2 = players[0], players[1]
        new_dt = _future_iso(12, hour=19)
        add = requests.post(
            f"{BASE}/competitions/{lg['id']}/fixtures",
            headers=_h(qa_tok),
            json={"side0_user_ids": [p1], "side1_user_ids": [p2],
                  "scheduled_at": new_dt},
        )
        assert add.status_code == 200, add.text
        det2 = requests.get(f"{BASE}/competitions/{lg['id']}", headers=_h(qa_tok)).json()
        matching = [f for f in det2["fixtures"] if f.get("scheduled_at") == new_dt]
        assert matching, "added fixture missing scheduled_at"
