/**
 * Client-side mirror of backend scoring.py so live scoring is INSTANT (no await).
 * We compute score locally and sync normalized events to the backend, which runs
 * the same logic and therefore reaches the identical state.
 *
 * We only ever send the backend normalized point events:
 *   point sports -> "rally_won" with side = winner
 *   set sports   -> "point_won" with side = winner
 *   replay       -> "let" (point/badminton/squash) / "service_let" (tennis/padel) / "replay" (pickleball)
 *   undo         -> "undo"
 * The human-readable Stroke / No Let / Let semantics live in the client event log.
 */

export type Rules = {
  kind: "point" | "set";
  target?: number; win_by?: number; cap?: number | null;
  sets_to?: number; set_win_by?: number; tiebreak_at?: number; tiebreak_to?: number; tiebreak_win_by?: number;
  best_of_options: number[]; default_best_of: number;
  supports_doubles: boolean; golden_point_option?: boolean; server_model?: string;
};

export const SPORT_RULES: Record<string, Rules> = {
  squash: { kind: "point", target: 11, win_by: 2, cap: null, best_of_options: [1, 3, 5], default_best_of: 5, supports_doubles: false, server_model: "rally_winner" },
  badminton: { kind: "point", target: 21, win_by: 2, cap: 30, best_of_options: [1, 3], default_best_of: 3, supports_doubles: true, server_model: "rally_winner" },
  pickleball: { kind: "point", target: 11, win_by: 2, cap: null, best_of_options: [1, 3], default_best_of: 1, supports_doubles: true, server_model: "side_out" },
  tennis: { kind: "set", sets_to: 6, set_win_by: 2, tiebreak_at: 6, tiebreak_to: 7, tiebreak_win_by: 2, best_of_options: [1, 3], default_best_of: 3, supports_doubles: true },
  padel: { kind: "set", sets_to: 6, set_win_by: 2, tiebreak_at: 6, tiebreak_to: 7, tiebreak_win_by: 2, best_of_options: [1, 3], default_best_of: 3, supports_doubles: true, golden_point_option: true },
};

const POINT_LABELS: Record<number, string> = { 0: "0", 1: "15", 2: "30", 3: "40" };

const clone = (o: any) => JSON.parse(JSON.stringify(o));

export function newState(sportId: string, sides: any[], bestOf: number, doubles: boolean, firstServerSide: number, options: any = {}): any {
  const rules = SPORT_RULES[sportId];
  const st: any = {
    sport_id: sportId, doubles, best_of: bestOf, sides,
    games: [], games_won: [0, 0], status: "in_progress", winner_side: null, log: [],
    options: { golden_point: !!options.golden_point, padel_scoring: options.padel_scoring || "advantage" },
  };
  if (rules.kind === "point") {
    st.points = [0, 0];
    st.server_side = firstServerSide;
    if (sportId === "pickleball") { st.server_number = doubles ? 2 : 1; st.opening_serve = true; }
    st.server_court = "right";
  } else {
    st.p = [0, 0];
    st.cur_games = [0, 0];
    st.server_side = firstServerSide;
    st.tiebreak = false; st.tb = [0, 0]; st.tb_points_played = 0;
  }
  return st;
}

function snapshot(st: any) { const s = clone(st); delete s.log; return s; }

function pointGameWon(points: number[], target: number, winBy: number, cap: number | null): number | null {
  const hi = Math.max(points[0], points[1]); const lo = Math.min(points[0], points[1]);
  const s = points[0] > points[1] ? 0 : 1;
  if (cap != null && hi === cap) return s;
  if (hi >= target && hi - lo >= winBy) return s;
  return null;
}

function checkMatchOver(st: any) {
  const need = Math.floor(st.best_of / 2) + 1;
  for (const s of [0, 1]) if (st.games_won[s] >= need) { st.status = "completed"; st.winner_side = s; }
}

function advancePoint(st: any, side: number) {
  const sid = st.sport_id; const rules = SPORT_RULES[sid];
  let won: number | null;
  if (sid === "pickleball") {
    const server = st.server_side;
    if (side === server) { st.points[server] += 1; st.opening_serve = false; }
    else {
      if (st.doubles && !st.opening_serve && (st.server_number || 1) === 1) st.server_number = 2;
      else { st.server_side = 1 - server; st.server_number = 1; st.opening_serve = false; }
    }
    won = pointGameWon(st.points, rules.target!, rules.win_by!, rules.cap ?? null);
  } else {
    st.points[side] += 1;
    if (rules.server_model === "rally_winner") {
      st.server_side = side;
      if (sid === "badminton") st.server_court = st.points[side] % 2 === 0 ? "right" : "left";
    }
    won = pointGameWon(st.points, rules.target!, rules.win_by!, rules.cap ?? null);
  }
  if (won != null) {
    st.games.push([st.points[0], st.points[1]]);
    st.games_won[won] += 1;
    st.points = [0, 0];
    if (sid === "pickleball") { st.server_side = won; st.server_number = st.doubles ? 2 : 1; st.opening_serve = true; }
    checkMatchOver(st);
  }
}

