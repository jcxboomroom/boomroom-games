const $ = (selector) => document.querySelector(selector);
const canvas = $("#scene");
const ctx = canvas.getContext("2d");
const timerNode = $("#timer");
const aliveNode = $("#alive");
const placeNode = $("#place");
const chargeNode = $("#charge");
const calloutNode = $("#callout");
const dashButton = $("#dashButton");
const cooldownNode = $("#cooldown");
const resultNode = $("#result");

const GAME_STATE = Object.freeze({
  LOADING: "LOADING",
  COUNTDOWN: "COUNTDOWN",
  PLAYING: "PLAYING",
  RESULT: "RESULT",
  EXIT: "EXIT",
});

const MATCH_SECONDS = 45;
const OVERTIME_SECONDS = 12;
const GRID_SIZE = 9;
const PLAYER_COLORS = ["#6ef0ce", "#ff628d", "#ffcf57", "#8f8bff", "#ff956b", "#57c9ff", "#d987ff", "#a9e45d", "#f6a4c7", "#b8c4ff"];
const SOUND_FILES = {
  bump: "./sfx/bump.wav",
  crack: "./sfx/crack.wav",
  pickup: "./sfx/pickup.wav",
};
const sounds = Object.fromEntries(Object.entries(SOUND_FILES).map(([name, url]) => {
  const audio = new Audio(url);
  audio.preload = "auto";
  return [name, audio];
}));
const music = new Audio("./sfx/arena-loop.wav");
music.loop = true;
music.volume = 0.24;
music.preload = "auto";

let state = GAME_STATE.LOADING;
let sdk = window.BoomRoomSDK || null;
const mockMode = !sdk;
const mockSdk = {
  isHost: true,
  roomId: "mock-room",
  roomPlayers: [],
  async getUser() { return { id: "mock-you", username: "你", avatar_url: null }; },
  sendGameEvent(eventName, payload) {
    if (mockMode) handleGameEvent({ eventName, payload: { ...payload, sourceId: payload?.sourceId || localPlayer?.id } });
  },
  async requestPurchase() { return { success: false, mock: true }; },
  gameOver(winAmount) { console.info("[Floor Brawl] Mock gameOver:", winAmount); },
};
if (!sdk) sdk = mockSdk;

const roomId = String(sdk.roomId || "room");
let user = null;
let localPlayer = null;
let players = [];
let tiles = [];
let orb = null;
let stateStartedAt = performance.now();
let matchStartedAt = 0;
let lastFrameAt = 0;
let lastNetAt = 0;
let lastSnapshotAt = 0;
let lastUiAt = 0;
let lastOrbAt = 0;
let lastCallout = "";
let gameOverCalled = false;
let exitSent = false;
let overtimeAt = 0;
let safeRadius = 1.03;
let localInput = { x: 0, y: 0 };
let keys = new Set();
let pointerId = null;
let pointerOrigin = { x: 0, y: 0 };
let canvasWidth = 0;
let canvasHeight = 0;
let dpr = 1;
let board = { x: 0, y: 0, side: 0 };
let particles = [];
let floaters = [];
let screenShake = 0;
let soundReady = false;
let cachedTimeLeft = MATCH_SECONDS;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const length = (x, y) => Math.hypot(x, y);
const now = () => performance.now();

function colorWithAlpha(hex, alpha) {
  const value = hex.replace("#", "");
  const number = Number.parseInt(value, 16);
  const r = (number >> 16) & 255;
  const g = (number >> 8) & 255;
  const b = number & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function pingSound(name, volume = 0.65, rate = 1) {
  if (!soundReady || !sounds[name]) return;
  const instance = sounds[name].cloneNode();
  instance.volume = volume;
  instance.playbackRate = rate;
  instance.play().catch(() => {});
}

function unlockAudio() {
  if (soundReady) return;
  soundReady = true;
  music.play().catch(() => {});
  try {
    Object.values(sounds).forEach((audio) => {
      audio.muted = true;
      audio.play().then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
      }).catch(() => { audio.muted = false; });
    });
  } catch {}
}

function vibrate(pattern = 18) {
  try { navigator.vibrate?.(pattern); } catch {}
}

function makePlayer(raw, index, isLocal = false, isBot = false) {
  const id = String(raw?.id ?? raw?.userId ?? raw?.user_id ?? (isLocal ? "you" : `player-${index}`));
  const name = String(raw?.username ?? raw?.name ?? raw?.displayName ?? raw?.nickname ?? (isBot ? `小鬧鐘 ${index}` : `玩家 ${index + 1}`)).slice(0, 14);
  const angle = ((index * 2.3999632297) + 0.28) % (Math.PI * 2);
  const radius = index === 0 ? 0.12 : 0.46 + (index % 3) * 0.075;
  return {
    id,
    name,
    color: PLAYER_COLORS[index % PLAYER_COLORS.length],
    isLocal,
    isBot,
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    vx: 0,
    vy: 0,
    faceX: Math.cos(angle + Math.PI),
    faceY: Math.sin(angle + Math.PI),
    targetX: null,
    targetY: null,
    alive: true,
    charged: false,
    lastDashAt: -99,
    dashUntil: 0,
    dashX: 0,
    dashY: 0,
    hitUntil: 0,
    invulnerableUntil: 0,
    lastTile: "",
    survival: MATCH_SECONDS,
    knockouts: 0,
    orbs: 0,
    botThinkAt: 0,
    botTargetX: 0,
    botTargetY: 0,
    networkAt: 0,
    flash: 0,
    trail: [],
    koReason: "",
  };
}

function normalizeRoster(rawPlayers, currentUser) {
  const roster = Array.isArray(rawPlayers) ? rawPlayers : Array.isArray(rawPlayers?.players) ? rawPlayers.players : [];
  const currentId = String(currentUser?.id ?? currentUser?.userId ?? "");
  const normalized = [];
  const seen = new Set();

  roster.forEach((raw) => {
    if (!raw) return;
    const id = String(raw.id ?? raw.userId ?? raw.user_id ?? "");
    if (!id || seen.has(id)) return;
    seen.add(id);
    normalized.push(makePlayer(raw, normalized.length, id === currentId, false));
  });

  if (currentUser && !seen.has(currentId)) {
    normalized.unshift(makePlayer(currentUser, 0, true, false));
    normalized.forEach((player, index) => {
      player.color = PLAYER_COLORS[index % PLAYER_COLORS.length];
    });
  }

  if (!normalized.length) normalized.push(makePlayer({ id: "local-player", username: "你" }, 0, true, false));
  if (!normalized.some((player) => player.isLocal)) normalized[0].isLocal = true;

  const targetCount = Math.min(10, mockMode ? 6 : 4);
  while (normalized.length < targetCount) {
    const index = normalized.length;
    normalized.push(makePlayer({
      id: `bot-${roomId}-${index}`,
      username: ["碰碰", "閃閃", "豆包", "小彈珠", "泡泡", "阿蹦", "蘑菇", "麻糬", "火花"][index - 1] || `AI ${index}`,
    }, index, false, true));
  }

  return normalized.slice(0, 10);
}

