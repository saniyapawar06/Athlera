"""ATHLERA sport-specific scoring engine (authoritative, server-side).

The client renders `state` and posts events; the server advances the state
machine.  Every event snapshots the prior state so UNDO restores it exactly.

Point sports  : squash, badminton, pickleball  -> track points per game.
Game/set sports: tennis, padel                 -> 0/15/30/40/adv, games, sets, tiebreak.

All referee events (let, stroke, tin, fault, ...) reduce to "award a point to a
side" or "replay" (let) — the event TYPE is kept in the log for the timeline.
"""
from __future__ import annotations

import copy
from typing import Any, Optional

# ---------- Sport rule config (reusable / updatable) ----------
SPORT_RULES: dict[str, dict[str, Any]] = {
    "squash": {
        "kind": "point",
        "target": 11, "win_by": 2, "cap": None,
        "best_of_options": [1, 3, 5], "default_best_of": 5,
        "supports_doubles": False,
        "server_model": "rally_winner",      # winner of rally serves next (PARS)
        "referee_events": ["rally_won", "let", "stroke", "no_let", "tin", "out", "service_fault"],
        "point_events": {"rally_won": "server_or_side", "stroke": "receiver", "tin": "opponent", "out": "opponent", "service_fault": "opponent"},
        "replay_events": ["let"], "noop_events": ["no_let"],
    },
    "badminton": {
        "kind": "point",
        "target": 21, "win_by": 2, "cap": 30,
        "best_of_options": [1, 3], "default_best_of": 3,
        "supports_doubles": True,
        "server_model": "rally_winner",
        "referee_events": ["rally_won", "let", "service_fault", "fault", "shuttle_out"],
        "point_events": {"rally_won": "side", "service_fault": "opponent", "fault": "opponent", "shuttle_out": "opponent"},
        "replay_events": ["let"], "noop_events": [],
    },
    "pickleball": {
        "kind": "point",
        "target": 11, "win_by": 2, "cap": None,
        "best_of_options": [1, 3], "default_best_of": 1,
        "supports_doubles": True,
        "server_model": "side_out",          # only serving side scores
        "referee_events": ["rally_won", "service_fault", "replay", "kitchen_fault", "ball_out", "double_bounce_fault"],
        "point_events": {"rally_won": "side", "service_fault": "opponent", "kitchen_fault": "opponent", "ball_out": "opponent", "double_bounce_fault": "opponent"},
        "replay_events": ["replay"], "noop_events": [],
    },
    "tennis": {
        "kind": "set",
        "sets_to": 6, "set_win_by": 2, "tiebreak_at": 6, "tiebreak_to": 7, "tiebreak_win_by": 2,
        "best_of_options": [1, 3], "default_best_of": 3,
        "supports_doubles": True,
        "golden_point_option": False,
        "referee_events": ["point_won", "ace", "first_fault", "double_fault", "service_let", "winner", "forced_error", "unforced_error"],
        "point_events": {"point_won": "side", "ace": "server", "double_fault": "receiver", "winner": "side", "forced_error": "opponent", "unforced_error": "opponent"},
        "replay_events": ["service_let", "first_fault"], "noop_events": [],
    },
    "padel": {
        "kind": "set",
        "sets_to": 6, "set_win_by": 2, "tiebreak_at": 6, "tiebreak_to": 7, "tiebreak_win_by": 2,
        "best_of_options": [1, 3], "default_best_of": 3,
        "supports_doubles": True,
        "golden_point_option": True,         # selectable Advantage vs Golden Point
        "referee_events": ["point_won", "ace", "double_fault", "service_let", "winner", "forced_error", "unforced_error"],
        "point_events": {"point_won": "side", "ace": "server", "double_fault": "receiver", "winner": "side", "forced_error": "opponent", "unforced_error": "opponent"},
        "replay_events": ["service_let"], "noop_events": [],
    },
}

POINT_LABELS = {0: "0", 1: "15", 2: "30", 3: "40"}


def new_state(sport_id: str, sides: list[dict], best_of: int, doubles: bool,
              first_server_side: int, options: Optional[dict] = None) -> dict:
    rules = SPORT_RULES[sport_id]
    options = options or {}
    st: dict[str, Any] = {
        "sport_id": sport_id,
        "doubles": doubles,
        "best_of": best_of,
        "sides": sides,
        "games": [],            # completed games (point sports) or sets (set sports) as [a,b]
        "games_won": [0, 0],    # games (point sports) / SETS (set sports) won
        "status": "in_progress",
        "winner_side": None,
        "log": [],
        "options": {"golden_point": bool(options.get("golden_point", False))},
    }
    if rules["kind"] == "point":
        st["points"] = [0, 0]
        st["server_side"] = first_server_side
        if sport_id == "pickleball":
            # Opening service turn: starting team has only the "second server" (0-0-2 convention)
            st["server_number"] = 2 if doubles else 1
            st["opening_serve"] = True
        st["server_court"] = "right"
    else:  # set
        st["p"] = [0, 0]            # points in current game (0..3 = 0/15/30/40, higher = adv)
        st["games"] = []            # completed SETS as [a,b]
        st["cur_games"] = [0, 0]    # games in current set
        st["server_side"] = first_server_side
        st["tiebreak"] = False
        st["tb"] = [0, 0]
        st["tb_points_played"] = 0
    return st


