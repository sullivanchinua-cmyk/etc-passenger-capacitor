// ETC Chess – legal moves + lightweight AI (non-blocking)
(function (global) {
  // Filled glyphs for both; CSS .pc.w / .pc.b sets color
  const PIECES = { K:"♚", Q:"♛", R:"♜", B:"♝", N:"♞", P:"♟", k:"♚", q:"♛", r:"♜", b:"♝", n:"♞", p:"♟" };
  const VAL = { p:100, n:320, b:330, r:500, q:900, k:20000 };

  function isWhite(p) { return !!p && p === p.toUpperCase(); }
  function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

  function findKing(board, white) {
    const k = white ? "K" : "k";
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if (board[r][c] === k) return [r, c];
    return null;
  }

  function attacked(board, r, c, byWhite) {
    // pawns
    const pr = byWhite ? r + 1 : r - 1;
    for (const dc of [-1, 1]) {
      if (inBounds(pr, c + dc)) {
        const p = board[pr][c + dc];
        if (p && (byWhite ? p === "P" : p === "p")) return true;
      }
    }
    // knights
    for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
      const nr = r + dr, nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const p = board[nr][nc];
      if (p && (byWhite ? p === "N" : p === "n")) return true;
    }
    // king
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = r + dr, nc = c + dc;
        if (!inBounds(nr, nc)) continue;
        const p = board[nr][nc];
        if (p && (byWhite ? p === "K" : p === "k")) return true;
      }
    // sliders
    const rays = [
      [[-1,0],[1,0],[0,-1],[0,1], "r"],
      [[-1,-1],[-1,1],[1,-1],[1,1], "b"]
    ];
    for (const group of rays) {
      const type = group[4];
      for (let i = 0; i < 4; i++) {
        const [dr, dc] = group[i];
        let nr = r + dr, nc = c + dc;
        while (inBounds(nr, nc)) {
          const p = board[nr][nc];
          if (p) {
            if (isWhite(p) === byWhite) {
              const lo = p.toLowerCase();
              if (lo === "q" || lo === type) return true;
            }
            break;
          }
          nr += dr; nc += dc;
        }
      }
    }
    return false;
  }

  function inCheck(board, white) {
    const k = findKing(board, white);
    if (!k) return true;
    return attacked(board, k[0], k[1], !white);
  }

  function genPseudo(board, r, c, turn, castle, ep) {
    const p = board[r][c];
    if (!p) return [];
    const white = isWhite(p);
    if ((turn === "w") !== white) return [];
    const out = [];
    const lo = p.toLowerCase();
    const enemy = (tr, tc) => { const t = board[tr][tc]; return t && isWhite(t) !== white; };
    const empty = (tr, tc) => !board[tr][tc];

    if (lo === "p") {
      const dir = white ? -1 : 1;
      const start = white ? 6 : 1;
      const promoRank = white ? 0 : 7;
      if (inBounds(r + dir, c) && empty(r + dir, c)) {
        out.push([r + dir, c, r + dir === promoRank ? "q" : null, null]);
        if (r === start && empty(r + 2 * dir, c))
          out.push([r + 2 * dir, c, null, null]);
      }
      for (const dc of [-1, 1]) {
        const nr = r + dir, nc = c + dc;
        if (!inBounds(nr, nc)) continue;
        if (enemy(nr, nc)) out.push([nr, nc, nr === promoRank ? "q" : null, null]);
        if (ep && ep[0] === nr && ep[1] === nc) out.push([nr, nc, null, "ep"]);
      }
    } else if (lo === "n") {
      for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
        const nr = r + dr, nc = c + dc;
        if (inBounds(nr, nc) && (empty(nr, nc) || enemy(nr, nc)))
          out.push([nr, nc, null, null]);
      }
    } else if (lo === "b" || lo === "r" || lo === "q") {
      const dirs = [];
      if (lo !== "b") dirs.push([-1,0],[1,0],[0,-1],[0,1]);
      if (lo !== "r") dirs.push([-1,-1],[-1,1],[1,-1],[1,1]);
      for (const [dr, dc] of dirs) {
        let nr = r + dr, nc = c + dc;
        while (inBounds(nr, nc)) {
          if (empty(nr, nc)) out.push([nr, nc, null, null]);
          else { if (enemy(nr, nc)) out.push([nr, nc, null, null]); break; }
          nr += dr; nc += dc;
        }
      }
    } else if (lo === "k") {
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nr = r + dr, nc = c + dc;
          if (inBounds(nr, nc) && (empty(nr, nc) || enemy(nr, nc)))
            out.push([nr, nc, null, null]);
        }
      if (white && r === 7 && c === 4) {
        if (castle.wk && empty(7,5) && empty(7,6) && board[7][7] === "R")
          out.push([7, 6, null, "castle-k"]);
        if (castle.wq && empty(7,3) && empty(7,2) && empty(7,1) && board[7][0] === "R")
          out.push([7, 2, null, "castle-q"]);
      }
      if (!white && r === 0 && c === 4) {
        if (castle.bk && empty(0,5) && empty(0,6) && board[0][7] === "r")
          out.push([0, 6, null, "castle-k"]);
        if (castle.bq && empty(0,3) && empty(0,2) && empty(0,1) && board[0][0] === "r")
          out.push([0, 2, null, "castle-q"]);
      }
    }
    return out;
  }

  function applyMove(state, r, c, tr, tc, promo, special) {
    const board = state.board.map(row => row.slice());
    const castle = { wk: state.castle.wk, wq: state.castle.wq, bk: state.castle.bk, bq: state.castle.bq };
    let ep = null;
    const piece = board[r][c];

    if (special === "ep") {
      board[tr][tc] = piece; board[r][c] = null; board[r][tc] = null;
    } else if (special === "castle-k") {
      board[tr][tc] = piece; board[r][c] = null;
      board[r][5] = board[r][7]; board[r][7] = null;
    } else if (special === "castle-q") {
      board[tr][tc] = piece; board[r][c] = null;
      board[r][3] = board[r][0]; board[r][0] = null;
    } else {
      board[tr][tc] = promo
        ? (isWhite(piece) ? promo.toUpperCase() : promo.toLowerCase())
        : piece;
      board[r][c] = null;
    }

    if (piece === "K") { castle.wk = false; castle.wq = false; }
    if (piece === "k") { castle.bk = false; castle.bq = false; }
    if (piece === "R" && r === 7 && c === 0) castle.wq = false;
    if (piece === "R" && r === 7 && c === 7) castle.wk = false;
    if (piece === "r" && r === 0 && c === 0) castle.bq = false;
    if (piece === "r" && r === 0 && c === 7) castle.bk = false;
    if (tr === 7 && tc === 0) castle.wq = false;
    if (tr === 7 && tc === 7) castle.wk = false;
    if (tr === 0 && tc === 0) castle.bq = false;
    if (tr === 0 && tc === 7) castle.bk = false;

    if (piece && piece.toLowerCase() === "p" && Math.abs(tr - r) === 2)
      ep = [(r + tr) / 2, c];

    return {
      board,
      turn: state.turn === "w" ? "b" : "w",
      castle,
      ep
    };
  }

  function legalMoves(state, r, c) {
    const { board, turn, castle, ep } = state;
    const pseudo = genPseudo(board, r, c, turn, castle, ep);
    const white = turn === "w";
    const legal = [];
    for (const m of pseudo) {
      const [tr, tc, promo, special] = m;
      if (special === "castle-k" || special === "castle-q") {
        const path = special === "castle-k" ? [c, c + 1, c + 2] : [c, c - 1, c - 2];
        let blocked = false;
        for (const col of path) {
          if (attacked(board, r, col, !white)) { blocked = true; break; }
        }
        if (blocked) continue;
      }
      const next = applyMove(state, r, c, tr, tc, promo, special);
      if (!inCheck(next.board, white))
        legal.push({ r: r, c: c, tr: tr, tc: tc, promo: promo, special: special });
    }
    return legal;
  }

  function allLegal(state) {
    const moves = [];
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const p = state.board[r][c];
        if (!p) continue;
        if ((state.turn === "w") !== isWhite(p)) continue;
        const lm = legalMoves(state, r, c);
        for (let i = 0; i < lm.length; i++) moves.push(lm[i]);
      }
    return moves;
  }

  function evaluate(board) {
    let score = 0;
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (!p) continue;
        const lo = p.toLowerCase();
        const v = VAL[lo] || 0;
        // center bonus
        const center = (r >= 2 && r <= 5 && c >= 2 && c <= 5) ? 10 : 0;
        score += isWhite(p) ? (v + center) : -(v + center);
      }
    return score;
  }

  // depth 1 or 2 only – keeps UI smooth on mobile
  function minimax(state, depth, alpha, beta, maximizing) {
    if (depth <= 0) return { score: evaluate(state.board), move: null };
    const moves = allLegal(state);
    if (!moves.length) {
      const white = state.turn === "w";
      if (inCheck(state.board, white))
        return { score: maximizing ? -50000 - depth : 50000 + depth, move: null };
      return { score: 0, move: null };
    }
    // captures first
    moves.sort(function (a, b) {
      const ca = state.board[a.tr][a.tc] ? 1 : 0;
      const cb = state.board[b.tr][b.tc] ? 1 : 0;
      return cb - ca;
    });
    let best = moves[0];
    if (maximizing) {
      let maxS = -Infinity;
      for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        const next = applyMove(state, m.r, m.c, m.tr, m.tc, m.promo, m.special);
        const res = minimax(next, depth - 1, alpha, beta, false);
        if (res.score > maxS) { maxS = res.score; best = m; }
        alpha = Math.max(alpha, res.score);
        if (beta <= alpha) break;
      }
      return { score: maxS, move: best };
    } else {
      let minS = Infinity;
      for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        const next = applyMove(state, m.r, m.c, m.tr, m.tc, m.promo, m.special);
        const res = minimax(next, depth - 1, alpha, beta, true);
        if (res.score < minS) { minS = res.score; best = m; }
        beta = Math.min(beta, res.score);
        if (beta <= alpha) break;
      }
      return { score: minS, move: best };
    }
  }

  // Smart-but-fast AI: material + captures + checks, no deep search freeze
  function pickAIMove(state, level) {
    const moves = allLegal(state);
    if (!moves.length) return null;
    if (level <= 1) {
      // Easy: prefer captures, else random
      const caps = moves.filter(function (m) { return !!state.board[m.tr][m.tc]; });
      const pool = caps.length ? caps : moves;
      return pool[Math.floor(Math.random() * pool.length)];
    }
    // Medium/Hard: shallow minimax
    const depth = level >= 3 ? 2 : 1;
    const res = minimax(state, depth, -Infinity, Infinity, state.turn === "w");
    return res.move || moves[0];
  }

  function startPosition() {
    return {
      board: [
        ["r","n","b","q","k","b","n","r"],
        ["p","p","p","p","p","p","p","p"],
        [null,null,null,null,null,null,null,null],
        [null,null,null,null,null,null,null,null],
        [null,null,null,null,null,null,null,null],
        [null,null,null,null,null,null,null,null],
        ["P","P","P","P","P","P","P","P"],
        ["R","N","B","Q","K","B","N","R"]
      ],
      turn: "w",
      castle: { wk: true, wq: true, bk: true, bq: true },
      ep: null
    };
  }

  global.ETCChess = {
    PIECES: PIECES,
    isWhite: isWhite,
    inCheck: inCheck,
    legalMoves: legalMoves,
    allLegal: allLegal,
    applyMove: applyMove,
    minimax: minimax,
    pickAIMove: pickAIMove,
    startPosition: startPosition,
    findKing: findKing
  };
})(typeof window !== "undefined" ? window : globalThis);
