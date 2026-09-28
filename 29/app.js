const canvas = document.querySelector("#arena");
const ctx = canvas.getContext("2d");
const clockEl = document.querySelector("#clock");
const leaderEl = document.querySelector("#leader");
const calloutEl = document.querySelector("#callout");
const toastEl = document.querySelector("#toast");
const joystickEl = document.querySelector("#joystick");
const knobEl = document.querySelector("#knob");
const passButton = document.querySelector("#pass");
const lifeStrip = document.querySelector("#life-strip");
const hintEl = document.querySelector("#hint");
const miniScoreEl = document.querySelector("#mini-score");

const ROUND_SECONDS = 45;
const PALETTES = ["#ff648e", "#65d7ff", "#ffcc58", "#a992ff", "#65e0b1", "#ff8d53", "#f477e2", "#b9e66c", "#73a3ff", "#ffadca"];
const TAU = Math.PI * 2;
const params = new URLSearchParams(location.search);

const State = Object.freeze({ LOADING: "LOADING", COUNTDOWN: "COUNTDOWN", PLAYING: "PLAYING", RESULT: "RESULT", EXIT: "EXIT" });
let GAME_STATE = State.LOADING;
let sdk = window.BoomRoomSDK || null;
const hasRealSDK = Boolean(sdk);
let mockEvents = [];
let gameOverCalled = false;
let resultTimer = 0;
let elapsed = 0;
let countdown = 3;
let remaining = ROUND_SECONDS;
let lastFrame = performance.now();
let lastNetworkSend = 0;
let lastSecondSync = 0;
let lastHudRefresh = 0;
let goldenNext = false;
let audioUnlocked = false;
let ambientAudio = null;
const soundFiles = {
  pass: new Audio("./sfx/pass.wav"),
  explosion: new Audio("./sfx/explosion.wav"),
  score: new Audio("./sfx/score.wav"),
  ambience: new Audio("./sfx/arena-bed.wav")
};
soundFiles.ambience.loop = true;
soundFiles.ambience.volume = .18;
soundFiles.pass.volume = .5;
soundFiles.explosion.volume = .68;
soundFiles.score.volume = .42;

const localUser = { id: "local-player", username: "你" };
let localId = localUser.id;
let players = [];
let bomb = { holderId: null, fuse: 6.8, x: 0, y: 0, trail: null, lastPasser: null, bumpLock: 0 };
let arena = { w: 1, h: 1, dpr: 1, inset: 40 };
let particles = [];
let floatingTexts = [];
let screenShake = 0;
let joystick = { x: 0, y: 0, pointerId: null };
let keys = new Set();
let touchActionDown = false;
let aiDecisionTimer = 0;
let winnerId = null;

function makeMockSDK() {
  const mockId = Math.max(1, Math.min(10, Number(params.get("players")) || 4));
  const roomPlayers = Array.from({ length: mockId }, (_, i) => ({
    id: i === 0 ? localUser.id : `mock-${i + 1}`,
    userId: i === 0 ? localUser.id : `mock-${i + 1}`,
    username: i === 0 ? "你" : `玩家${i + 1}`,
    isBot: i > 0
  }));
  return {
    isHost: true,
    roomId: "mock-room",
    roomPlayers,
    getUser: async () => localUser,
    requestPurchase: async (itemId, cost) => ({ success: true, itemId, cost }),
    gameOver: async (winAmount) => console.info("[Mock BoomRoom] gameOver", { winAmount }),
    sendGameEvent: (eventName, payload) => {
      mockEvents.push({ eventName, payload, timestamp: Date.now() });
      if (mockEvents.length > 80) mockEvents.shift();
    },
    events: mockEvents,
    emitGameEvent: (eventName, payload = {}) => window.dispatchEvent(new CustomEvent("gameEventReceived", { detail: { eventName, payload } }))
  };
}

if (!sdk) sdk = makeMockSDK();
const isMock = !hasRealSDK;
if (isMock) window.BoomRoomSDK = sdk;
const isHost = Boolean(sdk.isHost);

window.initBoomRoomSDK = function(data) {
  if (data) {
    if (data.user) {
      localUser.id = String(data.user.id || localUser.id);
      localUser.username = data.user.username || localUser.username;
      localId = localUser.id;
    }
    if (data.roomPlayers && Array.isArray(data.roomPlayers)) {
      sdk.roomPlayers = data.roomPlayers;
    }
    sdk.isHost = !!data.isHost;
    sdk.roomId = data.roomId || '';
    init();
  }
};

window.onBoomRoomSDKReady = function() {
  if (window.BoomRoomSDK) {
    window.initBoomRoomSDK({
      user: typeof window.BoomRoomSDK.getUser === 'function' ? window.BoomRoomSDK.getUser() : {},
      isHost: window.BoomRoomSDK.isHost,
      roomId: window.BoomRoomSDK.roomId,
      roomPlayers: window.BoomRoomSDK.roomPlayers || []
    });
  }
};

if (window.BoomRoomSDK) {
  window.onBoomRoomSDKReady();
}