def _snapshot(st: dict) -> dict:
    s = copy.deepcopy(st)
    s.pop("log", None)
    return s


def _resolve_point_side(sport_id: str, ev_type: str, ev_side: Optional[int], st: dict) -> Optional[int]:
    """Map a referee/point event to the side that GAINS a point (or None=replay/noop)."""
    rules = SPORT_RULES[sport_id]
    if ev_type in rules.get("replay_events", []):
        return None
    if ev_type in rules.get("noop_events", []):
        return None
    mapping = rules.get("point_events", {})
    kind = mapping.get(ev_type, "side")
    server = st.get("server_side", 0)
    if kind == "side":
        return ev_side if ev_side is not None else server
    if kind == "server":
        return server
    if kind == "server_or_side":
        return ev_side if ev_side is not None else server
    if kind == "opponent":
        base = ev_side if ev_side is not None else server
        return 1 - base
    if kind == "receiver":
        base = ev_side if ev_side is not None else server
        return 1 - base
    return ev_side if ev_side is not None else server


def _point_game_won(points: list[int], target: int, win_by: int, cap: Optional[int]) -> Optional[int]:
    hi = max(points); lo = min(points); s = 0 if points[0] > points[1] else 1
    if cap is not None and hi == cap:
        return s
    if hi >= target and hi - lo >= win_by:
        return s
    return None


def _advance_point_sport(st: dict, side: int) -> None:
    sid = st["sport_id"]
    rules = SPORT_RULES[sid]
    if sid == "pickleball":
        # side-out: only serving side scores
        server = st["server_side"]
        if side == server:
            st["points"][server] += 1
            st["opening_serve"] = False
        else:
            # rally won by receiving side -> fault on server
            if st["doubles"] and not st.get("opening_serve", False) and st.get("server_number", 1) == 1:
                st["server_number"] = 2
            else:
                st["server_side"] = 1 - server
                st["server_number"] = 1
                st["opening_serve"] = False
        won = _point_game_won(st["points"], rules["target"], rules["win_by"], rules["cap"])
    else:
        st["points"][side] += 1
        if rules["server_model"] == "rally_winner":
            st["server_side"] = side
            if sid == "badminton":
                st["server_court"] = "right" if st["points"][side] % 2 == 0 else "left"
        won = _point_game_won(st["points"], rules["target"], rules["win_by"], rules["cap"])
    if won is not None:
        st["games"].append([st["points"][0], st["points"][1]])
        st["games_won"][won] += 1
        st["points"] = [0, 0]
        st["opening_serve"] = True if sid == "pickleball" else st.get("opening_serve")
        if sid == "pickleball":
            st["server_side"] = won
            st["server_number"] = 2 if st["doubles"] else 1
        _check_match_over_point(st)