async function boot() {
  const userPromise = typeof sdk.getUser === "function"
    ? Promise.resolve().then(() => sdk.getUser()).catch(() => null)
    : Promise.resolve(null);
  const currentUser = await Promise.race([userPromise, new Promise((resolve) => setTimeout(() => resolve(null), 900))]);
  user = currentUser;
  const roster = sdk.roomPlayers ?? [];
  players = normalizeRoster(roster, currentUser);
  localPlayer = players.find((player) => player.isLocal) || players[0];

  if (mockMode) {
    sdk.roomPlayers = players.map(({ id, name }) => ({ id, username: name }));
  }

  tiles = [];
  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      const x = ((col + 0.5) / GRID_SIZE) * 2 - 1;
      const y = ((row + 0.5) / GRID_SIZE) * 2 - 1;
      if (Math.hypot(x, y) < 1.055) tiles.push({ col, row, x, y, level: 0, collapseAt: 0, key: `${col}:${row}` });
    }
  }

  installNetworkEvents();
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas, { passive: true });
  window.addEventListener("orientationchange", resizeCanvas, { passive: true });
  installControls();

  const hostByRoster = players[0]?.id === localPlayer.id;
  const isHost = sdk.isHost == null ? hostByRoster : Boolean(sdk.isHost);
  if (isHost) beginCountdown();
  else {
    showCallout("等一下就開打");
    setTimeout(() => {
      if (state === GAME_STATE.LOADING) beginCountdown();
    }, 2100);
  }

  requestAnimationFrame(frame);
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  dpr = Math.min(2, window.devicePixelRatio || 1);
  canvasWidth = Math.max(1, rect.width);
  canvasHeight = Math.max(1, rect.height);
  canvas.width = Math.round(canvasWidth * dpr);
  canvas.height = Math.round(canvasHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const side = Math.min(canvasWidth * 0.91, canvasHeight * 0.62, 760);
  board = { side, x: canvasWidth / 2, y: canvasHeight * 0.485 };
}

function installControls() {
  const stick = $("#joystick");
  const knob = $("#stickKnob");
  const setStickFromEvent = (event) => {
    const rect = stick.getBoundingClientRect();
    const max = rect.width * 0.3;
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const magnitude = Math.min(1, length(dx, dy) / max);
    const angle = Math.atan2(dy, dx);
    localInput.x = Math.cos(angle) * magnitude;
    localInput.y = Math.sin(angle) * magnitude;
    knob.style.transform = `translate(${localInput.x * max}px, ${localInput.y * max}px)`;
  };

  stick.addEventListener("pointerdown", (event) => {
    unlockAudio();
    pointerId = event.pointerId;
    stick.setPointerCapture(event.pointerId);
    setStickFromEvent(event);
  });
  stick.addEventListener("pointermove", (event) => {
    if (event.pointerId === pointerId) setStickFromEvent(event);
  });
  const releaseStick = (event) => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    localInput = { x: 0, y: 0 };
    knob.style.transform = "translate(0, 0)";
  };
  stick.addEventListener("pointerup", releaseStick);
  stick.addEventListener("pointercancel", releaseStick);
  stick.addEventListener("lostpointercapture", releaseStick);

  dashButton.addEventListener("pointerdown", unlockAudio, { passive: true });
  dashButton.addEventListener("click", () => triggerDash());
  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) event.preventDefault();
    keys.add(key);
    unlockAudio();
    if (key === " ") triggerDash();
  });
  window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
  window.addEventListener("blur", () => {
    keys.clear();
    localInput = { x: 0, y: 0 };
  });
}

function installNetworkEvents() {
  const listener = (event) => {
    const detail = event?.detail ?? event;
    const eventName = detail?.eventName ?? detail?.name ?? detail?.type;
    const payload = detail?.payload ?? detail?.data ?? detail;
    if (eventName) handleGameEvent({ eventName, payload });
  };
  window.addEventListener("gameEventReceived", listener);
  document.addEventListener("gameEventReceived", listener);
  try { sdk.addEventListener?.("gameEventReceived", listener); } catch {}
  try { sdk.on?.("gameEventReceived", listener); } catch {}
}

function sendEvent(eventName, payload = {}) {
  const event = { ...payload, sourceId: localPlayer?.id, roomId, at: Date.now() };
  try { sdk.sendGameEvent?.(eventName, event); } catch (error) { console.warn("BoomRoom event send failed", error); }
  if (mockMode) handleGameEvent({ eventName, payload: event });
}

function handleGameEvent({ eventName, payload = {} }) {
  if (!payload || payload.sourceId === localPlayer?.id) return;
  const player = players.find((candidate) => candidate.id === String(payload.playerId ?? payload.sourceId ?? payload.userId));

  switch (eventName) {
    case "ROUND_START":
      if (state === GAME_STATE.LOADING) beginCountdown(payload.startAt);
      break;
    case "PLAYER_MOVE":
      if (player && !player.isLocal) {
        const nextX = Number(payload.x);
        const nextY = Number(payload.y);
        if (Number.isFinite(nextX) && Number.isFinite(nextY)) {
          if (sdk.isHost && player.networkAt) {
            const elapsed = clamp((Date.now() - player.networkAt) / 1000, 0.03, 0.4);
            const limit = 0.88 * elapsed + (payload.dashing ? 0.55 : 0.06);
            const dx = nextX - player.x;
            const dy = nextY - player.y;
            const distance = length(dx, dy);
            if (distance > limit) {
              player.x += (dx / distance) * limit;
              player.y += (dy / distance) * limit;
            } else {
              player.x = nextX;
              player.y = nextY;
            }
          } else {
            player.x = nextX;
            player.y = nextY;
          }
          player.vx = clamp(Number(payload.vx) || 0, -2.8, 2.8);
          player.vy = clamp(Number(payload.vy) || 0, -2.8, 2.8);
          player.faceX = Number(payload.faceX) || player.faceX;
          player.faceY = Number(payload.faceY) || player.faceY;
          if (payload.dashing) {
            player.dashX = player.faceX;
            player.dashY = player.faceY;
          }
          player.dashUntil = payload.dashing ? now() + 180 : Math.min(player.dashUntil, now());
          player.networkAt = Date.now();
        }
      }
      break;
    case "NPC_MOVES":
      if (Array.isArray(payload.players)) {
        payload.players.forEach((move) => {
          const npc = players.find((candidate) => candidate.id === move.id);
          if (!npc || npc.isLocal || !npc.isBot) return;
          npc.x = Number(move.x) || 0;
          npc.y = Number(move.y) || 0;
          npc.vx = Number(move.vx) || 0;
          npc.vy = Number(move.vy) || 0;
          npc.faceX = Number(move.faceX) || npc.faceX;
          npc.faceY = Number(move.faceY) || npc.faceY;
          if (move.dashing) {
            npc.dashX = npc.faceX;
            npc.dashY = npc.faceY;
          }
          npc.dashUntil = move.dashing ? now() + 180 : Math.min(npc.dashUntil, now());
        });
      }
      break;
    case "SHOVE_REQUEST":
      if (sdk.isHost || mockMode) hostResolveShove(payload);
      break;
    case "PLAYER_HIT":
      applyHit(payload);
      break;
    case "PLAYER_OUT":
      eliminatePlayer(String(payload.targetId), payload.reason || "落進裂縫", payload.attackerId);
      break;
    case "PLAYER_JOINED":
      addRoomPlayer(payload.player || payload);
      break;
    case "PLAYER_LEFT":
    case "PLAYER_DISCONNECTED":
      eliminatePlayer(String(payload.playerId ?? payload.userId ?? payload.sourceId), "離開競技場");
      break;
    case "TILE_STATE":
      applyTileState(payload);
      break;
    case "ORB_STATE":
      orb = payload.active ? { id: payload.id, x: payload.x, y: payload.y, until: payload.until } : null;
      break;
    case "ORB_PICKUP_REQUEST":
      handleOrbRequest(payload);
      break;
    case "ORB_PICKUP":
      applyOrbPickup(payload);
      break;
    case "GAME_STATE":
      applySnapshot(payload);
      break;
    case "GAME_FINISH":
      if (state === GAME_STATE.PLAYING) finishRound(payload.winnerId, payload.reason || "最後站著的人");
      break;
    default:
      break;
  }
}