async function init() {
  try {
    const user = await sdk.getUser?.();
    if (user?.id || user?.userId) {
      localUser.id = String(user.id ?? user.userId);
      localUser.username = user.username || user.displayName || "你";
      localId = localUser.id;
    }
  } catch { /* SDK identity can be unavailable in preview. */ }

  const roomPlayers = Array.isArray(sdk.roomPlayers) ? sdk.roomPlayers : [];
  if (roomPlayers.length) {
    const normalized = roomPlayers.slice(0, 10).map((p, i) => {
      const id = String(p.id ?? p.userId ?? p.user_id ?? p.uid ?? `room-${i + 1}`);
      const isLocal = id === localId || p.isLocal === true || p.isMe === true;
      return {
        id: isLocal ? localId : id,
        name: isLocal ? "你" : (p.username ?? p.name ?? p.displayName ?? `玩家${i + 1}`),
        color: PALETTES[i % PALETTES.length],
        isLocal,
        isBot: Boolean(p.isBot),
        x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0, knockX: 0, knockY: 0, lastMoveAt: 0,
        score: 0, hearts: 2, alive: true, angle: -Math.PI / 2, walk: 0, stun: 0,
        dash: 0, flash: 0, wins: 0, aimX: 0, aimY: 0
      };
    });
    if (!normalized.some(p => p.isLocal)) {
      normalized.unshift(createPlayer(localId, localUser.username, true, false, normalized.length));
      if (normalized.length > 10) normalized.pop();
    }
    players = normalized;
    const humans = players.filter(p => !p.isLocal && !p.isBot).length;
    if (humans === 0 && (isMock ? players.length === 1 : true)) addSoloBots();
  } else {
    players = [createPlayer(localId, localUser.username, true, false, 0)];
    const count = Math.max(1, Math.min(10, Number(params.get("players")) || 4));
    for (let i = 1; i < count; i++) players.push(createPlayer(`mock-${i + 1}`, `玩家${i + 1}`, false, true, i));
    if (count === 1) addSoloBots();
  }

  layoutPlayers();
  bindNetwork();
  buildLives();
  setTimeout(() => beginCountdown(), 250);
  requestAnimationFrame(frame);
}

function createPlayer(id, name, isLocal, isBot, index) {
  return {
    id, name, isLocal, isBot,
    color: PALETTES[index % PALETTES.length],
    x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0, knockX: 0, knockY: 0, lastMoveAt: 0,
    score: 0, hearts: 2, alive: true, angle: -Math.PI / 2, walk: 0, stun: 0,
    dash: 0, flash: 0, wins: 0, aimX: 0, aimY: 0
  };
}

function addSoloBots() {
  const botNames = ["豆豆", "阿爆", "麻糬"];
  for (let i = 0; i < botNames.length && players.length < 10; i++) {
    players.push(createPlayer(`npc-${i + 1}`, botNames[i], false, true, players.length));
  }
}

function layoutPlayers() {
  const cx = arena.w / 2;
  const cy = arena.h / 2;
  const radius = Math.max(55, Math.min(arena.w, arena.h) * .31);
  players.forEach((p, i) => {
    const angle = -Math.PI / 2 + i * TAU / players.length;
    if (p.x === 0 && p.y === 0) {
      p.x = p.tx = cx + Math.cos(angle) * radius;
      p.y = p.ty = cy + Math.sin(angle) * radius;
    }
  });
}

function beginCountdown() {
  if (GAME_STATE !== State.LOADING) return;
  GAME_STATE = State.COUNTDOWN;
  countdown = 3;
  showCallout("3");
  playSound("score");
}

function bindNetwork() {
  const receive = (event) => {
    const data = event?.detail ?? event?.data ?? event;
    const eventName = data?.eventName ?? data?.name ?? data?.type;
    const payload = data?.payload ?? data?.data ?? {};
    if (typeof eventName === "string") onNetworkEvent(eventName, payload);
  };
  window.addEventListener("gameEventReceived", receive);
  window.addEventListener("message", (event) => {
    if (event.data?.type === "gameEventReceived") receive({ data: event.data });
  });
  if (typeof sdk.addEventListener === "function") {
    try { sdk.addEventListener("gameEventReceived", receive); } catch { /* Some SDK versions use window events. */ }
  }
}

function sendEvent(eventName, payload = {}) {
  try { sdk.sendGameEvent?.(eventName, { ...payload, roomId: sdk.roomId ?? null, senderId: localId, at: Date.now() }); }
  catch (error) { console.warn("BoomRoom event send failed", error); }
}