function advanceSet(st: any, side: number) {
  const sid = st.sport_id; const rules = SPORT_RULES[sid];
  const mode = st.options.padel_scoring || "advantage";
  const golden = rules.golden_point_option && (st.options.golden_point || mode === "golden_point" || mode === "star_point");

  if (st.tiebreak) {
    st.tb[side] += 1; st.tb_points_played += 1;
    if (st.tb_points_played === 1 || (st.tb_points_played - 1) % 2 === 0) st.server_side = 1 - st.server_side;
    const hi = Math.max(st.tb[0], st.tb[1]); const lo = Math.min(st.tb[0], st.tb[1]);
    if (hi >= rules.tiebreak_to! && hi - lo >= rules.tiebreak_win_by!) {
      const win = st.tb[0] > st.tb[1] ? 0 : 1;
      st.cur_games[win] += 1;
      st.games.push([st.cur_games[0], st.cur_games[1]]);
      st.games_won[win] += 1;
      st.cur_games = [0, 0]; st.tiebreak = false; st.tb = [0, 0]; st.tb_points_played = 0;
      st.server_side = 1 - st.server_side;
      checkMatchOver(st);
    }
    return;
  }

  const p = st.p; p[side] += 1;
  let gameWon: number | null = null;
  if (golden && p[0] >= 3 && p[1] >= 3 && p[0] === 3 && p[1] === 3) gameWon = side;
  else if (p[side] >= 4 && p[side] - p[1 - side] >= 2) gameWon = side;
  else if (p[0] >= 3 && p[1] >= 3 && p[0] === p[1]) st.p = [3, 3];

  if (gameWon != null) {
    st.cur_games[gameWon] += 1; st.p = [0, 0];
    st.server_side = 1 - st.server_side;
    const cg = st.cur_games;
    if (cg[0] === rules.tiebreak_at! && cg[1] === rules.tiebreak_at!) { st.tiebreak = true; st.tb = [0, 0]; st.tb_points_played = 0; }
    else {
      const hi = Math.max(cg[0], cg[1]); const lo = Math.min(cg[0], cg[1]);
      if (hi >= rules.sets_to! && hi - lo >= rules.set_win_by!) {
        const win = cg[0] > cg[1] ? 0 : 1;
        st.games.push([cg[0], cg[1]]); st.games_won[win] += 1; st.cur_games = [0, 0];
        checkMatchOver(st);
      }
    }
  }
}

/** Apply a normalized local event. type: 'point' | 'replay' | 'undo'. side required for 'point'. */
export function applyLocal(st: any, type: "point" | "replay" | "undo", side?: number, note?: string): any {
  if (type === "undo") {
    if (st.log.length) {
      const last = st.log.pop();
      if (last.snapshot) { const log = st.log; st = last.snapshot; st.log = log; }
    }
    return st;
  }
  if (st.status === "completed") return st;
  const snap = snapshot(st);
  if (type === "point" && side != null) {
    if (SPORT_RULES[st.sport_id].kind === "point") advancePoint(st, side);
    else advanceSet(st, side);
  }
  st.log.push({ seq: st.log.length + 1, type, side: side ?? null, note: note ?? null, snapshot: snap });
  return st;
}

export function display(st: any): any {
  const sid = st.sport_id; const rules = SPORT_RULES[sid];
  const out: any = {
    sport_id: sid, status: st.status, winner_side: st.winner_side,
    games_won: st.games_won, completed_games: st.games, server_side: st.server_side,
    best_of: st.best_of, doubles: st.doubles, kind: rules.kind,
  };
  if (rules.kind === "point") {
    out.points = st.points;
    if (sid === "pickleball") {
      out.server_number = st.server_number;
      out.score_call = `${st.points[st.server_side]}-${st.points[1 - st.server_side]}` + (st.doubles ? `-${st.server_number}` : "");
    }
    if (sid === "badminton") out.server_court = st.server_court;
  } else {
    if (st.tiebreak) { out.tiebreak = true; out.points_display = [String(st.tb[0]), String(st.tb[1])]; }
    else {
      out.tiebreak = false;
      const lbl = (i: number) => {
        const a = st.p[0]; const b = st.p[1];
        if (a >= 3 && b >= 3) { if (a === b) return "40"; return st.p[i] > st.p[1 - i] ? "Ad" : "40"; }
        return POINT_LABELS[st.p[i]] ?? "40";
      };
      out.points_display = [lbl(0), lbl(1)];
    }
    out.cur_games = st.cur_games;
    out.scoring_mode = st.options.padel_scoring || "advantage";
  }
  return out;
}
