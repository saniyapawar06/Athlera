import requests

BASE = "http://localhost:8001/api"
EMAIL = "demo.gamer@athlera.com"
PW = "Demo1234!"


def h(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


def get_token():
    r = requests.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PW})
    if r.status_code == 200:
        return r.json()["access_token"], False
    r = requests.post(f"{BASE}/auth/register", json={"email": EMAIL, "password": PW, "display_name": "Demo Gamer"})
    r.raise_for_status()
    return r.json()["access_token"], True


def main():
    tok, is_new = get_token()
    me = requests.get(f"{BASE}/auth/me", headers=h(tok)).json()
    print("user onboarded:", me.get("onboarded"))
    if is_new or not me.get("onboarded"):
        requests.post(f"{BASE}/onboarding/submit", headers=h(tok), json={
            "submissions": [
                {"sport_id": "squash", "has_accredited": False, "level_id": "intermediate"},
                {"sport_id": "tennis", "has_accredited": False, "level_id": "advanced"},
            ]
        })
    # play matches in squash (wins) to build a streak + achievements
    for sid, games in [("squash", [[11, 6], [11, 8], [11, 4]]), ("tennis", [[6, 3], [6, 4]])]:
        opps = requests.get(f"{BASE}/opponents/search?sport_id={sid}&q=", headers=h(tok)).json()["opponents"]
        for i in range(3):
            opp = opps[i % len(opps)]
            requests.post(f"{BASE}/matches/submit", headers=h(tok), json={
                "sport_id": sid, "opponent_user_id": opp["user_id"], "games": games,
            })
    # share a highlight to the feed
    requests.post(f"{BASE}/social/share", headers=h(tok), json={
        "kind": "streak", "headline": "3 match win streak in Squash", "subtext": "Momentum building", "icon": "flame", "sport_id": "squash",
    })
    dash = requests.get(f"{BASE}/me/dashboard", headers=h(tok)).json()
    print("achievement_count:", dash["achievement_count"])
    for c in dash["cards"]:
        print(c["sport_name"], "->", [i["text"] for i in c["insights"]])
    print("DONE. login:", EMAIL, PW)


if __name__ == "__main__":
    main()