function onNetworkEvent(name, payload) {
  if (!payload || payload.senderId === localId) return;
  switch (name) {
    case "PLAYER_MOVE": {
      const p = findPlayer(payload.userId ?? payload.playerId);
      if (!p || p.isLocal) return;
      if (Number.isFinite(payload.x) && Number.isFinite(payload.y)) {
        let nx = payload.normalized ? payload.x : payload.x / arena.w;
        let ny = payload.normalized ? payload.y : payload.y / arena.h;
        if (isHost) {
          const now = Date.now();
          const dt = p.lastMoveAt ? clamp((now - p.lastMoveAt) / 1000, .05, .25) : .15;
          let dx = nx - p.tx / arena.w;
          let dy = ny - p.ty / arena.h;
          const distance = Math.hypot(dx, dy);
          const maxDistance = dt * .62 + .018;
          if (distance > maxDistance) {
            dx *= maxDistance / distance;
            dy *= maxDistance / distance;
            nx = p.tx / arena.w + dx;
            ny = p.ty / arena.h + dy;
          }
          p.lastMoveAt = now;
        }
        const x = nx * arena.w;
        const y = ny * arena.h;
        p.tx = clamp(x, 20, arena.w - 20);
        p.ty = clamp(y, 20, arena.h - 20);
        if (Number.isFinite(payload.rotation)) p.angle = payload.rotation;
      }
      break;
    }
    case "PLAYER_ACTION":
      if (isHost && GAME_STATE === State.PLAYING) {
        const p = findPlayer(payload.userId ?? payload.playerId);
        if (p) passBomb(p, true);
      }
      break;
    case "ROUND_START":
      if (Array.isArray(payload.players)) {
        payload.players.forEach(item => {
          const p = findPlayer(item.id);
          if (p) {
            const x = payload.normalized ? item.x * arena.w : item.x;
            const y = payload.normalized ? item.y * arena.h : item.y;
            p.x = p.tx = x; p.y = p.ty = y;
            p.score = item.score || 0; p.hearts = item.hearts ?? 2; p.alive = item.alive !== false;
          }
        });
      }
      if (payload.holderId) { bomb.holderId = payload.holderId; bomb.fuse = payload.fuse ?? 6.8; }
      break;
    case "BOMB_PASS":
      applyPass(payload);
      break;
    case "BOMB_EXPLODE":
      applyExplosion(payload, false);
      bomb.holderId = payload.nextHolderId ?? null;
      bomb.fuse = Number(payload.nextFuse) || 6.8;
      bomb.lastPasser = null;
      break;
    case "ROUND_STATE":
      if (Number.isFinite(payload.remaining)) remaining = payload.remaining;
      if (payload.players) {
        payload.players.forEach(item => {
          const p = findPlayer(item.id);
          if (p && !p.isLocal) {
            p.score = item.score ?? p.score;
            p.hearts = item.hearts ?? p.hearts;
            p.alive = item.alive !== false;
          }
        });
      }
      break;
    case "PLAYER_JOIN": {
      const id = String(payload.userId ?? payload.playerId ?? payload.id ?? "");
      if (!id || findPlayer(id) || players.length >= 10) break;
      const p = createPlayer(id, payload.username ?? payload.name ?? `玩家${players.length + 1}`, false, false, players.length);
      p.x = p.tx = arena.w / 2 + (Math.random() - .5) * 70;
      p.y = p.ty = arena.h / 2 + (Math.random() - .5) * 70;
      players.push(p);
      showToast(`${p.name} 加入競技場！`);
      break;
    }
    case "ROUND_END":
      if (Array.isArray(payload.ranking)) payload.ranking.forEach(item => {
        const p = findPlayer(item.id);
        if (p && Number.isFinite(item.score)) p.score = item.score;
      });
      finishRound(payload.winnerId ?? null, false);
      break;
    case "PLAYER_LEFT": {
      const p = findPlayer(payload.userId ?? payload.playerId);
      if (p && !p.isLocal) { p.alive = false; p.disconnected = true; }
      break;
    }
  }
}

function findPlayer(id) { return players.find(p => p.id === String(id)); }

function startRound() {
  GAME_STATE = State.PLAYING;
  remaining = ROUND_SECONDS;
  elapsed = 0;
  const candidates = players.filter(p => p.alive);
  const holder = candidates[Math.floor(Math.random() * candidates.length)];
  bomb.holderId = holder?.id ?? localId;
  bomb.fuse = 6.8;
  bomb.lastPasser = null;
  showCallout("開始！", true);
  showToast("炸彈快爆時，把它傳給最近的人！");
  playSound("score");
  if (isHost) sendEvent("ROUND_START", {
    holderId: bomb.holderId, fuse: bomb.fuse,
    normalized: true,
    players: players.map(p => ({ id: p.id, x: p.x / arena.w, y: p.y / arena.h, score: p.score, hearts: p.hearts, alive: p.alive }))
  });
}