function beginCountdown(startAt) {
  if (state !== GAME_STATE.LOADING) return;
  state = GAME_STATE.COUNTDOWN;
  stateStartedAt = now();
  const host = sdk.isHost == null ? players[0]?.id === localPlayer.id : Boolean(sdk.isHost);
  if (host && !mockMode) sendEvent("ROUND_START", { startAt: Date.now() + 500 });
  showCallout("準備落地");
  matchStartedAt = 0;
  safeRadius = 1.03;
  orb = null;
  tiles.forEach((tile) => { tile.level = 0; tile.collapseAt = 0; });
  players.forEach((player) => {
    player.alive = true;
    player.charged = false;
    player.vx = 0;
    player.vy = 0;
    player.lastDashAt = -99;
    player.lastTile = "";
    player.survival = MATCH_SECONDS;
    player.knockouts = 0;
    player.orbs = 0;
    player.koReason = "";
    player.x = Math.cos(players.indexOf(player) * 2.3999632297 + 0.28) * (players.indexOf(player) === 0 ? 0.12 : 0.45);
    player.y = Math.sin(players.indexOf(player) * 2.3999632297 + 0.28) * (players.indexOf(player) === 0 ? 0.12 : 0.45);
  });
  gameOverCalled = false;
  exitSent = false;
  overtimeAt = 0;
  cachedTimeLeft = MATCH_SECONDS;
}

function addRoomPlayer(raw) {
  const id = String(raw?.id ?? raw?.userId ?? raw?.user_id ?? "");
  if (!id || players.some((player) => player.id === id) || players.length >= 10) return;
  const player = makePlayer(raw, players.length, false, false);
  player.x = (Math.random() - 0.5) * 0.62;
  player.y = (Math.random() - 0.5) * 0.62;
  player.invulnerableUntil = state === GAME_STATE.PLAYING ? now() + 1200 : 0;
  if (state === GAME_STATE.PLAYING) player.survival = Math.max(0, (now() - matchStartedAt) / 1000);
  players.push(player);
  if (isHost()) {
    if (!mockMode) sendEvent("GAME_STATE", makeSnapshot());
    callout(`${player.name} 加入混戰！`);
  }
}

function startPlaying() {
  if (state !== GAME_STATE.COUNTDOWN) return;
  state = GAME_STATE.PLAYING;
  matchStartedAt = now();
  stateStartedAt = matchStartedAt;
  lastOrbAt = matchStartedAt + 3600;
  showCallout("撞！淘汰他們！");
  if (isHost() && !mockMode) sendEvent("GAME_STATE", makeSnapshot());
}

function isHost() {
  if (sdk.isHost != null) return Boolean(sdk.isHost);
  return players[0]?.id === localPlayer?.id;
}

function currentMoveInput() {
  let x = localInput.x;
  let y = localInput.y;
  if (keys.has("arrowleft") || keys.has("a")) x -= 1;
  if (keys.has("arrowright") || keys.has("d")) x += 1;
  if (keys.has("arrowup") || keys.has("w")) y -= 1;
  if (keys.has("arrowdown") || keys.has("s")) y += 1;
  const magnitude = length(x, y);
  if (magnitude > 1) { x /= magnitude; y /= magnitude; }
  return { x, y };
}

function triggerDash() {
  if (state !== GAME_STATE.PLAYING || !localPlayer?.alive) return;
  const time = now() / 1000;
  if (time - localPlayer.lastDashAt < 2.55) return;
  const input = currentMoveInput();
  const dirLength = length(input.x, input.y);
  const dx = dirLength > 0.12 ? input.x / dirLength : localPlayer.faceX;
  const dy = dirLength > 0.12 ? input.y / dirLength : localPlayer.faceY;
  if (isHost()) {
    hostResolveShove({ playerId: localPlayer.id, dx, dy });
  } else {
    beginDash(localPlayer, dx, dy, time);
    localPlayer.charged = false;
    sendEvent("SHOVE_REQUEST", { playerId: localPlayer.id, dx, dy });
  }
  vibrate(14);
}

function beginDash(player, dx, dy, time = now() / 1000) {
  const mag = length(dx, dy) || 1;
  player.dashX = dx / mag;
  player.dashY = dy / mag;
  player.faceX = player.dashX;
  player.faceY = player.dashY;
  player.lastDashAt = time;
  player.dashUntil = now() + 195;
  player.vx = player.dashX * 2.45;
  player.vy = player.dashY * 2.45;
  player.dashHitIds = new Set();
  player.chargedDash = player.charged;
  if (player.isLocal) {
    screenShake = Math.max(screenShake, 4);
    pingSound("bump", 0.2, 1.15);
  }
}

function hostResolveShove(payload) {
  if (!isHost() || state !== GAME_STATE.PLAYING) return;
  const attacker = players.find((player) => player.id === String(payload.playerId ?? payload.sourceId));
  if (!attacker?.alive) return;
  const time = now() / 1000;
  if (time - attacker.lastDashAt < 2.55) return;
  const dx = Number(payload.dx) || attacker.faceX || 1;
  const dy = Number(payload.dy) || attacker.faceY || 0;
  const charged = attacker.charged;
  beginDash(attacker, dx, dy, time);
  attacker.charged = false;
  attacker.chargedDash = charged;
  attacker.dashHitIds = new Set();
}

function resolveDashHits() {
  if (!isHost()) return;
  players.forEach((attacker) => {
    if (!attacker.alive || now() >= attacker.dashUntil) return;
    if (!attacker.dashHitIds) attacker.dashHitIds = new Set();
    const victim = players
      .filter((target) => target.alive && target.id !== attacker.id && !attacker.dashHitIds.has(target.id))
      .map((target) => {
        const vx = target.x - attacker.x;
        const vy = target.y - attacker.y;
        const distance = length(vx, vy);
        const facing = distance > 0 ? (vx * attacker.dashX + vy * attacker.dashY) / distance : 1;
        return { target, distance, facing, vx, vy };
      })
      .filter((item) => item.distance < 0.17 && item.facing > -0.05)
      .sort((a, b) => a.distance - b.distance)[0];
    if (!victim) return;

    attacker.dashHitIds.add(victim.target.id);
    const distance = length(victim.vx, victim.vy) || 1;
    const event = {
      attackerId: attacker.id,
      targetId: victim.target.id,
      dx: victim.vx / distance || attacker.dashX,
      dy: victim.vy / distance || attacker.dashY,
      force: attacker.chargedDash ? 1.62 : 1.05,
      charged: Boolean(attacker.chargedDash),
    };
    applyHit(event);
    if (attacker.isLocal) {
      callout(event.charged ? "超級撞飛！" : "撞飛！");
      screenShake = Math.max(screenShake, event.charged ? 11 : 7);
      vibrate(event.charged ? [24, 24, 30] : 24);
    }
    if (!mockMode) sendEvent("PLAYER_HIT", event);
    attacker.chargedDash = false;
  });
}

