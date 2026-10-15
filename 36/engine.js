/* Pure local rules. Room results use the casual relay, never wallet settlement. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TetrisBattleEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const WIDTH = 10, HEIGHT = 22, HIDDEN = 2, MAX_SCORE = 2147483647;
  const SCORE = Object.freeze({
    clear: [0, 40, 90, 160, 240],
    spinMini: [0, 10, 20], spinFull: [0, 30, 60, 80, 100],
    backToBack: 40, comboStep: 15, comboCap: 6, allClear: 120,
    dropPerCell: 1, dropCap: 20,
  });
  const TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
  const SHAPES = {
    I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    O: [[1,1],[1,1]], T: [[0,1,0],[1,1,1],[0,0,0]],
    S: [[0,1,1],[1,1,0],[0,0,0]], Z: [[1,1,0],[0,1,1],[0,0,0]],
    J: [[1,0,0],[1,1,1],[0,0,0]], L: [[0,0,1],[1,1,1],[0,0,0]],
  };
  const KICKS = {
    '0>1': [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
    '1>0': [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
    '1>2': [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
    '2>1': [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
    '2>3': [[0,0],[1,0],[1,-1],[0,2],[1,2]],
    '3>2': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
    '3>0': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
    '0>3': [[0,0],[1,0],[1,-1],[0,2],[1,2]],
  };
  const I_KICKS = {
    '0>1': [[0,0],[-2,0],[1,0],[-2,1],[1,-2]],
    '1>0': [[0,0],[2,0],[-1,0],[2,-1],[-1,2]],
    '1>2': [[0,0],[-1,0],[2,0],[-1,-2],[2,1]],
    '2>1': [[0,0],[1,0],[-2,0],[1,2],[-2,-1]],
    '2>3': [[0,0],[2,0],[-1,0],[2,-1],[-1,2]],
    '3>2': [[0,0],[-2,0],[1,0],[-2,1],[1,-2]],
    '3>0': [[0,0],[1,0],[-2,0],[1,2],[-2,-1]],
    '0>3': [[0,0],[-1,0],[2,0],[-1,-2],[2,1]],
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
  const emptyRow = () => Array(WIDTH).fill(0);
  function matrix(type, rotation = 0) {
    let shape = SHAPES[type].map(row => [...row]);
    if (type === 'O') return shape;
    for (let r = 0; r < rotation; r++) shape = shape[0].map((_, x) => shape.map(row => row[x]).reverse());
    return shape;
  }
  function cells(piece) {
    const result = [];
    matrix(piece.type, piece.rotation).forEach((row, y) => row.forEach((v, x) => {
      if (v) result.push({ x: x + piece.x, y: y + piece.y });
    }));
    return result;
  }
  class Engine {
    constructor({ seed = 1, mode = 'marathon' } = {}) {
      this.seed = seed >>> 0;
      this.rng = this.seed || 0x6d2b79f5;
      this.mode = ['marathon','sprint','battle'].includes(mode) ? mode : 'marathon';
      this.board = Array.from({ length: HEIGHT }, emptyRow);
      this.queue = []; this.active = null; this.hold = null; this.canHold = true;
      this.score = 0; this.lines = 0; this.level = 1; this.combo = -1; this.b2b = false;
      this.elapsed = 0; this.pieces = 0; this.attack = 0; this.garbage = [];
      this.fallTime = 0; this.lockTime = 0; this.lockResets = 0;
      this.lastRotation = false; this.lastKick = 0; this.status = 'playing'; this.reason = '';
      this.events = [];
      this.fillQueue(); this.spawn();
    }
    random() {
      let n = this.rng;
      n ^= n << 13; n ^= n >>> 17; n ^= n << 5;
      this.rng = n >>> 0;
      return this.rng / 4294967296;
    }
    fillQueue() {
      while (this.queue.length < 7) {
        const bag = [...TYPES];
        for (let i = bag.length - 1; i > 0; i--) {
          const j = Math.floor(this.random() * (i + 1));
          [bag[i], bag[j]] = [bag[j], bag[i]];
        }
        this.queue.push(...bag);
      }
    }
    fits(piece) {
      return cells(piece).every(({ x, y }) => x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT && !this.board[y][x]);
    }
    grounded() { return this.active && !this.fits({ ...this.active, y: this.active.y + 1 }); }
    spawn(type) {
      if (!type) { type = this.queue.shift(); this.fillQueue(); }
      this.active = { type, rotation: 0, x: type === 'O' ? 4 : 3, y: 1 };
      this.fallTime = this.lockTime = this.lockResets = 0;
      this.lastRotation = false; this.lastKick = 0;
      if (!this.fits(this.active)) this.finish('topout');
    }
    resetLock(wasGrounded) {
      if (wasGrounded && this.lockResets < 15) { this.lockTime = 0; this.lockResets++; }
    }
    addScore(delta) {
      if (!integer(delta, 0, MAX_SCORE)) throw new Error('計分增量無效');
      if (this.score > MAX_SCORE - delta) {
        this.events.push({ kind: 'scoreLimit', score: this.score, attempted: delta });
        return false;
      }
      this.score += delta;
      return true;
    }
    move(dx) {
      if (this.status !== 'playing' || ![-1,1].includes(dx)) return false;
      const wasGrounded = this.grounded(), next = { ...this.active, x: this.active.x + dx };
      if (!this.fits(next)) return false;
      this.active = next; this.lastRotation = false; this.resetLock(wasGrounded);
      return true;
    }
    rotate(direction = 1) {
      if (this.status !== 'playing' || ![-1,1].includes(direction) || this.active.type === 'O') return false;
      const p = this.active, rotation = (p.rotation + direction + 4) % 4;
      const wasGrounded = this.grounded();
      const kicks = (p.type === 'I' ? I_KICKS : KICKS)[`${p.rotation}>${rotation}`];
      for (let i = 0; i < kicks.length; i++) {
        const [dx, dy] = kicks[i], next = { ...p, rotation, x: p.x + dx, y: p.y + dy };
        if (!this.fits(next)) continue;
        this.active = next; this.lastRotation = true; this.lastKick = i; this.resetLock(wasGrounded);
        this.events.push({ kind: 'rotate' }); return true;
      }
      return false;
    }
    swapHold() {
      if (this.status !== 'playing' || !this.canHold) return false;
      const current = this.active.type, held = this.hold;
      this.hold = current; this.spawn(held); this.canHold = false;
      this.events.push({ kind: 'hold' }); return true;
    }
    drop(soft = false) {
      if (this.status !== 'playing') return false;
      const next = { ...this.active, y: this.active.y + 1 };
      if (!this.fits(next)) return false;
      this.active = next; this.lockTime = 0;
      return true;
    }
    ghost() {
      if (!this.active) return null;
      const p = { ...this.active };
      while (this.fits({ ...p, y: p.y + 1 })) p.y++;
      return p;
    }
    hardDrop() {
      if (this.status !== 'playing') return false;
      const p = this.ghost();
      const distance = p.y - this.active.y, requested = Math.min(SCORE.dropCap, distance * SCORE.dropPerCell);
      this.active = p;
      const dropEvent={kind:'drop',distance,scoreDelta:0};this.events.push(dropEvent);
      const accepted = this.addScore(requested);
      if(accepted)dropEvent.scoreDelta=requested;
      if (accepted) this.lock(); else this.finish('score-limit');
      return true;
    }
    spin() {
      if (this.active.type !== 'T' || !this.lastRotation) return null;
      const p = this.active, x = p.x + 1, y = p.y + 1;
      const blocked = (cx, cy) => cx < 0 || cx >= WIDTH || cy < 0 || cy >= HEIGHT || !!this.board[cy][cx];
      const corners = [blocked(x-1,y-1), blocked(x+1,y-1), blocked(x+1,y+1), blocked(x-1,y+1)];
      if (corners.filter(Boolean).length < 3) return null;
      const front = [[0,1],[1,2],[2,3],[3,0]][p.rotation];
      return corners[front[0]] && corners[front[1]] || this.lastKick === 4 ? 'full' : 'mini';
    }
    lock() {
      if (this.status !== 'playing') return;
      const spin = this.spin(), placed = cells(this.active);
      for (const { x, y } of placed) this.board[y][x] = TYPES.indexOf(this.active.type) + 1;
      this.pieces++; this.canHold = true;
      const cleared = [];
      for (let y = 0; y < HEIGHT; y++) if (this.board[y].every(Boolean)) cleared.push(y);
      this.board = this.board.filter((_, y) => !cleared.includes(y));
      while (this.board.length < HEIGHT) this.board.unshift(emptyRow());
      const count = cleared.length, effectiveSpin = spin === 'mini' && count >= 2 ? 'full' : spin;
      const special = count > 0 && (count === 4 || effectiveSpin);
      const backToBack = !!(special && this.b2b);
      let damage = 0, clearScore = 0, spinScore = 0, allClearScore = 0;
      if (count) {
        this.combo++;
        clearScore = SCORE.clear[count] || 0;
        spinScore = effectiveSpin === 'full' ? (SCORE.spinFull[count] || 0) : effectiveSpin === 'mini' ? (SCORE.spinMini[count] || 0) : 0;
        damage = effectiveSpin === 'full' ? [0,2,4,6][count] : effectiveSpin === 'mini' ? [0,1,2][count] : [0,0,1,2,4][count];
        if (backToBack) damage++;
        damage += Math.min(4, Math.floor(this.combo / 2));
        if (this.board.every(row => row.every(v => !v))) { damage += 10; allClearScore = SCORE.allClear; }
        this.b2b = !!special;
      } else {
        this.combo = -1;
        spinScore = spin === 'full' ? 20 : spin === 'mini' ? 10 : 0;
      }
      const backToBackScore = backToBack ? SCORE.backToBack : 0;
      const comboScore = count ? Math.min(this.combo, SCORE.comboCap) * SCORE.comboStep : 0;
      const requestedScore = clearScore + spinScore + backToBackScore + comboScore + allClearScore;
      const scoreAccepted = this.addScore(requestedScore);
      const scoreDelta = scoreAccepted ? requestedScore : 0;
      this.lines += count;
      this.level = this.mode === 'battle' ? 1 + Math.floor(this.elapsed / 30000) : 1 + Math.floor(this.lines / 10);
      const cancelled = Math.min(damage, this.pendingGarbage);
      let cancel = cancelled;
      while (cancel > 0 && this.garbage.length) {
        const packet = this.garbage[0], amount = Math.min(cancel, packet.lines);
        packet.lines -= amount; cancel -= amount;
        if (!packet.lines) this.garbage.shift();
      }
      damage -= cancelled; this.attack += damage;
      this.events.push({ kind: 'lock', count, rows: cleared, spin: effectiveSpin, combo: this.combo, backToBack, damage, cancelled,
        scoreDelta, scoreRequested: requestedScore,
        scoreBreakdown: { clear: scoreAccepted ? clearScore : 0, spin: scoreAccepted ? spinScore : 0,
          backToBack: scoreAccepted ? backToBackScore : 0, combo: scoreAccepted ? comboScore : 0,
          allClear: scoreAccepted ? allClearScore : 0, total: scoreDelta } });
      if (!scoreAccepted) { this.finish('score-limit'); return; }
      if (this.mode === 'sprint' && this.lines >= 40 || this.mode === 'marathon' && this.lines >= 150) {
        this.finish('complete'); return;
      }
      if (placed.every(cell => cell.y < HIDDEN)) { this.finish('topout'); return; }
      // Garbage arrives only after locking a piece, giving the player time to cancel it.
      if (!count) this.applyGarbage();
      if (this.status === 'playing') this.spawn();
    }
    get pendingGarbage() { return this.garbage.reduce((n, packet) => n + packet.lines, 0); }
    receiveGarbage(lines, hole) {
      if (this.status !== 'playing' || !integer(lines,1,20) || !integer(hole,0,9)) return false;
      const room = 40 - this.pendingGarbage;
      if (room <= 0) return false;
      this.garbage.push({ lines: Math.min(lines,room), hole, due: this.elapsed + 1200 });
      this.events.push({ kind: 'incoming', lines: Math.min(lines,room) }); return true;
    }
    applyGarbage() {
      let applied = 0;
      while (this.garbage.length && this.garbage[0].due <= this.elapsed && applied < 12) {
        const packet = this.garbage[0];
        if (this.board[0].some(Boolean)) { this.finish('garbage'); return; }
        this.board.shift();
        this.board.push(Array.from({ length: WIDTH }, (_, x) => x === packet.hole ? 0 : 8));
        packet.lines--; applied++;
        if (!packet.lines) this.garbage.shift();
      }
      if (applied) this.events.push({ kind: 'garbage', lines: applied });
    }
    advance(ms, soft = false) {
      if (!Number.isFinite(ms) || ms < 0 || this.status !== 'playing') return;
      let left = Math.min(ms, 10000);
      while (left > 0 && this.status === 'playing') {
        const dt = Math.min(25, left); left -= dt; this.elapsed += dt;
        if (this.mode === 'battle') this.level = 1 + Math.floor(this.elapsed / 30000);
        const gravity = Math.max(65, 850 * Math.pow(0.8, this.level - 1));
        this.fallTime += dt;
        const interval = soft ? Math.min(35, gravity) : gravity;
        while (this.fallTime >= interval) { this.fallTime -= interval; if (!this.drop(soft)) break; }
        if (this.grounded()) { this.lockTime += dt; if (this.lockTime >= 500) this.lock(); }
        else this.lockTime = 0;
      }
    }
    finish(reason) {
      if (this.status !== 'playing') return;
      this.status = reason === 'complete' ? 'complete' : 'over'; this.reason = reason;
      this.events.push({ kind: 'over', reason });
    }
    drainEvents() { const events = this.events; this.events = []; return events; }
    view() {
      return { board: clone(this.board), active: clone(this.active), hold: this.hold,
        next: this.queue.slice(0,5), score: this.score, lines: this.lines, level: this.level,
        attack: this.attack, pieces: this.pieces, pending: this.pendingGarbage, status: this.status };
    }
    save() {
      const out = {};
      for (const key of Object.keys(this)) if (key !== 'events') out[key] = clone(this[key]);
      return out;
    }
    static restore(save) {
      if (!save || !validView({ ...save, next: save.queue?.slice(0,5), pending: 0 }) ||
          !integer(save.rng,0,4294967295) || !integer(save.seed,0,4294967295) ||
          !Array.isArray(save.queue) || save.queue.length < 5 || save.queue.length > 14 || save.queue.some(t => !TYPES.includes(t)) ||
          !Array.isArray(save.garbage) || save.garbage.length > 40 ||
          save.garbage.some(p => !integer(p.lines,1,40) || !integer(p.hole,0,9) || !Number.isFinite(p.due)) ||
          !['marathon','sprint','battle'].includes(save.mode) || typeof save.canHold !== 'boolean' ||
          typeof save.b2b !== 'boolean' || typeof save.lastRotation !== 'boolean' ||
          !integer(save.combo,-1,10000) || !integer(save.lockResets,0,15) || !integer(save.lastKick,0,4) ||
          ['elapsed','fallTime','lockTime'].some(k => !Number.isFinite(save[k]) || save[k] < 0 || save[k] > 86400000)) return null;
      const engine = new Engine({ seed: save.seed, mode: save.mode });
      for (const key of Object.keys(engine)) if (key !== 'events' && Object.hasOwn(save,key)) engine[key] = clone(save[key]);
      engine.events = [];
      return engine.status !== 'playing' || engine.fits(engine.active) ? engine : null;
    }
  }
  function validView(v) {
    return !!v && Array.isArray(v.board) && v.board.length === HEIGHT &&
      v.board.every(row => Array.isArray(row) && row.length === WIDTH && row.every(n => integer(n,0,8))) &&
      !!v.active && TYPES.includes(v.active.type) && integer(v.active.rotation,0,3) &&
      integer(v.active.x,-3,9) && integer(v.active.y,0,21) &&
      Array.isArray(v.next) && v.next.length === 5 && v.next.every(t => TYPES.includes(t)) &&
      (v.hold === null || TYPES.includes(v.hold)) && ['playing','complete','over'].includes(v.status) &&
      ['score','lines','level','attack','pieces','pending'].every(k => integer(v[k],0,k === 'score' ? MAX_SCORE : k === 'pending' ? 40 : 100000000));
  }
  return { Engine, WIDTH, HEIGHT, HIDDEN, MAX_SCORE, SCORE, TYPES, matrix, cells, validView };
});