function frame(now) {
  const dt = Math.min(.04, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (GAME_STATE === State.COUNTDOWN) {
    elapsed += dt;
    const left = 3 - elapsed;
    const n = Math.ceil(left);
    if (n !== countdown && n > 0) { countdown = n; showCallout(String(n)); playSound("score"); }
    if (left <= 0) startRound();
  } else if (GAME_STATE === State.PLAYING) {
    updateGame(dt);
  }
  updateEffects(dt);
  render();
  requestAnimationFrame(frame);
}

function updateGame(dt) {
  elapsed += dt;
  remaining = Math.max(0, ROUND_SECONDS - elapsed);
  const local = players.find(p => p.isLocal);
  for (const p of players) {
    if (!p.alive || p.disconnected) continue;
    if (p.isLocal) updateHuman(p, dt);
    else if (p.isBot && (isMock || isHost)) updateBot(p, dt);
    else {
      const blend = Math.min(1, dt * 10);
      p.x += (p.tx - p.x) * blend;
      p.y += (p.ty - p.y) * blend;
    }
    p.x = clamp(p.x, arena.inset, arena.w - arena.inset);
    p.y = clamp(p.y, arena.inset, arena.h - arena.inset);
    p.stun = Math.max(0, p.stun - dt);
    p.flash = Math.max(0, p.flash - dt);
  }
  bumpPlayers();
  if (isHost || isMock) {
    bomb.fuse -= dt;
    const holder = findPlayer(bomb.holderId);
    if (!holder?.alive && players.some(p => p.alive)) {
      const next = players.filter(p => p.alive).sort((a, b) => distance(holder || { x: 0, y: 0 }, a) - distance(holder || { x: 0, y: 0 }, b))[0];
      bomb.holderId = next?.id ?? null;
      bomb.fuse = 5.5;
    }
    if (bomb.fuse <= 0 && holder) explode(holder);
    if (remaining <= 0) endByScore();
  }

  if (isHost && nowMs() - lastSecondSync > 1000) {
    lastSecondSync = nowMs();
    sendEvent("ROUND_STATE", {
      remaining,
      players: players.map(p => ({ id: p.id, score: p.score, hearts: p.hearts, alive: p.alive }))
    });
  }
  bomb.bumpLock = Math.max(0, bomb.bumpLock - dt);

  const alive = players.filter(p => p.alive);
  if (isHost && alive.length <= 1 && players.length > 1 && elapsed > 8) {
    finishRound(alive[0]?.id ?? null, true);
  }
  if (local && nowMs() - lastNetworkSend > 90 && !isMock) {
    lastNetworkSend = nowMs();
    sendEvent("PLAYER_MOVE", { userId: localId, x: local.x / arena.w, y: local.y / arena.h, normalized: true, rotation: local.angle, action: "move" });
  }
  if (nowMs() - lastHudRefresh > 180) {
    lastHudRefresh = nowMs();
    updateHud();
  }
}

function updateHuman(p, dt) {
  let dx = joystick.x + (keys.has("ArrowRight") || keys.has("d") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("a") ? 1 : 0);
  let dy = joystick.y + (keys.has("ArrowDown") || keys.has("s") ? 1 : 0) - (keys.has("ArrowUp") || keys.has("w") ? 1 : 0);
  const mag = Math.hypot(dx, dy);
  if (mag > 1) { dx /= mag; dy /= mag; }
  const speed = p.stun > 0 ? 0 : 182;
  p.vx = dx * speed;
  p.vy = dy * speed;
  p.x += (p.vx + p.knockX) * dt;
  p.y += (p.vy + p.knockY) * dt;
  p.knockX *= Math.pow(.025, dt);
  p.knockY *= Math.pow(.025, dt);
  if (mag > .12) { p.angle = Math.atan2(dy, dx); p.walk += dt * 13; }
  if (touchActionDown && p.id === bomb.holderId) passButton.classList.add("is-carrier");
}

function updateBot(p, dt) {
  const others = players.filter(q => q.id !== p.id && q.alive && !q.disconnected);
  if (!others.length) return;
  const isHolder = bomb.holderId === p.id;
  const target = isHolder
    ? nearest(p, others)
    : (findPlayer(bomb.holderId) || nearest(p, others));
  if (!target) return;
  aiDecisionTimer -= dt;
  let dx = target.x - p.x;
  let dy = target.y - p.y;
  let d = Math.hypot(dx, dy) || 1;
  if (isHolder) {
    dx = -dx; dy = -dy;
    if (d < 165) { dx += (p.x - arena.w / 2) * .014; dy += (p.y - arena.h / 2) * .014; }
  }
  const mag = Math.hypot(dx, dy) || 1;
  dx /= mag; dy /= mag;
  p.vx = dx * 104;
  p.vy = dy * 104;
  p.x += (p.vx + p.knockX) * dt;
  p.y += (p.vy + p.knockY) * dt;
  p.knockX *= Math.pow(.025, dt);
  p.knockY *= Math.pow(.025, dt);
  p.angle = Math.atan2(p.vy, p.vx);
  p.walk += dt * 9;
  if (isHolder && d < 245 && aiDecisionTimer <= 0) {
    passBomb(p, false);
    aiDecisionTimer = 1.1 + Math.random() * .9;
  }
}

function bumpPlayers() {
  for (let i = 0; i < players.length; i++) {
    const a = players[i];
    if (!a.alive || a.disconnected) continue;
    for (let j = i + 1; j < players.length; j++) {
      const b = players[j];
      if (!b.alive || b.disconnected) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || .001;
      const min = 31;
      if (d < min) {
        const push = (min - d) * .5;
        a.x -= dx / d * push; a.y -= dy / d * push;
        b.x += dx / d * push; b.y += dy / d * push;
        if ((isHost || isMock) && bomb.bumpLock <= 0) {
          const holder = bomb.holderId === a.id ? a : bomb.holderId === b.id ? b : null;
          if (holder && d < 25 && holder.stun <= 0) {
            bomb.bumpLock = .34;
            passBomb(holder, true);
          }
        }
      }
    }
  }
}

function passBomb(p, authoritative) {
  if (GAME_STATE !== State.PLAYING || p.id !== bomb.holderId || !p.alive) return;
  const targets = players.filter(q => q.id !== p.id && q.alive && !q.disconnected);
  const target = nearest(p, targets);
  if (!target || distance(p, target) > Math.min(arena.w, arena.h) * .78) {
    if (p.isLocal) showToast("靠近一點再傳！");
    return;
  }
  if (!isHost && !isMock) {
    sendEvent("PLAYER_ACTION", { userId: p.id, action: "pass" });
    return;
  }
  const payload = { fromId: p.id, toId: target.id, fromX: p.x, fromY: p.y, toX: target.x, toY: target.y, fuse: Math.min(7.6, 6.5 + (remaining < 10 ? .3 : 0)) };
  applyPass(payload);
  sendEvent("BOMB_PASS", {
    ...payload, normalized: true,
    fromX: payload.fromX / arena.w, fromY: payload.fromY / arena.h,
    toX: payload.toX / arena.w, toY: payload.toY / arena.h
  });
}

function applyPass(payload) {
  const from = findPlayer(payload.fromId);
  const target = findPlayer(payload.toId);
  if (!target || !target.alive) return;
  if (from) {
    from.score += 1;
    floatingTexts.push({ x: from.x, y: from.y - 27, text: "+1", color: "#ffe079", life: .9, max: .9 });
  }
  bomb.lastPasser = payload.fromId;
  bomb.holderId = target.id;
  bomb.fuse = Number(payload.fuse) || 6.5;
  bomb.bumpLock = .26;
  const fromX = payload.normalized ? payload.fromX * arena.w : payload.fromX;
  const fromY = payload.normalized ? payload.fromY * arena.h : payload.fromY;
  const toX = payload.normalized ? payload.toX * arena.w : payload.toX;
  const toY = payload.normalized ? payload.toY * arena.h : payload.toY;
  bomb.trail = { x1: Number(fromX) || from?.x || 0, y1: Number(fromY) || from?.y || 0, x2: Number(toX) || target.x, y2: Number(toY) || target.y, t: .28 };
  burst(target.x, target.y, "#fff0a4", 10, 120);
  playSound("pass");
  vibrate(10);
  showToast(from?.isLocal ? "傳得漂亮！+1 分" : `${from?.name || "玩家"} 把炸彈丟給 ${target.isLocal ? "你" : target.name}！`);
}

function explode(holder) {
  const golden = goldenNext || remaining <= 10;
  const points = golden ? 2 : 1;
  const payload = { holderId: holder.id, x: holder.x, y: holder.y, points, golden, scorerId: bomb.lastPasser };
  applyExplosion(payload, true);
  bomb.holderId = null;
  bomb.fuse = 6.8;
  goldenNext = Math.random() < .25;
  if (goldenNext && remaining > 13) {
    setTimeout(() => { if (GAME_STATE === State.PLAYING) showToast("下一顆是雙倍炸彈！"); }, 500);
  }
  if (players.filter(p => p.alive).length < 2) {
    const alive = players.find(p => p.alive);
    if (alive) bomb.holderId = alive.id;
  } else {
    const candidates = players.filter(p => p.alive);
    if (candidates.length) {
      const next = candidates[Math.floor(Math.random() * candidates.length)];
      bomb.holderId = next.id;
    }
  }
  sendEvent("BOMB_EXPLODE", {
    ...payload, x: payload.x / arena.w, y: payload.y / arena.h, normalized: true,
    nextHolderId: bomb.holderId, nextFuse: bomb.fuse
  });
}

function applyExplosion(payload, localAuthority) {
  const x = payload.normalized ? Number(payload.x) * arena.w : Number(payload.x) || 0;
  const y = payload.normalized ? Number(payload.y) * arena.h : Number(payload.y) || 0;
  const holder = findPlayer(payload.holderId);
  const isGolden = Boolean(payload.golden);
  if (holder) {
    holder.hearts = Math.max(0, holder.hearts - 1);
    holder.flash = .5;
    holder.stun = .55;
    if (holder.hearts === 0) holder.alive = false;
    floatingTexts.push({ x, y: y - 32, text: isGolden ? "BOOM ×2!" : "BOOM!", color: isGolden ? "#ffe078" : "#fff1bf", life: 1.1, max: 1.1 });
  }
  for (const p of players) {
    if (!p.alive || p.id === payload.holderId) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < 112) {
      const a = Math.atan2(p.y - y, p.x - x);
      p.knockX += Math.cos(a) * 350;
      p.knockY += Math.sin(a) * 350;
      const shove = 13;
      p.x += Math.cos(a) * shove;
      p.y += Math.sin(a) * shove;
      if (!p.isLocal) {
        p.tx += Math.cos(a) * shove;
        p.ty += Math.sin(a) * shove;
      }
      p.stun = Math.max(p.stun, .12);
    }
  }
  const scorer = findPlayer(payload.scorerId ?? bomb.lastPasser);
  if (scorer?.alive) {
    scorer.score += Number(payload.points) || (isGolden ? 2 : 1);
    floatingTexts.push({ x: scorer.x, y: scorer.y - 35, text: `+${Number(payload.points) || (isGolden ? 2 : 1)}`, color: "#ffe27d", life: .9, max: .9 });
    if (scorer.isLocal) playSound("score");
  }
  if (payload.holderId === localId) vibrate([55, 35, 100]);
  screenShake = Math.max(screenShake, isGolden ? 12 : 8);
  burst(x, y, isGolden ? "#ffe275" : "#ff9165", isGolden ? 34 : 25, 190);
  playSound("explosion");
  if (isGolden) showToast("雙倍爆炸！分數加倍");
  else if (holder?.isLocal) showToast(holder.alive ? "炸到自己了！" : "被炸出場！");
  if (localAuthority && holder?.isLocal) vibrate(120);
}