function applyHit(payload) {
  const victim = players.find((player) => player.id === String(payload.targetId));
  if (!victim?.alive || victim.invulnerableUntil > now()) return;
  const force = clamp(Number(payload.force) || 1, 0.5, 1.8);
  const dx = Number(payload.dx) || 0;
  const dy = Number(payload.dy) || 0;
  victim.vx = dx * force;
  victim.vy = dy * force;
  victim.lastAttackerId = String(payload.attackerId ?? "");
  victim.lastHitAt = now();
  victim.hitUntil = now() + 310;
  victim.invulnerableUntil = now() + 480;
  victim.flash = 1;
  spawnBurst(victim.x, victim.y, victim.color, payload.charged ? 24 : 16);
  addFloater(victim.x, victim.y - 0.08, payload.charged ? "砰！！" : "砰！", payload.charged ? "#ffe087" : "#ffffff");
  pingSound("bump", payload.targetId === localPlayer?.id ? 0.78 : 0.42, payload.charged ? 0.86 : 1);
  if (victim.id === localPlayer?.id) {
    screenShake = Math.max(screenShake, payload.charged ? 10 : 7);
    vibrate(payload.charged ? [22, 30, 22] : 28);
  }
}

function damageTile(tile, level) {
  if (!isHost() || !tile || tile.level >= level || tile.level >= 3) return;
  tile.level = level;
  tile.collapseAt = level === 2 ? now() + 820 : 0;
  sendEvent("TILE_STATE", { key: tile.key, level: tile.level, collapseAt: Date.now() + (level === 2 ? 820 : 0) });
  if (level === 1) {
    spawnBurst(tile.x, tile.y, "#9ba9ff", 3);
  } else if (level === 2) {
    pingSound("crack", 0.36, 0.94);
    addFloater(tile.x, tile.y, "裂開！", "#a9b6ff");
  } else {
    pingSound("crack", 0.72, 0.78);
    spawnBurst(tile.x, tile.y, "#b0bfff", 13);
    callout("地板塌了！");
  }
}

function applyTileState(payload) {
  const tile = tiles.find((candidate) => candidate.key === String(payload.key));
  if (!tile) return;
  tile.level = clamp(Number(payload.level) || 0, 0, 3);
  tile.collapseAt = tile.level === 2 ? now() + Math.max(0, Number(payload.collapseAt) - Date.now()) : 0;
  if (tile.level === 3) {
    spawnBurst(tile.x, tile.y, "#9eabff", 11);
    pingSound("crack", 0.52, 0.8);
  }
}

function tileAt(x, y) {
  const col = Math.floor(((x + 1) / 2) * GRID_SIZE);
  const row = Math.floor(((y + 1) / 2) * GRID_SIZE);
  if (col < 0 || col >= GRID_SIZE || row < 0 || row >= GRID_SIZE) return null;
  return tiles.find((tile) => tile.col === col && tile.row === row) || null;
}

function maybeCrackUnderPlayers() {
  if (!isHost()) return;
  players.forEach((player) => {
    if (!player.alive) return;
    const tile = tileAt(player.x, player.y);
    if (!tile) return;
    if (player.lastTile === tile.key) return;
    player.lastTile = tile.key;
    if (tile.level === 0) damageTile(tile, 1);
    else if (tile.level === 1) damageTile(tile, 2);
  });

  tiles.forEach((tile) => {
    if (tile.level === 2 && tile.collapseAt && now() >= tile.collapseAt) damageTile(tile, 3);
  });
}

function spawnOrb() {
  if (!isHost() || state !== GAME_STATE.PLAYING || orb) return;
  const candidates = [[0, 0], [-0.3, 0.1], [0.28, -0.2], [0.12, 0.34], [-0.33, -0.3], [0.44, 0.1], [-0.1, -0.43]];
  const choices = candidates.filter(([x, y]) => !tileAt(x, y) || tileAt(x, y)?.level < 2);
  const [x, y] = choices[Math.floor(Math.random() * choices.length)] || [0, 0];
  orb = { id: `orb-${Date.now()}`, x, y, until: Date.now() + 6800 };
  sendEvent("ORB_STATE", { active: true, ...orb });
  callout("搶能量球！");
}

function collectOrb(player) {
  if (!orb || !player.alive) return;
  const distance = length(player.x - orb.x, player.y - orb.y);
  if (distance > 0.105) return;
  if (isHost()) {
    const picked = { playerId: player.id, orbId: orb.id };
    applyOrbPickup(picked);
    if (!mockMode) sendEvent("ORB_PICKUP", picked);
  } else if (player.isLocal && !player.orbRequested) {
    player.orbRequested = true;
    sendEvent("ORB_PICKUP_REQUEST", { playerId: player.id, orbId: orb.id });
  }
}

function applyOrbPickup(payload) {
  if (orb && payload.orbId && payload.orbId !== orb.id) return;
  const player = players.find((candidate) => candidate.id === String(payload.playerId));
  if (!player) return;
  player.charged = true;
  player.orbs += 1;
  player.orbRequested = false;
  if (player.id === localPlayer?.id) {
    callout("強力撞擊已充能！");
    pingSound("pickup", 0.8, 1.05);
    vibrate(18);
  } else {
    addFloater(player.x, player.y - 0.1, "充能！", "#ffe087");
    pingSound("pickup", 0.35, 0.95);
  }
  spawnBurst(player.x, player.y, "#ffd86a", 18);
  orb = null;
}

function handleOrbRequest(payload) {
  if (!isHost() || !orb || payload.orbId !== orb.id) return;
  const player = players.find((candidate) => candidate.id === String(payload.playerId ?? payload.sourceId));
  if (player && length(player.x - orb.x, player.y - orb.y) < 0.17) {
    const picked = { playerId: player.id, orbId: orb.id };
    applyOrbPickup(picked);
    if (!mockMode) sendEvent("ORB_PICKUP", picked);
  }
}

function eliminatePlayer(id, reason = "落進裂縫", attackerId = "") {
  const player = players.find((candidate) => candidate.id === id);
  if (!player?.alive) return;
  player.alive = false;
  player.koReason = reason;
  player.survival = matchStartedAt ? Math.max(0, (now() - matchStartedAt) / 1000) : 0;
  spawnBurst(player.x, player.y, player.color, 26);
  addFloater(player.x, player.y - 0.1, "出局！", "#ff7896");
  if (player.id === localPlayer?.id) {
    callout("你出局了！");
    vibrate([45, 30, 45]);
  } else if (attackerId === localPlayer?.id) {
    localPlayer.knockouts += 1;
    callout("漂亮淘汰！");
    vibrate(32);
  }
  if (player.isLocal || attackerId === localPlayer?.id) pingSound("crack", 0.62, 0.86);
}

