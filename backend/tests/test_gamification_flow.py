import requests, uuid

BASE = "http://localhost:8001/api"


def h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def run():
    email = f"gami_{uuid.uuid4().hex[:8]}@test.com"
    r = requests.post(f"{BASE}/auth/register", json={"email": email, "password": "pass1234", "display_name": "Gami Tester"})
    print("register", r.status_code)
    tok = r.json()["access_token"]

    sports = requests.get(f"{BASE}/sports", headers=h(tok)).json()
    sid = "squash"
    # onboard into squash at intermediate
    r = requests.post(f"{BASE}/onboarding/submit", headers=h(tok), json={
        "submissions": [{"sport_id": sid, "has_accredited": False, "level_id": "intermediate"}]
    })
    print("onboard", r.status_code, r.text[:120])

    # find seed opponents
    opps = requests.get(f"{BASE}/opponents/search?sport_id={sid}&q=", headers=h(tok)).json()["opponents"]
    print("opponents", len(opps))

    # play several wins vs seed opponents to trigger streaks/achievements
    unlocked_total = []
    for i in range(4):
        opp = opps[i % len(opps)]
        games = [[11, 5], [11, 6], [11, 7]]  # squash bo? just 3 wins for me (side 0)
        res = requests.post(f"{BASE}/matches/submit", headers=h(tok), json={
            "sport_id": sid, "opponent_user_id": opp["user_id"], "games": games,
        })
        j = res.json()
        rc = j.get("rating_change") or {}
        print(f"match {i}", res.status_code, "delta", rc.get("delta"), "streak", rc.get("streak"), "ach", [a['code'] for a in rc.get('achievements', [])])
        unlocked_total += [a['code'] for a in rc.get('achievements', [])]

    dash = requests.get(f"{BASE}/me/dashboard", headers=h(tok)).json()
    card = next(c for c in dash["cards"] if c["sport_id"] == sid)
    print("INSIGHTS:", [i["text"] for i in card["insights"]])
    print("recent_achievements:", [a["title"] for a in dash["recent_achievements"]])
    print("achievement_count:", dash["achievement_count"], "/", dash["achievement_total"])

    ach = requests.get(f"{BASE}/me/achievements", headers=h(tok)).json()
    print("unlocked:", [a["code"] for a in ach["unlocked"]])
    print("catalog size:", len(ach["catalog"]))

    # share to feed
    sr = requests.post(f"{BASE}/social/share", headers=h(tok), json={
        "kind": "streak", "headline": "4 match streak in Squash", "subtext": "On fire", "icon": "flame", "sport_id": sid,
    })
    print("share", sr.status_code)
    feed = requests.get(f"{BASE}/social/feed", headers=h(tok)).json()["items"]
    print("feed items:", len(feed), "types:", set(i["type"] for i in feed))
    hi = [i for i in feed if i["type"] == "highlight"]
    print("highlight sample:", hi[0] if hi else None)


if __name__ == "__main__":
    run()