function endByScore() {
  const sorted = [...players].sort((a, b) => b.score - a.score || b.hearts - a.hearts);
  finishRound(sorted[0]?.id ?? null, true);
}

function finishRound(id, broadcast) {
  if (GAME_STATE === State.RESULT || GAME_STATE === State.EXIT) return;
  GAME_STATE = State.RESULT;
  winnerId = id;
  const ordered = [...players].sort((a, b) => b.score - a.score || b.hearts - a.hearts);
  const winner = ordered.find(p => p.id === id) ?? ordered[0];
  playSound(winner?.id === localId ? "score" : "explosion");
  vibrate(winner?.id === localId ? [35, 40, 80] : 180);
  if (broadcast && isHost) sendEvent("ROUND_END", { winnerId: winner?.id, ranking: ordered.map(p => ({ id: p.id, score: p.score })) });
  calloutEl.classList.remove("show", "small");
  showToast(winner?.id === localId ? "你贏了！太會傳了" : `${winner?.name || "玩家"} 拿下勝利！`);
  showCallout(winner?.id === localId ? "贏了！" : `${winner?.name || "玩家"} 勝利`, true);
  if (!gameOverCalled) {
    gameOverCalled = true;
    const winAmount = winner?.id === localId ? 100 : 0;
    try { sdk.gameOver?.(winAmount); } catch (error) { console.warn("BoomRoom gameOver failed", error); }
  }
  hintEl.textContent = ordered.map((p, i) => `${i + 1}. ${p.name} ${p.score}`).join("　");
  resultTimer = 3;
}

