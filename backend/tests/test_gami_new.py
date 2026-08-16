import requests, uuid
BASE = "http://localhost:8001/api"
def h(t): return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}

email = f"gami2_{uuid.uuid4().hex[:8]}@test.com"
tok = requests.post(f"{BASE}/auth/register", json={"email": email, "password": "pass1234", "display_name": "Gami2"}).json()["access_token"]
sid = "squash"
requests.post(f"{BASE}/onboarding/submit", headers=h(tok), json={"submissions": [{"sport_id": sid, "has_accredited": False, "level_id": "intermediate"}]})
opps = requests.get(f"{BASE}/opponents/search?sport_id={sid}&q=", headers=h(tok)).json()["opponents"]
for i in range(4):
    res = requests.post(f"{BASE}/matches/submit", headers=h(tok), json={"sport_id": sid, "opponent_user_id": opps[i % len(opps)]["user_id"], "games": [[11,5],[11,6],[11,7]]})
    j = res.json(); rc = j.get("rating_change") or {}
    print(f"match{i}", res.status_code, "delta", rc.get("delta"), "streak", rc.get("streak"), "new_peak", rc.get("new_peak"))
d = requests.get(f"{BASE}/me/dashboard", headers=h(tok)).json()
card = next(c for c in d["cards"] if c["sport_id"] == sid)
print("INSIGHTS:", [i["text"] for i in card["insights"]])
print("gamification ach:", d["gamification"].get("achievement_count"), "/", d["gamification"].get("achievement_total"))
ach = requests.get(f"{BASE}/me/achievements", headers=h(tok)).json()
print("unlocked:", [c["code"] for c in ach["catalog"] if c["unlocked"]], "count", ach["unlocked_count"], "/", ach["total"])
sr = requests.post(f"{BASE}/social/share", headers=h(tok), json={"kind": "streak", "headline": "4 match streak in Squash", "subtext": "On fire", "icon": "flame", "sport_id": sid})
print("share", sr.status_code)
feed = requests.get(f"{BASE}/social/feed", headers=h(tok)).json()["items"]
print("feed types:", sorted(set(i["type"] for i in feed)), "has highlight:", any(i["type"]=="highlight" for i in feed))