function applySnapshot(payload) {
  if (!Array.isArray(payload.players)) return;
  payload.players.forEach((snap) => {
    const player = players.find((candidate) => candidate.id === snap.id);
    if (!player || player.isLocal) return;
    player.x = Number(snap.x) || 0;
    player.y = Number(snap.y) || 0;
    player.vx = Number(snap.vx) || 0;
    player.vy = Number(snap.vy) || 0;
    player.alive = Boolean(snap.alive);
    player.charged = Boolean(snap.charged);
    player.knockouts = Number(snap.knockouts) || 0;
    player.orbs = Number(snap.orbs) || 0;
  });
  if (Array.isArray(payload.tiles)) {
    payload.tiles.forEach((snap) => {
      const tile = tiles.find((candidate) => candidate.key === snap.key);
      if (tile) {
        tile.level = clamp(Number(snap.level) || 0, 0, 3);
        tile.collapseAt = tile.level === 2 ? now() + 450 : 0;
      }
    });
  }
  if (Number.isFinite(payload.safeRadius)) safeRadius = payload.safeRadius;
  if (Object.hasOwn(payload, "orb")) orb = payload.orb ? { ...payload.orb } : null;
}

function makeSnapshot() {
  return {
    players: players.map((player) => ({
      id: player.id, x: player.x, y: player.y, vx: player.vx, vy: player.vy,
      alive: player.alive, charged: player.charged, knockouts: player.knockouts, orbs: player.orbs,
    })),
    tiles: tiles.filter((tile) => tile.level > 0).map((tile) => ({ key: tile.key, level: tile.level })),
    safeRadius,
    orb: orb ? { id: orb.id, x: orb.x, y: orb.y, until: orb.until } : null,
  };
}

function finishRound(winnerId, reason = "最後站著的人") {
  if (state === GAME_STATE.RESULT || state === GAME_STATE.EXIT) return;
  state = GAME_STATE.RESULT;
  stateStartedAt = now();
  players.forEach((player) => {
    if (player.alive) player.survival = Math.max(player.survival, (now() - matchStartedAt) / 1000);
  });
  const winner = players.find((player) => player.id === winnerId) || getStandings()[0];
  showResults(winner, reason);
  if (!gameOverCalled) {
    gameOverCalled = true;
    const reward = winner?.id === localPlayer?.id ? 10 : localPlayer?.alive ? 4 : 2;
    try { sdk.gameOver?.(reward); } catch (error) { console.warn("BoomRoom gameOver failed", error); }
  }
}

function getStandings() {
  return [...players].sort((a, b) => {
    if (a.alive !== b.alive) return Number(b.alive) - Number(a.alive);
    if (b.knockouts !== a.knockouts) return b.knockouts - a.knockouts;
    if (b.survival !== a.survival) return b.survival - a.survival;
    return b.orbs - a.orbs;
  });
}

function showResults(winner, reason) {
  $("#resultKicker").textContent = reason === "時間到" ? "加時結束" : "本局冠軍";
  $("#resultTitle").textContent = winner?.id === localPlayer?.id ? "你是最後一塊地板！" : `${winner?.name || "無人"} 獲勝`;
  const standings = getStandings().slice(0, 4);
  $("#resultList").innerHTML = standings.map((player, index) => `
    <div class="result-row">
      <span class="result-rank">0${index + 1}</span>
      <span class="result-name">${escapeHtml(player.name)}${player.id === localPlayer?.id ? "（你）" : ""}</span>
      <span class="result-meta">${player.knockouts} 淘汰 · ${Math.floor(player.survival)}秒</span>
    </div>`).join("");
  resultNode.classList.add("show");
  if (winner?.id === localPlayer?.id) {
    pingSound("pickup", 0.9, 1.18);
    vibrate([35, 25, 55]);
  }
  setTimeout(() => {
    state = GAME_STATE.EXIT;
    if (!exitSent) {
      exitSent = true;
      try { window.parent?.postMessage({ action: "leaveGame" }, "*"); } catch {}
    }
    if (window.parent === window && window.location.pathname !== "/") {
      window.location.href = "../room.html";
    } else {
      resultNode.classList.remove("show");
      state = GAME_STATE.LOADING;
      stateStartedAt = now();
      setTimeout(() => {
        if (state === GAME_STATE.LOADING) beginCountdown();
      }, 450);
    }
  }, 2700);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]);
}

function showCallout(text) {
  if (!text) return;
  calloutNode.textContent = text;
  calloutNode.classList.remove("show");
  void calloutNode.offsetWidth;
  calloutNode.classList.add("show");
  lastCallout = text;
}

function callout(text) {
  if (lastCallout !== text || now() - (calloutNode._at || 0) > 1400) {
    showCallout(text);
    calloutNode._at = now();
  }
}

function addFloater(x, y, text, color) {
  floaters.push({ x, y, text, color, born: now(), duration: 950 });
  if (floaters.length > 24) floaters.splice(0, floaters.length - 24);
}

function spawnBurst(x, y, color, count = 10) {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.18 + Math.random() * 0.78;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      born: now(),
      life: 420 + Math.random() * 440,
      size: 1.7 + Math.random() * 4.4,
    });
  }
  if (particles.length > 230) particles.splice(0, particles.length - 230);
}

function updateBot(player, time) {
  if (!isHost()) return;
  if (time > player.botThinkAt) {
    player.botThinkAt = time + 0.2 + Math.random() * 0.13;
    let target = orb ? { x: orb.x, y: orb.y } : null;
    if (!target) {
      const rivals = players.filter((candidate) => candidate.alive && candidate.id !== player.id);
      rivals.sort((a, b) => length(a.x - player.x, a.y - player.y) - length(b.x - player.x, b.y - player.y));
      const nearest = rivals[0];
      if (nearest) {
        const distance = length(nearest.x - player.x, nearest.y - player.y);
        if (distance < 0.52 && time - player.lastDashAt > 2.8) {
          beginDash(player, nearest.x - player.x, nearest.y - player.y, time);
          hostResolveBotHit(player);
        }
        target = { x: nearest.x + (Math.random() - 0.5) * 0.3, y: nearest.y + (Math.random() - 0.5) * 0.3 };
      }
    }
    if (!target || (!orb && Math.random() < 0.28)) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * Math.max(0.2, safeRadius - 0.2);
      target = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    }
    const tile = tileAt(player.x, player.y);
    if (tile?.level >= 1) {
      const awayX = player.x;
      const awayY = player.y;
      target = { x: awayX + (Math.random() - 0.5) * 1.1, y: awayY + (Math.random() - 0.5) * 1.1 };
    }
    const targetLength = length(target.x, target.y);
    if (targetLength > safeRadius * 0.8) {
      target.x *= (safeRadius * 0.72) / targetLength;
      target.y *= (safeRadius * 0.72) / targetLength;
    }
    player.botTargetX = target.x;
    player.botTargetY = target.y;
  }
  const dx = player.botTargetX - player.x;
  const dy = player.botTargetY - player.y;
  const dist = length(dx, dy);
  if (dist > 0.03) {
    player.vx += (dx / dist * 0.62 - player.vx) * 0.075;
    player.vy += (dy / dist * 0.62 - player.vy) * 0.075;
  }
  if (orb) collectOrb(player);
}