function updateEffects(dt) {
  if (GAME_STATE === State.RESULT) {
    resultTimer -= dt;
    if (resultTimer <= 0) {
      GAME_STATE = State.EXIT;
      try { window.parent.postMessage({ action: "leaveGame" }, "*"); } catch { /* Standalone fallback below. */ }
      if (window.parent === window) location.href = "../room.html";
      return;
    }
  }
  for (const p of particles) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= Math.pow(.08, dt); p.vy *= Math.pow(.08, dt);
    p.life -= dt;
  }
  particles = particles.filter(p => p.life > 0);
  for (const f of floatingTexts) { f.y -= 27 * dt; f.life -= dt; }
  floatingTexts = floatingTexts.filter(f => f.life > 0);
  if (bomb.trail) bomb.trail.t -= dt;
  screenShake = Math.max(0, screenShake - dt * 30);
}

function render() {
  const w = arena.w, h = arena.h;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  if (screenShake > 0) ctx.translate((Math.random() - .5) * screenShake, (Math.random() - .5) * screenShake);
  drawArena(w, h);
  if (bomb.trail?.t > 0) drawPassTrail(bomb.trail);
  players.filter(p => !p.disconnected).forEach(drawPlayer);
  const carrier = findPlayer(bomb.holderId);
  if (carrier?.alive && GAME_STATE === State.PLAYING) drawBomb(carrier);
  particles.forEach(drawParticle);
  floatingTexts.forEach(drawFloating);
  if (GAME_STATE === State.RESULT) drawResults(w, h);
  ctx.restore();
}

function drawArena(w, h) {
  ctx.fillStyle = "#21143e";
  ctx.fillRect(0, 0, w, h);
  const gradient = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, Math.max(w, h) * .68);
  gradient.addColorStop(0, "#372253");
  gradient.addColorStop(.72, "#251740");
  gradient.addColorStop(1, "#1b1132");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.globalAlpha = .15;
  ctx.strokeStyle = "#a991cb"; ctx.lineWidth = 1;
  const step = 36;
  for (let x = 0; x < w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = "rgba(193,165,255,.3)";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 10]);
  ctx.beginPath(); ctx.ellipse(w / 2, h / 2, Math.max(35, w * .39), Math.max(35, h * .34), 0, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2 + .4;
    const x = w / 2 + Math.cos(angle) * w * .45;
    const y = h / 2 + Math.sin(angle) * h * .4;
    ctx.fillStyle = "rgba(255,220,146,.4)";
    ctx.beginPath(); ctx.arc(x, y, 2.3, 0, TAU); ctx.fill();
  }
  if (GAME_STATE === State.PLAYING && remaining <= 10) {
    ctx.strokeStyle = `rgba(255,96,137,${.25 + Math.sin(nowMs() / 110) * .1})`;
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.roundRect(5, 5, w - 10, h - 10, 23); ctx.stroke();
  }
}

function drawPlayer(p) {
  const r = 17;
  ctx.save();
  ctx.translate(p.x, p.y);
  if (!p.alive) {
    ctx.globalAlpha = .27;
    ctx.fillStyle = "#b6a5cc";
    ctx.font = "900 21px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("✕", 0, 0);
    ctx.restore();
    return;
  }
  if (p.stun > .05) ctx.rotate(Math.sin(nowMs() / 34) * .18);
  const bounce = Math.sin(p.walk) * 2.2;
  ctx.fillStyle = "rgba(8,3,20,.32)";
  ctx.beginPath(); ctx.ellipse(0, 10, r * .94, 8, 0, 0, TAU); ctx.fill();
  // Tiny marching feet keep the blob feeling alive even while standing still.
  ctx.fillStyle = p.color;
  ctx.beginPath(); ctx.ellipse(-6, 9 + bounce, 5.3, 7, -.15, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(6, 9 - bounce, 5.3, 7, .15, 0, TAU); ctx.fill();
  ctx.shadowColor = p.color; ctx.shadowBlur = p.id === bomb.holderId ? 19 : 8;
  ctx.fillStyle = p.flash > 0 ? "#fff1d2" : p.color;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,255,255,.3)";
  ctx.beginPath(); ctx.ellipse(-5, -8, 5.5, 3, -.3, 0, TAU); ctx.fill();
  const lookX = Math.cos(p.angle) * 1.5;
  const lookY = Math.sin(p.angle) * .7;
  ctx.fillStyle = "#2e193b";
  ctx.beginPath(); ctx.arc(-5 + lookX, -1 + lookY, 2.1, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(5 + lookX, -1 + lookY, 2.1, 0, TAU); ctx.fill();
  ctx.strokeStyle = "#45213c"; ctx.lineWidth = 1.5; ctx.lineCap = "round";
  ctx.beginPath(); ctx.arc(0, 3, 3.6, .12, Math.PI - .12); ctx.stroke();
  if (p.id === bomb.holderId && GAME_STATE === State.PLAYING) {
    ctx.fillStyle = "#fff3d2";
    ctx.font = "900 10px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("!", 0, -26);
  }
  drawNameTag(p);
  ctx.restore();
}

function drawNameTag(p) {
  const text = p.name.length > 8 ? `${p.name.slice(0, 7)}…` : p.name;
  ctx.font = "800 10px 'Noto Sans TC', Nunito, sans-serif";
  const width = ctx.measureText(text).width + 14;
  ctx.fillStyle = "rgba(19,11,35,.78)";
  roundRect(ctx, -width / 2, -40, width, 16, 8);
  ctx.fill();
  ctx.fillStyle = p.id === localId ? "#fff1cb" : "#eee7fa";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, 0, -32);
}