def _check_match_over_point(st: dict) -> None:
    need = (st["best_of"] // 2) + 1
    for s in (0, 1):
        if st["games_won"][s] >= need:
            st["status"] = "completed"
            st["winner_side"] = s


def _advance_set_sport(st: dict, side: int) -> None:
    sid = st["sport_id"]
    rules = SPORT_RULES[sid]
    golden = st["options"].get("golden_point") and rules.get("golden_point_option")

    if st["tiebreak"]:
        st["tb"][side] += 1
        st["tb_points_played"] += 1
        # serve changes after first point then every 2 points
        if st["tb_points_played"] == 1 or (st["tb_points_played"] - 1) % 2 == 0:
            st["server_side"] = 1 - st["server_side"]
        hi, lo = max(st["tb"]), min(st["tb"])
        if hi >= rules["tiebreak_to"] and hi - lo >= rules["tiebreak_win_by"]:
            win = 0 if st["tb"][0] > st["tb"][1] else 1
            st["cur_games"][win] += 1
            st["games"].append([st["cur_games"][0], st["cur_games"][1]])
            st["games_won"][win] += 1
            st["cur_games"] = [0, 0]
            st["tiebreak"] = False
            st["tb"] = [0, 0]; st["tb_points_played"] = 0
            st["server_side"] = 1 - st["server_side"]
            _check_match_over_set(st)
        return

    p = st["p"]
    p[side] += 1
    game_won: Optional[int] = None
    if golden and p[0] >= 3 and p[1] >= 3 and p[0] == 3 and p[1] == 3:
        # at deuce with golden point, the very next point (this one) wins
        game_won = side
    elif p[side] >= 4 and p[side] - p[1 - side] >= 2:
        game_won = side
    elif p[0] >= 3 and p[1] >= 3 and p[0] == p[1]:
        # back to deuce
        st["p"] = [3, 3]

    if game_won is not None:
        st["cur_games"][game_won] += 1
        st["p"] = [0, 0]
        st["server_side"] = 1 - st["server_side"]
        cg = st["cur_games"]
        # tiebreak trigger
        if cg[0] == rules["tiebreak_at"] and cg[1] == rules["tiebreak_at"]:
            st["tiebreak"] = True
            st["tb"] = [0, 0]; st["tb_points_played"] = 0
        else:
            hi, lo = max(cg), min(cg)
            if hi >= rules["sets_to"] and hi - lo >= rules["set_win_by"]:
                win = 0 if cg[0] > cg[1] else 1
                st["games"].append([cg[0], cg[1]])
                st["games_won"][win] += 1
                st["cur_games"] = [0, 0]
                _check_match_over_set(st)


def _check_match_over_set(st: dict) -> None:
    need = (st["best_of"] // 2) + 1
    for s in (0, 1):
        if st["games_won"][s] >= need:
            st["status"] = "completed"
            st["winner_side"] = s


def apply_event(st: dict, ev_type: str, ev_side: Optional[int] = None, note: Optional[str] = None) -> dict:
    """Apply an event and return new state. `undo` pops the last snapshot."""
    sid = st["sport_id"]
    if ev_type == "undo":
        if st["log"]:
            last = st["log"].pop()
            snap = last.get("snapshot")
            if snap is not None:
                log = st["log"]
                st = snap
                st["log"] = log
        return st
    if st["status"] == "completed":
        return st

    snapshot = _snapshot(st)
    side = _resolve_point_side(sid, ev_type, ev_side, st)
    if side is not None:
        if SPORT_RULES[sid]["kind"] == "point":
            _advance_point_sport(st, side)
        else:
            _advance_set_sport(st, side)
    st["log"].append({
        "seq": len(st["log"]) + 1,
        "type": ev_type,
        "side": ev_side,
        "scored_side": side,
        "note": note,
        "snapshot": snapshot,
    })
    return st


def display(st: dict) -> dict:
    """Compact display info for the client."""
    sid = st["sport_id"]
    rules = SPORT_RULES[sid]
    out: dict[str, Any] = {
        "sport_id": sid, "status": st["status"], "winner_side": st["winner_side"],
        "games_won": st["games_won"], "completed_games": st["games"],
        "server_side": st.get("server_side"), "best_of": st["best_of"], "doubles": st["doubles"],
        "kind": rules["kind"],
    }
    if rules["kind"] == "point":
        out["points"] = st["points"]
        if sid == "pickleball":
            out["server_number"] = st.get("server_number")
            out["score_call"] = f"{st['points'][st['server_side']]}-{st['points'][1-st['server_side']]}" + (f"-{st.get('server_number')}" if st["doubles"] else "")
        if sid == "badminton":
            out["server_court"] = st.get("server_court")
    else:
        if st["tiebreak"]:
            out["tiebreak"] = True
            out["points_display"] = [str(st["tb"][0]), str(st["tb"][1])]
        else:
            out["tiebreak"] = False
            def lbl(i):
                a, b = st["p"][0], st["p"][1]
                if a >= 3 and b >= 3:
                    if a == b: return "40"
                    return "Ad" if st["p"][i] > st["p"][1 - i] else "40"
                return POINT_LABELS.get(st["p"][i], "40")
            out["points_display"] = [lbl(0), lbl(1)]
        out["cur_games"] = st["cur_games"]
    return out


def summary(st: dict) -> dict:
    """Result summary used by the rating engine."""
    side_wins = list(st["games_won"])
    # total points across all games/sets
    tp = [0, 0]
    for g in st["games"]:
        tp[0] += g[0]; tp[1] += g[1]
    if SPORT_RULES[st["sport_id"]]["kind"] == "point" and st["points"] != [0, 0]:
        tp[0] += st["points"][0]; tp[1] += st["points"][1]
    winner_side = st["winner_side"]
    return {
        "winner_side": winner_side,
        "side_wins": side_wins,
        "unit_diff": abs(side_wins[0] - side_wins[1]),
        "unit_total": max(1, sum(side_wins)),
        "point_diff": abs(tp[0] - tp[1]),
        "point_total": max(1, sum(tp)),
        "total_points": tp,
        "games": st["games"],
    }