function hostResolveBotHit(attacker) {
  if (!isHost()) return;
  const dx = attacker.dashX;
  const dy = attacker.dashY;
  const victim = players.filter((player) => player.alive && player.id !== attacker.id)
    .map((player) => ({ player, d: length(player.x - attacker.x, player.y - attacker.y), facing: (player.x - attacker.x) * dx + (player.y - attacker.y) * dy }))
    .filter((item) => item.d < 0.37 && item.facing > -0.03)
    .sort((a, b) => a.d - b.d)[0]?.player;
  if (!victim) return;
  const vx = victim.x - attacker.x;
  const vy = victim.y - attacker.y;
  const d = length(vx, vy) || 1;
  const event = { attackerId: attacker.id, targetId: victim.id, dx: vx / d, dy: vy / d, force: 1.03, charged: false };
  applyHit(event);
  attacker.dashHitIds?.add(victim.id);
  if (!mockMode) sendEvent("PLAYER_HIT", event);
}

function update(dt, timestamp) {
  if (state === GAME_STATE.COUNTDOWN) {
    const elapsed = (timestamp - stateStartedAt) / 1000;
    const number = Math.ceil(3 - elapsed);
    if (number > 0) {
      if (Math.floor(3 - elapsed) !== Math.floor(3 - elapsed - dt)) {
        showCallout(String(number));
        pingSound("crack", 0.17, number === 1 ? 1.3 : 1);
      }
    } else {
      startPlaying();
    }
  }

  if (state !== GAME_STATE.PLAYING) {
    updateParticles(dt);
    updateUi(timestamp);
    return;
  }

  const elapsed = (timestamp - matchStartedAt) / 1000;
  const timeLeft = Math.max(0, MATCH_SECONDS - elapsed);
  cachedTimeLeft = timeLeft;

  if (timeLeft <= 12) {
    const progress = (12 - timeLeft) / 12;
    safeRadius = 1.03 - progress * 0.34;
  }
  if (timeLeft === 0 && !overtimeAt) {
    overtimeAt = timestamp;
    showCallout("加時！撐住！");
  }
  if (overtimeAt) {
    const over = (timestamp - overtimeAt) / 1000;
    safeRadius = Math.max(0.28, 0.69 - over * 0.034);
  }

  const host = isHost();
  const input = currentMoveInput();
  players.forEach((player) => {
    if (!player.alive) return;
    if (player.isLocal) {
      if (length(input.x, input.y) > 0.08) {
        player.faceX = input.x;
        player.faceY = input.y;
      }
      const onHit = now() < player.hitUntil;
      if (!onHit && now() >= player.dashUntil) {
        player.vx += (input.x * 0.72 - player.vx) * Math.min(1, dt * 8);
        player.vy += (input.y * 0.72 - player.vy) * Math.min(1, dt * 8);
      }
    } else if (player.isBot) {
      if (host) updateBot(player, timestamp / 1000);
    } else {
      if (player.targetX != null) {
        player.x += (player.targetX - player.x) * 0.18;
        player.y += (player.targetY - player.y) * 0.18;
      }
    }

    if (now() < player.dashUntil) {
      player.vx = player.dashX * 2.45;
      player.vy = player.dashY * 2.45;
    } else if (now() >= player.hitUntil) {
      player.vx *= Math.pow(0.08, dt);
      player.vy *= Math.pow(0.08, dt);
    } else {
      player.vx *= Math.pow(0.22, dt);
      player.vy *= Math.pow(0.22, dt);
    }

    player.x += player.vx * dt;
    player.y += player.vy * dt;
    player.flash = Math.max(0, player.flash - dt * 2.6);
    player.trail.push({ x: player.x, y: player.y, at: timestamp });
    while (player.trail.length && timestamp - player.trail[0].at > 220) player.trail.shift();

    if (player.isLocal && orb) collectOrb(player);
    if (host && player.isBot && orb) collectOrb(player);
  });

  resolveBumping();
  if (host) {
    resolveDashHits();
    maybeCrackUnderPlayers();
    if (!orb && timestamp - lastOrbAt > 7100) {
      lastOrbAt = timestamp;
      spawnOrb();
    }
    if (orb && Date.now() > orb.until) {
      orb = null;
      sendEvent("ORB_STATE", { active: false });
    }
    players.forEach((player) => {
      if (!player.alive) return;
      const tile = tileAt(player.x, player.y);
      if (Math.hypot(player.x, player.y) > safeRadius + 0.035 || tile?.level === 3) {
        const out = {
          targetId: player.id,
          reason: tile?.level === 3 ? "踩穿裂地" : "被擠出場外",
          attackerId: now() - (player.lastHitAt || 0) < 3000 ? player.lastAttackerId || "" : "",
        };
        eliminatePlayer(out.targetId, out.reason, out.attackerId);
        if (!mockMode) sendEvent("PLAYER_OUT", out);
      }
    });
    const living = players.filter((player) => player.alive);
    if (living.length <= 1) {
      const winnerId = living[0]?.id || getStandings()[0]?.id;
      sendEvent("GAME_FINISH", { winnerId, reason: "最後站著的人" });
      finishRound(winnerId, "最後站著的人");
    } else if (overtimeAt && timestamp - overtimeAt > OVERTIME_SECONDS * 1000) {
      const winner = getStandings()[0];
      sendEvent("GAME_FINISH", { winnerId: winner?.id, reason: "時間到" });
      finishRound(winner?.id, "時間到");
    }
  }

  if (host && timestamp - lastSnapshotAt > 1600) {
    lastSnapshotAt = timestamp;
    if (!mockMode) sendEvent("GAME_STATE", makeSnapshot());
  }

  if (timestamp - lastNetAt > 110) {
    lastNetAt = timestamp;
    if (localPlayer) {
      const dashing = timestamp < localPlayer.dashUntil;
      sendEvent("PLAYER_MOVE", {
        playerId: localPlayer.id,
        x: localPlayer.x, y: localPlayer.y,
        vx: localPlayer.vx, vy: localPlayer.vy,
        faceX: localPlayer.faceX, faceY: localPlayer.faceY,
        dashing,
      });
    }
    if (host) {
      const botMoves = players.filter((player) => player.isBot && player.alive).map((player) => ({
        id: player.id, x: player.x, y: player.y, vx: player.vx, vy: player.vy,
        faceX: player.faceX, faceY: player.faceY, dashing: timestamp < player.dashUntil,
      }));
      if (botMoves.length && !mockMode) sendEvent("NPC_MOVES", { players: botMoves });
    }
  }

  if (timeLeft <= 10 && timeLeft > 0 && Math.ceil(timeLeft) !== Math.ceil(timeLeft + dt)) {
    showCallout(String(Math.ceil(timeLeft)));
    pingSound("crack", 0.3, 1.15);
    if (timeLeft <= 3) vibrate(15);
  }
  updateParticles(dt);
  updateUi(timestamp);
}

function resolveBumping() {
  for (let i = 0; i < players.length; i += 1) {
    const a = players[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < players.length; j += 1) {
      const b = players[j];
      if (!b.alive) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = length(dx, dy);
      const minDistance = 0.115;
      if (distance > 0 && distance < minDistance) {
        const push = (minDistance - distance) * 0.5;
        a.x -= (dx / distance) * push;
        a.y -= (dy / distance) * push;
        b.x += (dx / distance) * push;
        b.y += (dy / distance) * push;
      }
    }
  }
}