function drawBomb(holder) {
  const pulse = 1 + Math.sin(nowMs() * (bomb.fuse < 2 ? .025 : .009)) * (bomb.fuse < 2 ? .16 : .07);
  const x = holder.x + Math.cos(holder.angle + .4) * 23;
  const y = holder.y + Math.sin(holder.angle + .4) * 20 - 10;
  bomb.x = x; bomb.y = y;
  const glow = ctx.createRadialGradient(x, y, 2, x, y, 32);
  glow.addColorStop(0, bomb.fuse < 2 ? "rgba(255,90,100,.55)" : "rgba(255,197,87,.45)");
  glow.addColorStop(1, "rgba(255,160,60,0)");
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, 32, 0, TAU); ctx.fill();
  ctx.save(); ctx.translate(x, y); ctx.scale(pulse, pulse);
  ctx.fillStyle = "#271932";
  ctx.beginPath(); ctx.arc(0, 0, 11, 0, TAU); ctx.fill();
  ctx.fillStyle = "#514066";
  ctx.beginPath(); ctx.ellipse(-3, -4, 4, 2.2, -.3, 0, TAU); ctx.fill();
  ctx.strokeStyle = "#ffcf67"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(1, -10); ctx.quadraticCurveTo(8, -17, 11, -13); ctx.stroke();
  ctx.fillStyle = "#fff2aa"; ctx.shadowColor = "#ffbb5e"; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.arc(11, -14, bomb.fuse < 2 ? 3.4 : 2.3, 0, TAU); ctx.fill();
  ctx.restore();
  ctx.fillStyle = "rgba(24,12,38,.86)";
  roundRect(ctx, x - 16, y + 15, 32, 14, 7); ctx.fill();
  ctx.fillStyle = bomb.fuse < 2 ? "#ff7795" : "#fff0b4";
  ctx.font = "600 9px DM Mono,monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(`${Math.max(0,bomb.fuse).toFixed(1)}s`, x, y + 22);
}