function updateParticles(dt) {
  const current = now();
  particles = particles.filter((particle) => current - particle.born < particle.life);
  particles.forEach((particle) => {
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= Math.pow(0.14, dt);
    particle.vy *= Math.pow(0.14, dt);
  });
  floaters = floaters.filter((floater) => current - floater.born < floater.duration);
}

function updateUi(timestamp) {
  if (timestamp - lastUiAt < 100) return;
  lastUiAt = timestamp;
  const alive = players.filter((player) => player.alive);
  aliveNode.textContent = String(alive.length);
  timerNode.textContent = overtimeAt
    ? `+${Math.max(0, OVERTIME_SECONDS - Math.floor((timestamp - overtimeAt) / 1000))}`
    : String(Math.max(0, Math.ceil(cachedTimeLeft)));
  timerNode.parentElement.classList.toggle("urgent", cachedTimeLeft <= 10 || Boolean(overtimeAt));

  if (state === GAME_STATE.COUNTDOWN) placeNode.textContent = "即將開打";
  else if (state === GAME_STATE.PLAYING) {
    const livingSorted = [...alive].sort((a, b) => b.knockouts - a.knockouts || b.survival - a.survival);
    const position = livingSorted.findIndex((player) => player.id === localPlayer?.id);
    placeNode.textContent = localPlayer?.alive ? `存活第 ${Math.max(1, position + 1)} 名` : "已出局";
  }
  chargeNode.classList.toggle("ready", Boolean(localPlayer?.charged));
  chargeNode.textContent = localPlayer?.charged ? "✦ 強撞已充能" : "✦ 強撞未充能";

  const remaining = Math.max(0, 2.55 - (timestamp / 1000 - (localPlayer?.lastDashAt ?? -99)));
  dashButton.classList.toggle("cooling", remaining > 0);
  cooldownNode.style.borderTopColor = remaining > 0 ? "rgba(112, 72, 69, .9)" : "transparent";
  cooldownNode.style.transform = `rotate(${360 * (1 - remaining / 2.55)}deg)`;
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function worldToScreen(x, y) {
  const radius = board.side * 0.44;
  return { x: board.x + x * radius, y: board.y + y * radius };
}

function drawBackground() {
  const gradient = ctx.createRadialGradient(canvasWidth / 2, board.y, 5, canvasWidth / 2, board.y, board.side * 0.86);
  gradient.addColorStop(0, "rgba(78, 92, 169, .18)");
  gradient.addColorStop(1, "rgba(33, 39, 83, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.save();
  ctx.globalAlpha = 0.13;
  for (let i = 0; i < 22; i += 1) {
    const seedX = (i * 71 + 22) % Math.max(1, canvasWidth);
    const seedY = (i * 131 + 90) % Math.max(1, canvasHeight);
    const pulse = 1.5 + Math.sin(now() / 1200 + i) * 0.8;
    ctx.fillStyle = i % 2 ? "#8effe2" : "#a1aaff";
    ctx.beginPath();
    ctx.arc(seedX, seedY, pulse, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawBoard(timestamp) {
  const side = board.side;
  const unit = side * 0.88;
  const tileSize = unit / GRID_SIZE;
  ctx.save();

  ctx.beginPath();
  ctx.ellipse(board.x, board.y + 12, unit * 0.53, unit * 0.49, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(3, 5, 23, .55)";
  ctx.shadowColor = "rgba(0, 0, 0, .55)";
  ctx.shadowBlur = 28;
  ctx.fill();
  ctx.shadowBlur = 0;

  tiles.forEach((tile, index) => {
    const point = worldToScreen(tile.x, tile.y);
    const size = tileSize * 0.94;
    if (tile.level === 3) {
      ctx.fillStyle = "rgba(7, 9, 30, .45)";
      ctx.beginPath();
      ctx.ellipse(point.x, point.y + 6, size * 0.44, size * 0.26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(91, 108, 174, .16)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(point.x, point.y, size * 0.26 + Math.sin(timestamp / 280 + index) * 2, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }

    const warning = tile.level === 2;
    const cracked = tile.level === 1;
    const pulse = warning ? 0.55 + Math.sin(timestamp / 70 + index) * 0.28 : 0;
    const y = point.y + 3 + (warning ? Math.sin(timestamp / 90 + index) * 1.5 : 0);
    roundedRect(ctx, point.x - size / 2, y - size / 2 + 4, size, size, Math.max(6, size * 0.19));
    ctx.fillStyle = warning ? `rgba(255, 99, 136, ${0.26 + pulse * 0.22})` : "rgba(4, 7, 30, .46)";
    ctx.fill();
    roundedRect(ctx, point.x - size / 2, y - size / 2, size, size * 0.88, Math.max(6, size * 0.19));
    const tileGradient = ctx.createLinearGradient(point.x, y - size / 2, point.x, y + size / 2);
    if (warning) {
      tileGradient.addColorStop(0, `rgb(120, ${Math.floor(69 + pulse * 26)}, 106)`);
      tileGradient.addColorStop(1, "rgb(82, 48, 103)");
    } else if (cracked) {
      tileGradient.addColorStop(0, "rgb(64, 78, 143)");
      tileGradient.addColorStop(1, "rgb(47, 57, 115)");
    } else {
      tileGradient.addColorStop(0, index % 2 ? "rgb(60, 72, 133)" : "rgb(55, 67, 128)");
      tileGradient.addColorStop(1, index % 2 ? "rgb(43, 53, 107)" : "rgb(40, 51, 104)");
    }
    ctx.fillStyle = tileGradient;
    ctx.fill();
    ctx.strokeStyle = warning ? `rgba(255, 135, 165, ${0.5 + pulse * 0.3})` : "rgba(148, 164, 233, .16)";
    ctx.lineWidth = warning ? 2 : 1;
    ctx.stroke();

    if (cracked || warning) {
      ctx.save();
      ctx.strokeStyle = warning ? "rgba(255, 190, 201, .84)" : "rgba(171, 190, 255, .72)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(point.x - size * 0.21, point.y - size * 0.25);
      ctx.lineTo(point.x - size * 0.01, point.y - size * 0.02);
      ctx.lineTo(point.x - size * 0.12, point.y + size * 0.06);
      ctx.lineTo(point.x + size * 0.2, point.y + size * 0.25);
      ctx.moveTo(point.x - size * 0.01, point.y - size * 0.02);
      ctx.lineTo(point.x + size * 0.14, point.y - size * 0.21);
      ctx.stroke();
      ctx.restore();
    }
  });

  const ring = board.side * 0.44 * safeRadius;
  ctx.save();
  ctx.setLineDash([8, 8]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = cachedTimeLeft <= 12 ? "rgba(255, 110, 145, .65)" : "rgba(128, 240, 215, .24)";
  ctx.beginPath();
  ctx.ellipse(board.x, board.y, ring, ring * 0.96, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  if (orb) drawOrb(orb, timestamp);
  ctx.restore();
}

function drawOrb(item, timestamp) {
  const point = worldToScreen(item.x, item.y);
  const pulse = 1 + Math.sin(timestamp / 95) * 0.11;
  ctx.save();
  ctx.translate(point.x, point.y - 8 - Math.sin(timestamp / 220) * 3);
  ctx.shadowColor = "rgba(255, 207, 87, .9)";
  ctx.shadowBlur = 20;
  ctx.fillStyle = "rgba(255, 215, 103, .2)";
  ctx.beginPath();
  ctx.arc(0, 0, 22 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(timestamp / 1200);
  ctx.fillStyle = "#ffe487";
  ctx.strokeStyle = "#fff7ce";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const radius = i % 2 ? 8 : 13;
    ctx.lineTo(Math.cos(angle) * radius * pulse, Math.sin(angle) * radius * pulse);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPlayer(player, timestamp) {
  if (!player.alive) return;
  const point = worldToScreen(player.x, player.y);
  const radius = Math.max(12, board.side * 0.025);
  const jumping = timestamp < player.dashUntil;
  const bob = Math.sin(timestamp / 115 + players.indexOf(player) * 2) * 1.5;
  const lift = jumping ? 9 : 0;
  const invincible = player.invulnerableUntil > now();
  const blink = invincible && Math.floor(timestamp / 65) % 2 === 0;

  if (player.trail.length > 1 && (jumping || player.isLocal && length(player.vx, player.vy) > 0.8)) {
    ctx.save();
    player.trail.forEach((step, index) => {
      const alpha = index / player.trail.length * 0.24;
      const trailPoint = worldToScreen(step.x, step.y);
      ctx.fillStyle = colorWithAlpha(player.color, alpha);
      ctx.beginPath();
      ctx.arc(trailPoint.x, trailPoint.y, radius * (0.35 + alpha), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = blink ? 0.3 : 1;
  ctx.fillStyle = "rgba(3, 5, 20, .55)";
  ctx.beginPath();
  ctx.ellipse(point.x, point.y + radius * 0.85, radius * 1.02, radius * 0.46, 0, 0, Math.PI * 2);
  ctx.fill();

  if (player.charged) {
    ctx.strokeStyle = `rgba(255, 219, 113, ${0.65 + Math.sin(timestamp / 90) * 0.22})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(point.x, point.y - lift + bob, radius * 1.34, 0, Math.PI * 2);
    ctx.stroke();
  }

  const bodyY = point.y - lift + bob;
  ctx.translate(point.x, bodyY);
  if (player.flash > 0) ctx.scale(1 + player.flash * 0.22, 1 - player.flash * 0.2);

  ctx.fillStyle = colorWithAlpha(player.color, 0.24);
  ctx.beginPath();
  ctx.ellipse(0, radius * 0.35, radius * 1.08, radius * 0.94, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = player.flash > 0.2 ? "#fff" : player.color;
  ctx.strokeStyle = "rgba(255,255,255,.75)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.86, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const directionX = player.faceX || 1;
  const directionY = player.faceY || 0;
  const angle = Math.atan2(directionY, directionX);
  const eyeOffsetX = Math.cos(angle) * radius * 0.2;
  const eyeOffsetY = Math.sin(angle) * radius * 0.2;
  ctx.fillStyle = "#20264a";
  ctx.beginPath();
  ctx.arc(eyeOffsetX - Math.sin(angle) * radius * 0.2, eyeOffsetY + Math.cos(angle) * radius * 0.2, radius * 0.095, 0, Math.PI * 2);
  ctx.arc(eyeOffsetX + Math.sin(angle) * radius * 0.2, eyeOffsetY - Math.cos(angle) * radius * 0.2, radius * 0.095, 0, Math.PI * 2);
  ctx.fill();

  if (jumping) {
    ctx.strokeStyle = "#fff5bf";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-radius * 0.12, -radius * 1.1);
    ctx.lineTo(radius * 0.34, -radius * 1.42);
    ctx.stroke();
  }

  ctx.restore();

  if (player.isLocal) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(point.x, point.y - radius * 1.9 - lift);
    ctx.lineTo(point.x - 4, point.y - radius * 2.35 - lift);
    ctx.lineTo(point.x + 4, point.y - radius * 2.35 - lift);
    ctx.closePath();
    ctx.fill();
  }

  ctx.save();
  ctx.font = `700 ${Math.max(9, Math.min(12, board.side * 0.024))}px "Noto Sans TC", Outfit, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = player.isLocal ? `${player.name} · 你` : player.name;
  const labelY = point.y + radius * 1.18;
  const width = ctx.measureText(label).width + 13;
  roundedRect(ctx, point.x - width / 2, labelY - 8, width, 16, 7);
  ctx.fillStyle = player.isLocal ? "rgba(31, 42, 77, .88)" : "rgba(15, 20, 48, .76)";
  ctx.fill();
  ctx.fillStyle = player.isLocal ? "#ffffff" : "rgba(232, 238, 255, .9)";
  ctx.fillText(label, point.x, labelY);
  ctx.restore();
}

function drawEffects(timestamp) {
  particles.forEach((particle) => {
    const life = clamp(1 - (timestamp - particle.born) / particle.life, 0, 1);
    const point = worldToScreen(particle.x, particle.y);
    ctx.globalAlpha = life;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, particle.size * (0.4 + life * 0.65), 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
  floaters.forEach((floater) => {
    const progress = (timestamp - floater.born) / floater.duration;
    const point = worldToScreen(floater.x, floater.y - progress * 0.19);
    ctx.globalAlpha = 1 - progress;
    ctx.textAlign = "center";
    ctx.font = `900 ${Math.max(13, board.side * 0.044)}px "Noto Sans TC", Outfit, system-ui, sans-serif`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(20, 24, 61, .8)";
    ctx.strokeText(floater.text, point.x, point.y);
    ctx.fillStyle = floater.color;
    ctx.fillText(floater.text, point.x, point.y);
  });
  ctx.globalAlpha = 1;
}

function draw(timestamp) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  drawBackground();
  if (screenShake > 0.1) {
    ctx.save();
    const amount = screenShake * (0.45 + Math.random() * 0.55);
    ctx.translate((Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount);
    screenShake *= 0.86;
    drawBoard(timestamp);
    players.forEach((player) => drawPlayer(player, timestamp));
    drawEffects(timestamp);
    ctx.restore();
  } else {
    drawBoard(timestamp);
    players.forEach((player) => drawPlayer(player, timestamp));
    drawEffects(timestamp);
  }
}

function frame(timestamp) {
  const dt = Math.min(0.034, Math.max(0, (timestamp - (lastFrameAt || timestamp)) / 1000));
  lastFrameAt = timestamp;
  update(dt, timestamp);
  draw(timestamp);
  requestAnimationFrame(frame);
}

boot().catch((error) => {
  console.error("Game initialization failed; starting offline fallback.", error);
  if (!players.length) {
    players = normalizeRoster([], null);
    localPlayer = players[0];
    for (let row = 0; row < GRID_SIZE; row += 1) {
      for (let col = 0; col < GRID_SIZE; col += 1) {
        const x = ((col + 0.5) / GRID_SIZE) * 2 - 1;
        const y = ((row + 0.5) / GRID_SIZE) * 2 - 1;
        if (Math.hypot(x, y) < 1.055) tiles.push({ col, row, x, y, level: 0, collapseAt: 0, key: `${col}:${row}` });
      }
    }
  }
  installControls();
  resizeCanvas();
  beginCountdown();
  requestAnimationFrame(frame);
});