function drawPassTrail(trail) {
  const t = clamp(trail.t / .28, 0, 1);
  ctx.save();
  ctx.globalAlpha = t;
  ctx.strokeStyle = "#ffe389"; ctx.lineWidth = 3; ctx.setLineDash([5, 6]);
  ctx.beginPath(); ctx.moveTo(trail.x1, trail.y1); ctx.lineTo(trail.x2, trail.y2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawParticle(p) {
  ctx.globalAlpha = Math.max(0, p.life / p.max);
  ctx.fillStyle = p.color;
  ctx.beginPath(); ctx.arc(p.x, p.y, p.size * Math.max(.15, p.life / p.max), 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
}
function drawFloating(f) {
  ctx.globalAlpha = Math.min(1, f.life / f.max * 1.4);
  ctx.fillStyle = f.color; ctx.font = "900 18px Nunito,sans-serif"; ctx.textAlign = "center";
  ctx.shadowColor = f.color; ctx.shadowBlur = 12; ctx.fillText(f.text, f.x, f.y); ctx.shadowBlur = 0; ctx.globalAlpha = 1;
}

function drawResults(w, h) {
  ctx.fillStyle = "rgba(15,8,29,.64)";
  ctx.fillRect(0, 0, w, h);
  const ordered = [...players].sort((a, b) => b.score - a.score || b.hearts - a.hearts);
  const panelW = Math.min(300, w - 42);
  const panelH = Math.min(250, h - 35);
  const x = (w - panelW) / 2, y = (h - panelH) / 2;
  ctx.fillStyle = "rgba(48,31,73,.96)";
  roundRect(ctx, x, y, panelW, panelH, 20); ctx.fill();
  ctx.strokeStyle = "rgba(207,181,255,.35)"; ctx.lineWidth = 1; roundRect(ctx, x, y, panelW, panelH, 20); ctx.stroke();
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffe27d"; ctx.font = "900 18px Nunito,sans-serif";
  ctx.fillText(ordered[0]?.id === localId ? "你是傳球王！" : "本局排名", w / 2, y + 31);
  const visible = ordered.slice(0, Math.min(5, ordered.length));
  ctx.font = "800 12px Nunito,sans-serif";
  visible.forEach((p, i) => {
    const rowY = y + 60 + i * 27;
    ctx.fillStyle = i === 0 ? "rgba(255,214,110,.15)" : "rgba(255,255,255,.035)";
    roundRect(ctx, x + 14, rowY - 14, panelW - 28, 23, 8); ctx.fill();
    ctx.fillStyle = p.color; ctx.fillText(`${["①","②","③","④","⑤"][i] || `${i+1}.`} ${p.name}`, w / 2 - 28, rowY + 1);
    ctx.fillStyle = "#f5edf9";
    ctx.fillText(`${p.score} 分`, w / 2 + panelW * .31, rowY + 1);
  });
  ctx.fillStyle = "#bba9d1"; ctx.font = "700 10px Nunito,sans-serif";
  ctx.fillText("即將返回房間…", w / 2, y + panelH - 16);
}

function updateHud() {
  const sec = Math.ceil(remaining);
  clockEl.textContent = String(sec).padStart(2, "0");
  clockEl.closest(".round-clock").classList.toggle("urgent", sec <= 10 && GAME_STATE === State.PLAYING);
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const rank = sorted.findIndex(p => p.id === localId) + 1;
  const leader = sorted[0];
  leaderEl.textContent = leader ? `#${rank}　👑 ${leader.name} ${leader.score}` : "";
  const local = players.find(p => p.id === localId);
  miniScoreEl.textContent = `${local?.score ?? 0} 分`;
  passButton.classList.toggle("is-carrier", GAME_STATE === State.PLAYING && bomb.holderId === localId);
  const points = local?.hearts ?? 0;
  lifeStrip.innerHTML = Array.from({ length: 2 }, (_, i) => `<span class="life-pip ${i >= points ? "lost" : ""}"></span>`).join("");
}

function buildLives() { updateHud(); }

function burst(x, y, color, count = 16, speed = 140) {
  const cap = 190;
  const amount = Math.min(count, cap - particles.length);
  for (let i = 0; i < amount; i++) {
    const angle = Math.random() * TAU;
    const velocity = speed * (.3 + Math.random() * .7);
    const life = .36 + Math.random() * .58;
    particles.push({ x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, size: 2 + Math.random() * 3.5, color, life, max: life });
  }
}

function nearest(from, items) {
  let best = null, bestD = Infinity;
  for (const item of items) {
    const d = distance(from, item);
    if (d < bestD) { bestD = d; best = item; }
  }
  return best;
}
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function nowMs() { return performance.now(); }

function showCallout(text, small = false) {
  calloutEl.textContent = text;
  calloutEl.classList.toggle("small", small);
  calloutEl.classList.remove("show");
  void calloutEl.offsetWidth;
  calloutEl.classList.add("show");
}
function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.remove("show");
  void toastEl.offsetWidth;
  toastEl.classList.add("show");
}

function playSound(name) {
  if (!audioUnlocked) return;
  try {
    if (name === "ambience") {
      if (!ambientAudio) {
        ambientAudio = soundFiles.ambience;
        ambientAudio.play().catch(() => {});
      }
      return;
    }
    const sound = soundFiles[name]?.cloneNode();
    if (!sound) return;
    sound.volume = soundFiles[name].volume;
    sound.play().catch(() => {});
  } catch { /* Audio is optional on muted devices. */ }
}

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  playSound("ambience");
}
function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* iOS and desktop may not support vibration. */ }
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  arena.w = Math.max(1, rect.width);
  arena.h = Math.max(1, rect.height);
  arena.dpr = dpr;
  arena.inset = Math.min(30, Math.max(19, Math.min(arena.w, arena.h) * .065));
  canvas.width = Math.round(arena.w * dpr);
  canvas.height = Math.round(arena.h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layoutPlayers();
}

function updateJoystick(event) {
  const rect = joystickEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  let dx = event.clientX - cx, dy = event.clientY - cy;
  const max = rect.width * .34;
  const d = Math.hypot(dx, dy);
  if (d > max) { dx *= max / d; dy *= max / d; }
  joystick.x = dx / max;
  joystick.y = dy / max;
  knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
}

joystickEl.addEventListener("pointerdown", event => {
  unlockAudio();
  joystick.pointerId = event.pointerId;
  joystickEl.setPointerCapture(event.pointerId);
  updateJoystick(event);
});
joystickEl.addEventListener("pointermove", event => {
  if (joystick.pointerId === event.pointerId) updateJoystick(event);
});
function resetJoystick(event) {
  if (joystick.pointerId !== null && (!event || joystick.pointerId === event.pointerId)) {
    joystick.pointerId = null; joystick.x = 0; joystick.y = 0; knobEl.style.transform = "translate(0,0)";
  }
}
joystickEl.addEventListener("pointerup", resetJoystick);
joystickEl.addEventListener("pointercancel", resetJoystick);
passButton.addEventListener("pointerdown", event => {
  event.preventDefault();
  unlockAudio();
  touchActionDown = true;
  const p = players.find(item => item.isLocal);
  if (p && bomb.holderId === p.id && GAME_STATE === State.PLAYING) passBomb(p, true);
});
passButton.addEventListener("pointerup", () => { touchActionDown = false; });
passButton.addEventListener("pointercancel", () => { touchActionDown = false; });
passButton.addEventListener("pointerleave", () => { touchActionDown = false; });
window.addEventListener("keydown", event => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  keys.add(key);
  if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(event.key)) event.preventDefault();
  if (event.key === " " && !event.repeat) {
    unlockAudio();
    const p = players.find(item => item.isLocal);
    if (p) passBomb(p, true);
  }
});
window.addEventListener("keyup", event => keys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key));
window.addEventListener("blur", () => { keys.clear(); resetJoystick(); touchActionDown = false; });
window.addEventListener("pagehide", () => {
  if (GAME_STATE === State.PLAYING) sendEvent("PLAYER_LEFT", { userId: localId, abandoned: true });
});
document.addEventListener("pointerdown", unlockAudio, { once: true });
window.addEventListener("resize", resize);
new ResizeObserver(resize).observe(canvas);
resize();
init();
