const canvas = document.querySelector("#game-canvas");
const ctx = canvas.getContext("2d", { alpha: false });
const timerEl = document.querySelector("#timer");
const myScoreEl = document.querySelector("#my-score");
const leaderboardEl = document.querySelector("#leaderboard");
const countdownEl = document.querySelector("#countdown");
const countdownNumberEl = document.querySelector("#countdown-number");
const resultScreenEl = document.querySelector("#result-screen");
const resultTitleEl = document.querySelector("#result-title");
const resultScoreEl = document.querySelector("#result-score");
const resultScoreLabelEl = document.querySelector("#result-score-label");
const resultRankingEl = document.querySelector("#result-ranking");
const resultNextEl = document.querySelector("#result-next");
const toastEl = document.querySelector("#event-toast");
const matchRoundEl = document.querySelector("#match-round");
const mapNameEl = document.querySelector("#map-name");
const roundBannerEl = document.querySelector("#round-banner");
const joystickEl = document.querySelector("#joystick");
const joystickKnobEl = document.querySelector("#joystick-knob");
const jumpControlEl = document.querySelector("#jump-control");
const jumpMeterFillEl = document.querySelector("#jump-meter-fill");

const ROUND_SECONDS = 60;
const MATCH_ROUNDS = 5;
const MAX_PARTICLES = 180;
const ARENA_EDGE = 0.89;
const MAPS = [
  { name: "迷你", scale: 0.84 },
  { name: "標準", scale: 1 },
  { name: "大型", scale: 1.13 },
  { name: "精簡", scale: 0.92 },
  { name: "巨型", scale: 1.2 }
];
const COLORS = ["#76f2c3", "#ff778d", "#ffd16b", "#93a5ff", "#ff9a63", "#df85ff", "#63daf0", "#e8ef7b", "#f78cc1", "#a5ed9c"];
const NAMES = ["你", "火花", "彈彈", "小旋風", "果凍", "星塵", "泡泡", "跳跳", "豆豆", "流星"];
const AUDIO = {
  jump: new Audio("./sfx/jump.wav"),
  collect: new Audio("./sfx/collect.wav"),
  hit: new Audio("./sfx/hit.wav"),
  ambience: new Audio("./sfx/ambience.wav")
};
AUDIO.ambience.loop = true;
AUDIO.ambience.volume = 0.17;
AUDIO.jump.volume = 0.43;
AUDIO.collect.volume = 0.5;
AUDIO.hit.volume = 0.5;

const sdk = window.BoomRoomSDK || null;
const input = { x: 0, y: 0, charging: false, chargeStartedAt: 0, pointer: null, joyPointer: null };
const entities = [];
const orbs = [];
const particles = [];
const remoteState = new Map();
const hitCooldowns = new Map();
let state = "LOADING";
let canvasW = 0;
let canvasH = 0;
let dpr = 1;
let lastFrameAt = performance.now();
let lastHudAt = 0;
let lastSendAt = 0;
let lastSoundAt = 0;
let gameSeed = 0;
let randomState = 0;
let localId = "mock-you";
let localPlayer = null;
let isHost = true;
let isMock = !sdk;
let roomId = "mock-room";
let roundStartedAt = 0;
let countdownStartedAt = 0;
let endSent = false;
let gameOverCalled = false;
let exitTimer = 0;
let roundElapsed = 0;
let matchRound = 1;
let currentMap = MAPS[0];
const matchWins = new Map();
const matchPoints = new Map();
let surgeUntil = 0;
let surgeIndex = 0;
let lastBonusAt = 0;
let lastCountdownBeat = -1;
let toastUntil = 0;
let hintShown = true;
let localRequestedPlayers = 0;
let bonusOrbCounter = 0;

const ambience = AUDIO.ambience;
for (const audio of Object.values(AUDIO)) {
  audio.preload = "auto";
}

function safeVibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch (_) {}
}

function playSound(name, cooldown = 0) {
  const now = performance.now();
  if (cooldown && now - lastSoundAt < cooldown) return;
  const source = AUDIO[name];
  if (!source) return;
  try {
    const sound = source.cloneNode();
    sound.volume = source.volume;
    sound.play().catch(() => {});
    if (cooldown) lastSoundAt = now;
  } catch (_) {}
}

function unlockAudio() {
  try { ambience.play().catch(() => {}); } catch (_) {}
}

function random() {
  randomState = (randomState * 1664525 + 1013904223) >>> 0;
  return randomState / 4294967296;
}

function seedRandom(seed) {
  randomState = (seed >>> 0) || 1;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function keepPlayerInArena(player) {
  const radius = Math.hypot(player.x, player.y);
  if (radius <= ARENA_EDGE) return;

  const nx = player.x / radius;
  const ny = player.y / radius;
  player.x = nx * ARENA_EDGE;
  player.y = ny * ARENA_EDGE;

  // Remove only the velocity that points out through the rim, preserving
  // movement along it so players don't snap or slide off the platform.
  const outwardSpeed = player.vx * nx + player.vy * ny;
  if (outwardSpeed > 0) {
    player.vx -= outwardSpeed * nx;
    player.vy -= outwardSpeed * ny;
  }
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function makePlayer({ id, name, color, local = false, bot = false }, index) {
  const angle = index * Math.PI * 2 / Math.max(4, 8);
  const radius = index === 0 ? 0 : 0.43;
  return {
    id: String(id),
    name: bot?`🤖 ${name||`跳球 ${index+1}`} AI`:(name || `Player ${index + 1}`),
    color: color || COLORS[index % COLORS.length],
    local,
    bot,
    disconnected: false,
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius * 0.8,
    vx: 0,
    vy: 0,
    z: 0,
    vz: 0,
    grounded: true,
    moveX: 0,
    moveY: 0,
    score: 0,
    combo: 0,
    lastScoreAt: -100,
    stun: 0,
    invulnerableUntil: 0,
    charge: 0,
    isCharging: false,
    nextJumpAt: 0,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    targetVx: 0,
    targetVy: 0,
    targetVz: 0,
    lastNetworkAt: 0,
    botThinkAt: 0,
    botTargetX: 0,
    botTargetY: 0,
    botWander: random() * Math.PI * 2,
    bob: random() * Math.PI * 2,
    flash: 0
  };
}

function getUserIdentity(user) {
  if (!user) return null;
  return {
    id: user.id || user.userId || user.playerId || user.clientId || user.username || user.name,
    name: user.username || user.displayName || user.name || "玩家",
    avatar: user.avatar_url || null
  };
}

function roomPlayerEntries() {
  if (!sdk) return [];
  const readers = [
    () => sdk.roomPlayers,
    () => sdk.players,
    () => sdk.room?.players,
    () => sdk.getRoomPlayers?.(),
    () => sdk.getPlayers?.()
  ];
  for (const read of readers) {
    try {
      let source = read();
      if (typeof source === "function") source = source.call(sdk);
      if (source && typeof source.then === "function") continue;
      if (Array.isArray(source)) return source;
      if (source instanceof Map) {
        return Array.from(source.entries(), ([id, entry]) => ({ ...entry, id: entry?.id || id }));
      }
      if (source && typeof source === "object") {
        return Object.entries(source).map(([id, entry]) => ({ ...entry, id: entry?.id || id }));
      }
    } catch (error) {
      console.warn("BoomRoom player roster unavailable", error);
    }
  }
  return [];
}

function roomPlayerList() {
  return roomPlayerEntries().map((entry, index) => {
    const user = entry?.user || entry?.player || entry;
    const identity = getUserIdentity(user) || {};
    return {
      id: String(entry?.playerId || entry?.clientId || entry?.id || identity.id || `room-player-${index}`),
      name: identity.name || entry?.username || entry?.name || `玩家 ${index + 1}`,
      color: COLORS[index % COLORS.length],
      isLocal: Boolean(entry?.isLocal || entry?.isSelf || entry?.isCurrentUser || user?.isLocal)
    };
  });
}

function addMockPlayerRoster() {
  const queryCount = Number(new URLSearchParams(location.search).get("players"));
  localRequestedPlayers = clamp(Number.isFinite(queryCount) && queryCount > 0 ? Math.floor(queryCount) : 5, 1, 10);
  const roster = [{ id: localId, name: "你", color: COLORS[0], local: true, bot: false }];
  for (let i = 1; i < localRequestedPlayers; i++) {
    roster.push({ id: `cpu-${i}`, name: NAMES[i] || `跳球 ${i}`, color: COLORS[i % COLORS.length], local: false, bot: true });
  }
  const fillerCount = localRequestedPlayers === 1 ? 3 : 0;
  for (let i = 0; i < fillerCount; i++) {
    const index = roster.length;
    roster.push({ id: `cpu-${index}`, name: NAMES[index] || `跳球 ${index}`, color: COLORS[index % COLORS.length], local: false, bot: true });
  }
  return roster;
}

function initializePlayers() {
  if (!isMock) {
    syncRoomRoster();
    return;
  }
  const roster = addMockPlayerRoster();
  roster.slice(0, 10).forEach((entry, index) => {
    const player = makePlayer({
      ...entry,
      local: String(entry.id) === String(localId),
      bot: Boolean(entry.bot)
    }, index);
    entities.push(player);
    if (player.local) localPlayer = player;
  });
  if (!localPlayer) {
    localPlayer = entities[0];
    if (localPlayer) localPlayer.local = true;
  }
  if (entities.length === 0) {
    localPlayer = makePlayer({ id: localId, name: "你", local: true }, 0);
    entities.push(localPlayer);
  }
}

function syncRoomRoster() {
  if (!sdk) return;
  const roster = roomPlayerList();
  const localEntry = roster.find(entry => entry.isLocal);
  if (localEntry && localEntry.id !== localId) {
    const previousLocal = findPlayer(localId);
    const duplicate = findPlayer(localEntry.id);
    localId = localEntry.id;
    if (previousLocal && !duplicate) previousLocal.id = localId;
    else if (previousLocal && previousLocal !== duplicate) {
      const oldIndex = entities.indexOf(previousLocal);
      if (oldIndex >= 0) entities.splice(oldIndex, 1);
    }
  }

  const visibleRoster = roster.slice(0, 10);
  const visibleIds = new Set(visibleRoster.map(entry => entry.id));
  for (const player of entities) {
    if (
      !player.bot &&
      player.id !== localId &&
      player.lastNetworkAt > 0 &&
      performance.now() - player.lastNetworkAt <= 5500 &&
      !visibleIds.has(player.id) &&
      visibleRoster.length < 10
    ) {
      visibleRoster.push({ id: player.id, name: player.name, color: player.color });
      visibleIds.add(player.id);
    }
  }
  if (!visibleIds.has(localId)) {
    if (visibleRoster.length >= 10) visibleRoster.pop();
    visibleRoster.unshift({ id: localId, name: "你", color: COLORS[0], isLocal: true });
  }
  const activeIds = new Set();
  visibleRoster.slice(0, 10).forEach((entry, index) => {
    const id = String(entry.id);
    activeIds.add(id);
    let player = findPlayer(id);
    if (!player) {
      player = makePlayer({ ...entry, bot: false }, entities.length);
      entities.push(player);
    }
    player.name = entry.name || player.name;
    player.color = entry.color || player.color;
    player.bot = false;
    player.local = id === localId;
    player.disconnected = false;
    if (player.local) localPlayer = player;
  });

  for (const player of entities) {
    if (!player.bot && !activeIds.has(player.id)) player.disconnected = true;
  }

  const humanCount = activeIds.size;
  const wantedBots = humanCount === 1 ? 4 : 0;
  const bots = entities.filter(player => player.bot);
  while (bots.length > wantedBots) {
    const bot = bots.pop();
    const index = entities.indexOf(bot);
    if (index >= 0) entities.splice(index, 1);
  }
  for (let i = bots.length; i < wantedBots; i++) {
    const id = `cpu-fill-${i}`;
    if (findPlayer(id)) continue;
    entities.push(makePlayer({
      id,
      name: NAMES[i + 1] || `跳球 ${i + 1}`,
      color: COLORS[(i + 1) % COLORS.length],
      bot: true
    }, entities.length));
  }
  if (!localPlayer) localPlayer = findPlayer(localId) || entities[0] || null;
  if (localPlayer) localPlayer.local = true;
}

function announce(text, urgent = false) {
  toastEl.textContent = text;
  toastEl.classList.remove("pop");
  void toastEl.offsetWidth;
  toastEl.classList.add("pop");
  toastUntil = performance.now() + 1000;
  if (urgent) safeVibrate([35, 40, 60]);
}

function prepareMatchRound(roundNumber = 1, seed = gameSeed) {
  matchRound = clamp(Math.floor(Number(roundNumber) || 1), 1, MATCH_ROUNDS);
  currentMap = MAPS[(matchRound - 1) % MAPS.length];
  matchRoundEl.textContent = `第 ${matchRound} / ${MATCH_ROUNDS} 戰`;
  mapNameEl.textContent = `${currentMap.name}地圖`;
  input.x = 0;
  input.y = 0;
  input.charging = false;
  input.pointer = null;
  heldKeys.clear();
  jumpControlEl.classList.remove("charging");
  resetJoystick();
  gameSeed = (Number(seed) >>> 0) || gameSeed || 1;
  seedRandom(gameSeed);
  roundElapsed = 0;
  surgeUntil = 0;
  surgeIndex = 0;
  lastBonusAt = 0;
  bonusOrbCounter = 0;
  endSent = false;
  hitCooldowns.clear();
  particles.length = 0;
  entities.forEach((player, index) => {
    const angle = index * Math.PI * 2 / Math.max(4, entities.length);
    const radius = index === 0 ? 0 : 0.36;
    player.x = Math.cos(angle) * radius;
    player.y = Math.sin(angle) * radius * 0.8;
    player.vx = 0;
    player.vy = 0;
    player.z = 0;
    player.vz = 0;
    player.grounded = true;
    player.score = 0;
    player.combo = 0;
    player.lastScoreAt = -100;
    player.moveX = 0;
    player.moveY = 0;
    player.stun = 0;
    player.invulnerableUntil = 0;
    player.charge = 0;
    player.isCharging = false;
    player.botThinkAt = 0;
    player.lastNetworkAt = 0;
    player.targetX = player.x;
    player.targetY = player.y;
    player.targetZ = 0;
  });
  resetOrbs();
}

function setCountdown(value) {
  countdownNumberEl.textContent = value;
  countdownNumberEl.style.animation = "none";
  void countdownNumberEl.offsetWidth;
  countdownNumberEl.style.animation = "";
}

function beginCountdown(startAt = Date.now()) {
  if (state === "PLAYING" || state === "EXIT") return;
  state = "COUNTDOWN";
  countdownStartedAt = startAt;
  roundStartedAt = startAt + 3000;
  lastCountdownBeat = -1;
  resultScreenEl.classList.remove("show");
  countdownEl.classList.remove("is-hidden");
  if (isHost) broadcast("ROUND_START", {
    startAt, seed: gameSeed, duration: ROUND_SECONDS,
    roundNumber: matchRound, mapIndex: matchRound - 1
  });
}

function enterPlay() {
  if (state !== "COUNTDOWN") return;
  state = "PLAYING";
  countdownEl.classList.add("is-hidden");
  announce("跳！");
  safeVibrate(25);
}

function cloneOrbAt(x, y, value = 1, golden = false, id = null) {
  return {
    id: id || `${Math.floor(roundElapsed * 10)}-${Math.floor(random() * 1e8)}`,
    x: clamp(x, -0.76, 0.76),
    y: clamp(y, -0.66, 0.66),
    value,
    golden,
    active: true,
    spin: random() * Math.PI * 2,
    pulse: random() * Math.PI * 2
  };
}

function resetOrbs() {
  orbs.length = 0;
  for (let i = 0; i < 9; i++) {
    const angle = random() * Math.PI * 2;
    const radius = 0.18 + random() * 0.56;
    orbs.push(cloneOrbAt(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.78, 1, false, `orb-${gameSeed}-${i}`));
  }
}

function getMe() {
  return localPlayer || entities[0];
}

function findPlayer(id) {
  return entities.find(player => player.id === String(id));
}

function broadcast(eventName, payload = {}) {
  if (!sdk || typeof sdk.sendGameEvent !== "function") return;
  try {
    sdk.sendGameEvent(eventName, { roomId, senderId: localId, sentAt: Date.now(), ...payload });
  } catch (error) {
    console.warn("BoomRoom event send failed", error);
  }
}

function normalizeIncoming(event) {
  let detail = event?.detail ?? event;
  if (detail?.data && !detail.eventName && !detail.name && !detail.type) detail = detail.data;
  if (detail?.detail) detail = detail.detail;
  const eventName = detail?.eventName || detail?.name || detail?.type || detail?.event;
  const payload = detail?.payload || detail?.data || detail?.detail || {};
  if (typeof eventName === "string") return { eventName, payload };
  if (typeof detail === "string") {
    try {
      const parsed = JSON.parse(detail);
      return normalizeIncoming(parsed);
    } catch (_) {}
  }
  return null;
}

function applyNetworkState(payload) {
  const playerId = String(payload.playerId || payload.id || "");
  if (!playerId || playerId === String(localId)) return;
  let player = findPlayer(playerId);
  if (!player) {
    const roomEntry = roomPlayerList().find(entry => entry.id === playerId);
    if (entities.length >= 10) {
      const replaceIndex = entities.findIndex(candidate => candidate.bot || candidate.disconnected);
      if (replaceIndex < 0) return;
      if (entities[replaceIndex] === localPlayer) return;
      entities.splice(replaceIndex, 1);
    }
    const index = entities.length;
    player = makePlayer({
      ...(roomEntry || {}),
      id: playerId,
      name: payload.playerName || payload.name || roomEntry?.name || `玩家 ${index + 1}`,
      bot: false
    }, index);
    entities.push(player);
  }
  if (!player || player.local) return;
  const sentAt = Number(payload.timestamp) || Date.now();
  if (sentAt < player.lastNetworkAt) return;
  player.lastNetworkAt = sentAt;
  player.targetX = Number(payload.x) || 0;
  player.targetY = Number(payload.y) || 0;
  player.targetZ = Math.max(0, Number(payload.z) || 0);
  player.targetVx = Number(payload.vx) || 0;
  player.targetVy = Number(payload.vy) || 0;
  player.targetVz = Number(payload.vz) || 0;
  player.score = Math.max(0, Number(payload.score) || 0);
  player.combo = Math.max(0, Number(payload.combo) || 0);
  player.disconnected = false;
  player.lastNetworkAt = performance.now();
}

function onGameEvent(event) {
  const incoming = normalizeIncoming(event);
  if (!incoming) return;
  const { eventName, payload } = incoming;
  if (payload.roomId && roomId !== "mock-room" && String(payload.roomId) !== String(roomId)) return;
  if (payload.senderId && String(payload.senderId) === String(localId)) return;
  switch (eventName) {
    case 'PLAYER_READY':
      if(isHost&&['COUNTDOWN','PLAYING'].includes(state))broadcast('ROUND_START',{roundNumber:matchRound,seed:gameSeed,startAt:countdownStartedAt});
      break;
    case "ROUND_START":
      if(Number(payload.roundNumber)===matchRound&&Number(payload.startAt)===countdownStartedAt)break;
      prepareMatchRound(Number(payload.roundNumber) || 1, payload.seed);
      state='LOADING';
      beginCountdown(Number(payload.startAt) || Date.now());
      break;
    case "PLAYER_STATE":
      applyNetworkState(payload);
      break;
    case "ORB_SPAWN": {
      if (!orbs.some(orb => orb.id === payload.orbId)) {
        orbs.push(cloneOrbAt(Number(payload.x) || 0, Number(payload.y) || 0, Number(payload.value) || 1, Boolean(payload.golden), payload.orbId));
      }
      break;
    }
    case "ORB_REQUEST": {
      if (!isHost || !sdk) break;
      const orb = orbs.find(item => item.id === payload.orbId && item.active);
      const player = findPlayer(payload.playerId);
      if (orb && player && distance(player, orb) < 0.16 && player.z < 0.28) {
        collectOrb(player, orb, roundElapsed);
      }
      break;
    }
    case "ORB_CLAIMED": {
      const orb = orbs.find(item => item.id === payload.orbId);
      if (orb) orb.active = false;
      const player = findPlayer(payload.playerId);
      if (player) {
        player.score = Math.max(player.score, Number(payload.score) || player.score);
        player.combo = Number(payload.combo) || player.combo;
        if (player.local) {
          announce(payload.combo > 1 ? `✦ ${payload.combo}連擊！` : `+${payload.value || 1} 能量`);
          playSound("collect");
          safeVibrate(18);
        }
      }
      break;
    }
    case "PLAYER_HIT": {
      const victim = findPlayer(payload.victimId);
      const attacker = findPlayer(payload.attackerId);
      if (victim) {
        victim.score = Math.max(0, Number(payload.victimScore) || 0);
        victim.x = Number(payload.x) || victim.x;
        victim.y = Number(payload.y) || victim.y;
        victim.z = 0;
        victim.vz = 0;
        victim.grounded = true;
        victim.stun = 0.7;
        victim.invulnerableUntil = performance.now() + 1250;
        victim.flash = 0.5;
        if (victim.local) {
          announce("被踩到了！", true);
          playSound("hit", 170);
        }
      }
      if (attacker) {
        attacker.score = Math.max(0, Number(payload.attackerScore) || attacker.score);
        attacker.vz = 1.8;
        attacker.z = Math.max(attacker.z, 0.15);
        attacker.grounded = false;
        if (attacker.local) {
          announce("漂亮踩踏！ +2");
          playSound("hit", 170);
          safeVibrate([20, 25, 45]);
        }
      }
      break;
    }
    case "ROUND_SURGE":
      surgeUntil = performance.now() + Math.max(0, Number(payload.duration) || 6) * 1000;
      surgeIndex = Number(payload.index) || surgeIndex + 1;
      announce("魔力湧動！能量加倍");
      safeVibrate(24);
      break;
    case "ROUND_END":
      for (const [playerId, score] of payload.scores || []) {
        const player = findPlayer(playerId);
        if (player) player.score = Math.max(0, Number(score) || 0);
      }
      finishRound(payload.winnerId, true);
      break;
    case "PLAYER_LEFT": {
      const player = findPlayer(payload.playerId);
      if (player) player.disconnected = true;
      break;
    }
  }
}

function bindGameEvents() {
  if(sdk?.onGameEvent){
    const hostId=String(sdk.getSession()?.hostId||'');
    const controls=new Set(['ROUND_START','ORB_SPAWN','ORB_CLAIMED','PLAYER_HIT','ROUND_SURGE','ROUND_END']);
    sdk.onGameEvent((eventName,payload,sender)=>{
      sender=String(sender||'');
      if(!sdk.roomPlayers.some(player=>String(player.id)===sender))return;
      if(controls.has(eventName)&&sender!==hostId)return;
      if(['PLAYER_STATE','ORB_REQUEST'].includes(eventName)&&String(payload?.playerId)!==sender)return;
      onGameEvent({eventName,payload:{...payload,senderId:sender}});
    });
    return;
  }
  window.addEventListener("gameEventReceived", onGameEvent);
  if (sdk?.addEventListener) {
    try { sdk.addEventListener("gameEventReceived", onGameEvent); } catch (_) {}
  }
  if (sdk?.on) {
    try { sdk.on("gameEventReceived", onGameEvent); } catch (_) {}
  }
}

function resolveBootIdentity() {
  if (!sdk) {
    isMock = true;
    isHost = true;
    roomId = "mock-room";
    localId = "mock-you";
    return Promise.resolve();
  }
  isMock = false;
  isHost = Boolean(sdk.isHost);
  roomId = String(sdk.roomId || "boomroom");
  const timeout = new Promise(resolve => setTimeout(resolve, 900));
  const getUser = typeof sdk.getUser === "function" ? Promise.resolve(sdk.getUser()) : Promise.resolve(null);
  return Promise.race([getUser, timeout]).then(user => {
    const identity = getUserIdentity(user);
    const roomPlayers = roomPlayerList();
    const sdkLocalId =
      sdk.localPlayerId ||
      sdk.currentPlayerId ||
      sdk.playerId ||
      sdk.userId ||
      sdk.currentPlayer?.id ||
      sdk.localPlayer?.id ||
      sdk.me?.id;
    const markedLocal = roomPlayers.find(player => player.isLocal);
    localId = String(markedLocal?.id || sdkLocalId || identity?.id || `guest-${Math.random().toString(36).slice(2, 8)}`);
    if (identity?.name) {
      const me = roomPlayers.find(player => player.id === localId);
      if (me) me.name = identity.name;
    }
  });
}

function startRound() {
  initializePlayers();
  gameSeed = ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1;
  prepareMatchRound(1, gameSeed);
  if (!sdk || isHost) {
    beginCountdown(Date.now());
  } else {
    state = "LOADING";
    countdownEl.classList.add("is-hidden");
    announce('等待房主同步開局');
    broadcast('PLAYER_READY',{playerId:localId});
  }
}

function startNextMatchRound() {
  if (matchRound >= MATCH_ROUNDS || state !== "RESULT" || !isHost) return;
  const nextRound = matchRound + 1;
  const seed = ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1;
  prepareMatchRound(nextRound, seed);
  state = "LOADING";
  beginCountdown(Date.now());
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvasW = Math.max(1, rect.width);
  canvasH = Math.max(1, rect.height);
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvasW * dpr);
  canvas.height = Math.round(canvasH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function arena() {
  const scale = currentMap.scale;
  const rx = Math.min(Math.min(canvasW * 0.44, canvasH * 0.72) * scale, canvasW * 0.49);
  const ry = Math.min(Math.min(canvasH * 0.41, canvasW * 0.69) * scale, canvasH * 0.49);
  return { cx: canvasW / 2, cy: canvasH * 0.5, rx, ry, unit: Math.min(rx, ry) };
}

function worldPoint(x, y, z = 0) {
  const a = arena();
  const lift = z * a.unit * 0.43;
  return { x: a.cx + x * a.rx, y: a.cy + y * a.ry - lift, groundY: a.cy + y * a.ry };
}

function roundTimer() {
  if (state !== "PLAYING") return ROUND_SECONDS;
  return Math.max(0, ROUND_SECONDS - roundElapsed);
}

function showRoundBanner(text) {
  roundBannerEl.textContent = text;
  roundBannerEl.classList.remove("show");
  void roundBannerEl.offsetWidth;
  roundBannerEl.classList.add("show");
}

function updatePlayerInput(dt) {
  if (!localPlayer) return;
  localPlayer.moveX = input.x;
  localPlayer.moveY = input.y;
  localPlayer.isCharging = input.charging;
  if (input.charging && localPlayer.z <= 0.001) {
    localPlayer.charge = clamp((performance.now() - input.chargeStartedAt) / 720, 0, 1);
  }
  jumpMeterFillEl.style.width = `${Math.round(localPlayer.charge * 100)}%`;
}

function launchPlayer(player, charge = 0.42) {
  if (!player || state !== "PLAYING" || !player.grounded || player.stun > 0 || performance.now() < player.nextJumpAt) return;
  const actualCharge = clamp(charge, 0, 1);
  player.vz = 1.72 + actualCharge * 1.25;
  player.z = 0.025;
  player.grounded = false;
  player.nextJumpAt = performance.now() + 260;
  player.charge = 0;
  player.flash = 0.15;
  hintShown = false;
  playSound("jump", 75);
  if (player.local) safeVibrate(12);
}

function releaseJump() {
  if (!input.charging) return;
  const charge = clamp((performance.now() - input.chargeStartedAt) / 720, 0.08, 1);
  input.charging = false;
  jumpControlEl.classList.remove("charging");
  launchPlayer(localPlayer, charge);
}

function startJumpCharge(event) {
  event.preventDefault();
  unlockAudio();
  if (state !== "PLAYING" || input.pointer !== null) return;
  input.pointer = event.pointerId;
  input.charging = true;
  input.chargeStartedAt = performance.now();
  jumpControlEl.classList.add("charging");
  try { jumpControlEl.setPointerCapture(event.pointerId); } catch (_) {}
}

function updateJoystick(event) {
  const rect = joystickEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const max = rect.width * 0.34;
  const dx = event.clientX - cx;
  const dy = event.clientY - cy;
  const length = Math.hypot(dx, dy);
  const ratio = length > max ? max / length : 1;
  const knobX = dx * ratio;
  const knobY = dy * ratio;
  joystickKnobEl.style.transform = `translate(${knobX}px, ${knobY}px)`;
  input.x = clamp(knobX / max, -1, 1);
  input.y = clamp(knobY / max, -1, 1);
}

function resetJoystick() {
  input.x = 0;
  input.y = 0;
  input.joyPointer = null;
  joystickKnobEl.style.transform = "translate(0, 0)";
}

joystickEl.addEventListener("pointerdown", event => {
  event.preventDefault();
  unlockAudio();
  input.joyPointer = event.pointerId;
  try { joystickEl.setPointerCapture(event.pointerId); } catch (_) {}
  updateJoystick(event);
});
joystickEl.addEventListener("pointermove", event => {
  if (event.pointerId === input.joyPointer) updateJoystick(event);
});
joystickEl.addEventListener("pointerup", event => {
  if (event.pointerId === input.joyPointer) resetJoystick();
});
joystickEl.addEventListener("pointercancel", resetJoystick);
jumpControlEl.addEventListener("pointerdown", startJumpCharge);
jumpControlEl.addEventListener("pointerup", event => {
  if (input.pointer === event.pointerId) {
    input.pointer = null;
    releaseJump();
  }
});
jumpControlEl.addEventListener("pointercancel", event => {
  if (input.pointer === event.pointerId) {
    input.pointer = null;
    releaseJump();
  }
});

const heldKeys = new Set();
window.addEventListener("keydown", event => {
  const key = event.key.toLowerCase();
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) event.preventDefault();
  if (!heldKeys.has(key)) {
    heldKeys.add(key);
    if (key === " ") {
      unlockAudio();
      input.charging = true;
      input.chargeStartedAt = performance.now();
      jumpControlEl.classList.add("charging");
    }
  }
  updateKeyboard();
});
window.addEventListener("keyup", event => {
  const key = event.key.toLowerCase();
  heldKeys.delete(key);
  if (key === " ") releaseJump();
  updateKeyboard();
});
window.addEventListener("blur", () => {
  heldKeys.clear();
  resetJoystick();
  if (input.charging) releaseJump();
});

function updateKeyboard() {
  const up = heldKeys.has("arrowup") || heldKeys.has("w");
  const down = heldKeys.has("arrowdown") || heldKeys.has("s");
  const left = heldKeys.has("arrowleft") || heldKeys.has("a");
  const right = heldKeys.has("arrowright") || heldKeys.has("d");
  const x = Number(right) - Number(left);
  const y = Number(down) - Number(up);
  const length = Math.hypot(x, y) || 1;
  if (input.joyPointer === null) {
    input.x = x / length;
    input.y = y / length;
  }
}

function spawnParticles(x, y, color, amount = 12, power = 1) {
  const a = arena();
  const px = a.cx + x * a.rx;
  const py = a.cy + y * a.ry;
  for (let i = 0; i < amount && particles.length < MAX_PARTICLES; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (35 + Math.random() * 135) * power;
    particles.push({
      x: px,
      y: py,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - Math.random() * 40,
      life: 0.45 + Math.random() * 0.6,
      maxLife: 0.65 + Math.random() * 0.6,
      radius: 2 + Math.random() * 4,
      color,
      sparkle: Math.random() > 0.45
    });
  }
}

function collectOrb(player, orb, elapsed) {
  if (player.lastScoreAt + 4 > elapsed) player.combo = Math.min(5, player.combo + 1);
  else player.combo = 1;
  player.lastScoreAt = elapsed;
  const surge = performance.now() < surgeUntil ? 2 : 1;
  const value = orb.value * surge + (player.combo >= 3 ? 1 : 0);
  player.score += value;
  orb.active = false;
  spawnParticles(orb.x, orb.y, orb.golden ? "#ffe18c" : "#86ffd1", orb.golden ? 24 : 13, orb.golden ? 1.4 : 1);
  playSound("collect");
  safeVibrate(player.combo >= 3 ? [16, 20, 30] : 15);
  if (player.local) {
    announce(player.combo >= 2 ? `${player.combo}連擊！ +${value}` : `+${value} 能量`);
  }
  if (sdk && isHost) {
    broadcast("ORB_CLAIMED", { orbId: orb.id, playerId: player.id, score: player.score, combo: player.combo, value });
  }
}

function spawnReplacementOrb() {
  const active = orbs.filter(orb => orb.active).length;
  if (active >= 9) return;
  let x, y, tries = 0;
  do {
    const angle = random() * Math.PI * 2;
    const r = 0.18 + random() * 0.58;
    x = Math.cos(angle) * r;
    y = Math.sin(angle) * r * 0.74;
    tries++;
  } while (tries < 8 && entities.some(player => !player.disconnected && distance(player, { x, y }) < 0.18));
  const scores = entities.filter(player => !player.disconnected).map(player => player.score).sort((a, b) => a - b);
  const lowMedian = scores.length ? scores[Math.floor((scores.length - 1) / 2)] : 0;
  const lowScorer = entities.filter(player => !player.disconnected && player.score <= lowMedian).sort((a, b) => a.score - b.score)[0];
  let value = performance.now() < surgeUntil ? 2 : 1;
  if (lowScorer && lowScorer.score + 2 <= Math.max(...scores, 0) && random() < 0.55) {
    value = 2;
    x = clamp(lowScorer.x + (random() - 0.5) * 0.36, -0.72, 0.72);
    y = clamp(lowScorer.y + (random() - 0.5) * 0.36, -0.62, 0.62);
  }
  const orb = cloneOrbAt(x, y, value, value > 1, `orb-${gameSeed}-${Math.floor(roundElapsed * 10)}-${Math.floor(random() * 999999)}`);
  orbs.push(orb);
  if (sdk && isHost) {
    broadcast("ORB_SPAWN", { orbId: orb.id, x: orb.x, y: orb.y, value: orb.value, golden: orb.golden });
  }
}

function getBotTarget(bot, elapsed) {
  const activeOrbs = orbs.filter(orb => orb.active);
  let bestOrb = null;
  let bestValue = -Infinity;
  for (const orb of activeOrbs) {
    const d = distance(bot, orb);
    const value = orb.value / (0.12 + d);
    if (value > bestValue) {
      bestOrb = orb;
      bestValue = value;
    }
  }
  const nearestRival = entities
    .filter(other => other !== bot && !other.disconnected && other.id !== bot.id)
    .sort((a, b) => distance(bot, a) - distance(bot, b))[0];
  const shouldChase = nearestRival && (bot.score > nearestRival.score || bot.score + 1 < nearestRival.score) && elapsed > 7 && random() < 0.04;
  if (shouldChase) {
    return { x: nearestRival.x + nearestRival.vx * 0.25, y: nearestRival.y + nearestRival.vy * 0.25, rival: nearestRival };
  }
  if (bestOrb) return { x: bestOrb.x, y: bestOrb.y, orb: bestOrb };
  bot.botWander += (random() - 0.5) * 0.5;
  return { x: Math.cos(bot.botWander) * 0.48, y: Math.sin(bot.botWander) * 0.42 };
}

function updateBot(bot, dt, elapsed) {
  if (bot.disconnected || bot.stun > 0) return;
  if (performance.now() >= bot.botThinkAt) {
    const target = getBotTarget(bot, elapsed);
    bot.botTargetX = target.x;
    bot.botTargetY = target.y;
    bot.botTarget = target;
    bot.botThinkAt = performance.now() + 270 + random() * 300;
  }
  const dx = bot.botTargetX - bot.x;
  const dy = bot.botTargetY - bot.y;
  const length = Math.hypot(dx, dy) || 1;
  bot.moveX = dx / length;
  bot.moveY = dy / length;
  const target = bot.botTarget;
  const grounded = bot.grounded;
  if (target?.rival && grounded && distance(bot, target.rival) < 0.34 && random() < 0.045) {
    bot.vz = 2.2 + random() * 0.55;
    bot.z = 0.03;
    bot.grounded = false;
  } else if (grounded && (distance(bot, { x: bot.botTargetX, y: bot.botTargetY }) > 0.13 || random() < 0.004)) {
    bot.vz = 1.8 + random() * 0.75;
    bot.z = 0.025;
    bot.grounded = false;
  }
}

function respawn(player, elapsed, fell = false) {
  if (player.invulnerableUntil > performance.now()) return;
  player.score = Math.max(0, player.score - 1);
  player.x = (random() - 0.5) * 0.8;
  player.y = (random() - 0.5) * 0.55;
  player.vx = 0;
  player.vy = 0;
  player.z = 0;
  player.vz = 0;
  player.grounded = true;
  player.stun = 0.45;
  player.invulnerableUntil = performance.now() + 1500;
  spawnParticles(player.x, player.y, "#8d9dbb", 18, 1.2);
  if (player.local) {
    announce(fell ? "掉出平台！ −1" : "被踩到了！ −1", true);
    playSound("hit", 190);
  }
  if (sdk && isHost) {
    broadcast("PLAYER_HIT", { victimId: player.id, attackerId: "", victimScore: player.score, attackerScore: 0, x: player.x, y: player.y });
  }
}

function resolveStomp(attacker, victim) {
  if (victim.invulnerableUntil > performance.now() || victim.disconnected || attacker.disconnected) return;
  if (attacker.z < victim.z + 0.11 || attacker.vz > 0.15) return;
  attacker.score += 2;
  attacker.combo = Math.max(1, attacker.combo);
  attacker.vz = 1.55;
  attacker.z = Math.max(attacker.z, 0.08);
  attacker.grounded = false;
  victim.score = Math.max(0, victim.score - 1);
  const dx = victim.x - attacker.x;
  const dy = victim.y - attacker.y;
  const d = Math.hypot(dx, dy) || 1;
  victim.vx = dx / d * 1.5;
  victim.vy = dy / d * 1.5;
  victim.x = clamp(victim.x + victim.vx * 0.055, -0.84, 0.84);
  victim.y = clamp(victim.y + victim.vy * 0.055, -0.78, 0.78);
  victim.stun = 0.72;
  victim.z = 0.08;
  victim.vz = 1.15;
  victim.grounded = false;
  victim.invulnerableUntil = performance.now() + 1400;
  victim.flash = 0.65;
  attacker.flash = 0.32;
  const midpoint = { x: (attacker.x + victim.x) * 0.5, y: (attacker.y + victim.y) * 0.5 };
  spawnParticles(midpoint.x, midpoint.y, attacker.color, 22, 1.35);
  playSound("hit", 100);
  safeVibrate([24, 22, 46]);
  if (attacker.local) announce("漂亮踩踏！ +2");
  if (victim.local) announce("被踩到了！", true);
  if (isHost && sdk) {
    broadcast("PLAYER_HIT", {
      attackerId: attacker.id, victimId: victim.id,
      attackerScore: attacker.score, victimScore: victim.score,
      x: victim.x, y: victim.y
    });
  }
}

function updatePhysics(dt, elapsed) {
  const now = performance.now();
  for (const player of entities) {
    if (player.disconnected) continue;
    if (player.bot && (!sdk || isHost)) updateBot(player, dt, elapsed);
    else if (!player.local && sdk) {
      const age = now - player.lastNetworkAt;
      if (age > 5500 && player.lastNetworkAt > 0) player.disconnected = true;
      const follow = Math.min(1, dt * 13);
      player.x += (player.targetX - player.x) * follow;
      player.y += (player.targetY - player.y) * follow;
      player.z += (player.targetZ - player.z) * follow;
      player.vx = player.targetVx;
      player.vy = player.targetVy;
      player.vz = player.targetVz;
      player.stun = Math.max(0, player.stun - dt);
      player.flash = Math.max(0, player.flash - dt);
      keepPlayerInArena(player);
      continue;
    }
    player.stun = Math.max(0, player.stun - dt);
    player.flash = Math.max(0, player.flash - dt);
    player.bob += dt * (player.z > 0.02 ? 11 : 5);
    if (player.stun <= 0) {
      const airborne = !player.grounded;
      const speedBoost = elapsed > ROUND_SECONDS - 10 ? 1.2 : 1;
      const maxSpeed = (airborne ? 0.48 : 0.72) * speedBoost;
      const wantedX = player.moveX * maxSpeed;
      const wantedY = player.moveY * maxSpeed;
      const response = airborne ? 12 : 7.5;
      player.vx += (wantedX - player.vx) * Math.min(1, dt * response);
      player.vy += (wantedY - player.vy) * Math.min(1, dt * response);
    } else {
      player.vx *= Math.max(0, 1 - dt * 1.2);
      player.vy *= Math.max(0, 1 - dt * 1.2);
    }
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    if (player.grounded) {
      player.z = 0;
      player.vz = 0;
    } else {
      player.z += player.vz * dt;
      player.vz -= 5.9 * dt;
      if (player.z <= 0 && player.vz <= 0) {
        player.z = 0;
        player.vz = 0;
        player.grounded = true;
      }
    }
    if (Math.hypot(player.x, player.y) > 0.98) {
      respawn(player, elapsed, true);
    }
    keepPlayerInArena(player);
  }

  const activePlayers = entities.filter(player => !player.disconnected);
  if (!sdk || isHost) {
    for (let i = 0; i < activePlayers.length; i++) {
      for (let j = i + 1; j < activePlayers.length; j++) {
        const a = activePlayers[i], b = activePlayers[j];
        if (distance(a, b) > 0.095) continue;
        const pairKey = `${a.id}|${b.id}`;
        if ((hitCooldowns.get(pairKey) || 0) > now) continue;
        const aCanStomp = a.z > b.z + 0.13 && a.vz < -0.05;
        const bCanStomp = b.z > a.z + 0.13 && b.vz < -0.05;
        if (aCanStomp) {
          resolveStomp(a, b);
          hitCooldowns.set(pairKey, now + 900);
        } else if (bCanStomp) {
          resolveStomp(b, a);
          hitCooldowns.set(pairKey, now + 900);
        } else if (a.z < 0.12 && b.z < 0.12) {
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 1;
          const push = (0.095 - d) * 1.7;
          a.vx -= dx / d * push;
          a.vy -= dy / d * push;
          b.vx += dx / d * push;
          b.vy += dy / d * push;
        }
      }
    }
    for (const player of activePlayers) keepPlayerInArena(player);
    for (const orb of orbs) {
      if (!orb.active) continue;
      for (const player of activePlayers) {
        if (player.z < 0.22 && distance(player, orb) < 0.082) {
          collectOrb(player, orb, elapsed);
          break;
        }
      }
    }
  } else {
    for (const orb of orbs) {
      if (!orb.active || !localPlayer) continue;
      if (localPlayer.z < 0.22 && distance(localPlayer, orb) < 0.082) {
        orb.active = false;
        broadcast("ORB_REQUEST", { orbId: orb.id, playerId: localId });
      }
    }
  }
}

function spawnGoldenOrbNearTrailing() {
  const players = entities.filter(player => !player.disconnected).sort((a, b) => a.score - b.score);
  if (!players.length) return;
  const trailing = players[0];
  const orb = cloneOrbAt(trailing.x + (random() - 0.5) * 0.32, trailing.y + (random() - 0.5) * 0.3, 2, true, `comeback-${gameSeed}-${++bonusOrbCounter}`);
  orbs.push(orb);
  if (sdk && isHost) {
    broadcast("ORB_SPAWN", { orbId: orb.id, x: orb.x, y: orb.y, value: orb.value, golden: orb.golden });
  }
}

function maybeStartSpecialEvents(elapsed) {
  const now = performance.now();
  if ((!sdk || isHost) && elapsed > 0 && elapsed < 52 && Math.floor(elapsed / 15) > surgeIndex) {
    surgeIndex = Math.floor(elapsed / 15);
    surgeUntil = now + 6000;
    broadcast("ROUND_SURGE", { duration: 6, index: surgeIndex });
    announce("魔力湧動！能量加倍");
    safeVibrate(26);
    showRoundBanner("ARCANE SURGE");
  }
  if ((!sdk || isHost) && elapsed > 12 && now - lastBonusAt > 11500) {
    lastBonusAt = now;
    spawnGoldenOrbNearTrailing();
  }
  if (elapsed > ROUND_SECONDS - 10 && elapsed < ROUND_SECONDS - 9.5) {
    showRoundBanner("最後衝刺！");
  }
}

function drawBackground(now) {
  const gradient = ctx.createRadialGradient(canvasW * 0.5, canvasH * 0.42, 8, canvasW * 0.5, canvasH * 0.52, Math.max(canvasW, canvasH) * 0.7);
  gradient.addColorStop(0, "#252b3c");
  gradient.addColorStop(0.55, "#171d2b");
  gradient.addColorStop(1, "#10131d");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvasW, canvasH);
  for (let i = 0; i < 28; i++) {
    const phase = i * 2.34;
    const px = (Math.sin(phase * 7.3) * 0.5 + 0.5) * canvasW;
    const py = (Math.cos(phase * 3.1) * 0.5 + 0.5) * canvasH;
    const blink = 0.12 + (Math.sin(now * 0.0012 + phase) + 1) * 0.13;
    ctx.globalAlpha = blink;
    ctx.fillStyle = i % 3 ? "#a4baff" : "#8affd5";
    ctx.beginPath();
    ctx.arc(px, py, i % 4 === 0 ? 1.7 : 1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawArena(now) {
  const a = arena();
  ctx.save();
  ctx.translate(a.cx, a.cy);
  ctx.scale(a.rx, a.ry);
  ctx.beginPath();
  ctx.ellipse(0, 0, 1, 1, 0, 0, Math.PI * 2);
  ctx.shadowColor = "#4bd4b577";
  ctx.shadowBlur = 30;
  ctx.fillStyle = "#111824";
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.save();
  ctx.clip();
  const floor = ctx.createLinearGradient(0, -1, 0, 1);
  floor.addColorStop(0, "#4c624f");
  floor.addColorStop(0.48, "#384d46");
  floor.addColorStop(1, "#253a3a");
  ctx.fillStyle = floor;
  ctx.fillRect(-1.1, -1.1, 2.2, 2.2);
  for (let row = -3; row <= 3; row++) {
    for (let col = -4; col <= 4; col++) {
      const x = col * 0.275 - ((row & 1) ? 0.1375 : 0);
      const y = row * 0.26;
      const edge = x * x + y * y;
      if (edge > 1.05) continue;
      const shimmer = (Math.sin(now * 0.0015 + col * 1.3 + row * 2.1) + 1) * 0.5;
      ctx.fillStyle = (col + row) % 2 === 0 ? `rgba(137,179,135,${0.1 + shimmer * 0.035})` : "rgba(10,22,27,.15)";
      ctx.beginPath();
      ctx.roundRect(x - 0.132, y - 0.122, 0.258, 0.238, 0.025);
      ctx.fill();
      ctx.strokeStyle = "rgba(203,229,190,.1)";
      ctx.lineWidth = 0.003;
      ctx.stroke();
    }
  }
  for (let i = 0; i < 7; i++) {
    const angle = i * Math.PI * 2 / 7 + Math.sin(now * 0.00025) * 0.04;
    const x = Math.cos(angle) * 0.83;
    const y = Math.sin(angle) * 0.82;
    ctx.fillStyle = "rgba(14,19,26,.35)";
    ctx.beginPath();
    ctx.ellipse(x + 0.012, y + 0.025, 0.092, 0.066, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#76868b";
    ctx.beginPath();
    ctx.ellipse(x, y, 0.084, 0.056, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#bac9b35b";
    ctx.lineWidth = 0.005;
    ctx.stroke();
    ctx.fillStyle = "#22313a";
    ctx.beginPath();
    ctx.ellipse(x, y, 0.047, 0.03, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.ellipse(0, 0, 1, 1, 0, 0, Math.PI * 2);
  ctx.strokeStyle = "#87dfc4";
  ctx.lineWidth = 0.009;
  ctx.globalAlpha = 0.72 + Math.sin(now * 0.002) * 0.14;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawOrb(orb, now) {
  if (!orb.active) return;
  const a = arena();
  const point = worldPoint(orb.x, orb.y);
  const bob = Math.sin(now * 0.004 + orb.pulse) * 4;
  const size = (orb.golden ? 12 : 8) + Math.sin(now * 0.006 + orb.spin) * 1.5;
  ctx.save();
  ctx.translate(point.x, point.y + bob);
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = orb.golden ? "#ffe092" : "#93ffe0";
  ctx.beginPath();
  ctx.arc(0, 0, size * 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.rotate(now * 0.0016 + orb.spin);
  ctx.shadowColor = orb.golden ? "#ffde81" : "#84ffd9";
  ctx.shadowBlur = 18;
  ctx.fillStyle = orb.golden ? "#fff0b5" : "#c7ffeb";
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.7, 0);
  ctx.lineTo(0, size);
  ctx.lineTo(-size * 0.7, 0);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#ffffffa0";
  ctx.lineWidth = 1;
  ctx.stroke();
  if (orb.value > 1) {
    ctx.fillStyle = "#fff0bd";
    ctx.font = `900 ${Math.max(9, size)}px "Barlow Condensed", sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("2×", 0, -size - 8);
  }
  ctx.restore();
}

function drawPlayer(player, now) {
  if (player.disconnected) return;
  const a = arena();
  const point = worldPoint(player.x, player.y, player.z);
  const radius = clamp(a.unit * 0.073, 13, 30);
  const heightLift = player.z * a.unit * 0.43;
  const squash = player.z <= 0.03 ? 1 + Math.sin(player.bob) * 0.035 : 1 - Math.min(0.13, player.vz > 0 ? player.vz * 0.025 : 0);
  const shadowX = a.cx + player.x * a.rx;
  const shadowY = a.cy + player.y * a.ry;
  const alpha = player.invulnerableUntil > now ? (Math.sin(now * 0.025) > 0 ? 0.24 : 0.66) : 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#080d13";
  ctx.globalAlpha *= Math.max(0.12, 0.34 - player.z * 0.26);
  ctx.beginPath();
  ctx.ellipse(shadowX, shadowY + radius * 0.55, radius * (1.05 - player.z * 0.25), radius * 0.37, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = alpha;
  if (player.z > 0.035) {
    ctx.strokeStyle = `${player.color}55`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(shadowX, shadowY + radius * 0.55, radius * (1.3 + player.z * 0.24), radius * 0.49, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  const ballY = point.y;
  const ballGradient = ctx.createRadialGradient(point.x - radius * 0.34, ballY - radius * 0.5, radius * 0.08, point.x, ballY, radius * 1.25);
  ballGradient.addColorStop(0, "#ffffff");
  ballGradient.addColorStop(0.19, player.flash > 0 ? "#fff5d2" : player.color);
  ballGradient.addColorStop(1, player.color);
  ctx.shadowColor = player.color;
  ctx.shadowBlur = player.local ? 21 : 13;
  ctx.fillStyle = ballGradient;
  ctx.beginPath();
  ctx.ellipse(point.x, ballY, radius * squash, radius * squash, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = player.local ? "#f2fff4d6" : "#ffffff70";
  ctx.lineWidth = player.local ? 2 : 1.25;
  ctx.stroke();
  ctx.fillStyle = "#1b2830";
  const lookX = clamp(player.vx * 4, -2.6, 2.6);
  const lookY = clamp(player.vy * 4, -2.2, 2.2);
  const eyeOffset = radius * 0.25;
  ctx.beginPath();
  ctx.ellipse(point.x - eyeOffset + lookX * 0.35, ballY - 1 + lookY * 0.25, Math.max(1.5, radius * 0.075), Math.max(2, radius * 0.12), 0, 0, Math.PI * 2);
  ctx.ellipse(point.x + eyeOffset + lookX * 0.35, ballY - 1 + lookY * 0.25, Math.max(1.5, radius * 0.075), Math.max(2, radius * 0.12), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#1b2830";
  ctx.lineWidth = Math.max(1.3, radius * 0.055);
  ctx.beginPath();
  ctx.arc(point.x + lookX * 0.3, ballY + radius * 0.12, radius * 0.16, 0.14, Math.PI - 0.14);
  ctx.stroke();
  if (player.isCharging && player.local) {
    ctx.strokeStyle = `rgba(255,255,255,${0.3 + player.charge * 0.65})`;
    ctx.lineWidth = 2 + player.charge * 2;
    ctx.beginPath();
    ctx.arc(point.x, ballY, radius + 5 + player.charge * 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * player.charge);
    ctx.stroke();
  }
  ctx.restore();
  ctx.save();
  const name = player.name.length > 9 ? `${player.name.slice(0, 8)}…` : player.name;
  ctx.font = `800 ${Math.max(10, Math.min(13, radius * 0.48))}px "DM Sans", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const labelY = ballY - heightLift * 0.02 - radius - 12;
  const labelWidth = ctx.measureText(name).width + 14;
  ctx.fillStyle = player.local ? "#10282aeb" : "#111723de";
  ctx.beginPath();
  ctx.roundRect(point.x - labelWidth / 2, labelY - 9, labelWidth, 18, 9);
  ctx.fill();
  ctx.strokeStyle = player.local ? "#86ffd171" : "#ffffff25";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = player.local ? "#c9ffeb" : "#edf2f9";
  ctx.fillText(name, point.x, labelY);
  if (player.combo >= 2 && player.lastScoreAt + 3 > roundElapsed) {
    ctx.fillStyle = "#ffe28e";
    ctx.font = `900 11px "Barlow Condensed", sans-serif`;
    ctx.fillText(`×${player.combo}`, point.x, labelY - 13);
  }
  ctx.restore();
}

function drawParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 1 - dt * 1.1;
    p.vy += 70 * dt;
    const opacity = clamp(p.life / p.maxLife, 0, 1);
    ctx.globalAlpha = opacity;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    if (p.sparkle) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((1 - opacity) * 3);
      ctx.moveTo(0, -p.radius);
      ctx.lineTo(p.radius * 0.45, 0);
      ctx.lineTo(0, p.radius);
      ctx.lineTo(-p.radius * 0.45, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else {
      ctx.arc(p.x, p.y, p.radius * opacity, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function renderScene(now, dt) {
  drawBackground(now);
  drawArena(now);
  for (const orb of orbs) drawOrb(orb, now);
  const ordered = entities.filter(player => !player.disconnected).slice().sort((a, b) => a.y - b.y);
  for (const player of ordered) drawPlayer(player, now);
  drawParticles(dt);
  if (performance.now() < surgeUntil) {
    const a = arena();
    ctx.save();
    ctx.globalAlpha = 0.12 + Math.sin(now * 0.014) * 0.05;
    ctx.strokeStyle = "#8cf9ff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(a.cx, a.cy, a.rx * 0.96, a.ry * 0.96, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function sortedPlayers() {
  return entities.filter(player => !player.disconnected).slice().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function sortedSeriesPlayers() {
  return sortedPlayers().sort((a, b) =>
    (matchWins.get(b.id) || 0) - (matchWins.get(a.id) || 0) ||
    (matchPoints.get(b.id) || 0) - (matchPoints.get(a.id) || 0)
  );
}

function renderHud(now) {
  const seconds = Math.ceil(roundTimer());
  timerEl.textContent = String(seconds).padStart(2, "0");
  timerEl.parentElement.classList.toggle("urgent", seconds <= 10 && state === "PLAYING");
  myScoreEl.textContent = String(getMe()?.score || 0);
  if (now - lastHudAt > 250) {
    lastHudAt = now;
    const rows = sortedPlayers().slice(0, 5);
    leaderboardEl.innerHTML = rows.map((player, index) => `
      <div class="rank-row ${player.local ? "is-me" : ""}">
        <span class="rank-name">${index + 1}. ${escapeHtml(player.name)}</span>
        <span class="rank-score">${player.score}</span>
      </div>
    `).join("");
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function finishRound(forcedWinnerId = null, fromNetwork = false) {
  if (state === "RESULT" || state === "EXIT") return;
  state = "RESULT";
  input.charging = false;
  jumpControlEl.classList.remove("charging");
  countdownEl.classList.add("is-hidden");
  resultScreenEl.classList.add("show");
  ambience.pause();
  const ranking = sortedPlayers();
  if (forcedWinnerId) {
    const forced = findPlayer(forcedWinnerId);
    if (forced && ranking[0] !== forced) {
      const forcedIndex = ranking.indexOf(forced);
      if (forcedIndex >= 0) ranking.splice(forcedIndex, 1);
      ranking.unshift(forced);
    }
  }
  const winner = ranking[0];
  for (const player of ranking) {
    matchPoints.set(player.id, (matchPoints.get(player.id) || 0) + player.score);
  }
  if (winner) matchWins.set(winner.id, (matchWins.get(winner.id) || 0) + 1);
  const me = getMe();
  const rankIndex = ranking.indexOf(me);
  const isFinalRound = matchRound >= MATCH_ROUNDS;
  const seriesRanking = sortedSeriesPlayers();
  const seriesRankIndex = seriesRanking.indexOf(me);
  resultTitleEl.textContent = isFinalRound
    ? (seriesRankIndex === 0 ? "五戰總冠軍！" : seriesRankIndex === 1 ? "總排名第二！" : "五戰完成！")
    : (rankIndex === 0 ? `第 ${matchRound} 戰冠軍！` : rankIndex === 1 ? "差一點點！" : "漂亮一局！");
  resultScoreLabelEl.textContent = isFinalRound ? "你的勝場" : "本戰能量";
  resultScoreEl.textContent = String(isFinalRound ? (matchWins.get(me?.id) || 0) : (me?.score || 0));
  resultNextEl.textContent = isFinalRound
    ? "五戰完成 · 挑戰成績不發放銀幣"
    : `下一戰準備中 · 第 ${matchRound + 1} 戰`;
  const shownRanking = isFinalRound ? seriesRanking : ranking;
  resultRankingEl.innerHTML = shownRanking.slice(0, 5).map((player, index) => `
    <div class="result-rank-row">
      <b>${["①", "②", "③", "④", "⑤"][index]}</b>
      <span>${escapeHtml(player.name)}${player.local ? "（你）" : ""}</span>
      <strong>${isFinalRound
        ? `${matchWins.get(player.id) || 0}勝 · ${matchPoints.get(player.id) || 0}分`
        : player.score}</strong>
    </div>
  `).join("");
  safeVibrate(rankIndex === 0 ? [45, 40, 90, 35, 120] : [50, 35, 60]);
  if (isFinalRound && !gameOverCalled) {
    gameOverCalled = true;
    try { sdk?.completeRound?.(matchPoints.get(me?.id)||0); } catch (error) { console.warn("BoomRoom round completion failed", error); }
  }
  if (!endSent && isHost && !fromNetwork) {
    endSent = true;
    broadcast("ROUND_END", { winnerId: winner?.id || null, scores: ranking.slice(0, 10).map(player => [player.id, player.score]) });
  }
  if (isFinalRound) {
    document.querySelector('#match-replay').hidden=false;
    document.querySelector('#match-exit').hidden=false;
    document.querySelector('#match-replay').disabled=!isHost;
    document.querySelector('#match-replay').textContent=isHost?'再挑戰五戰':'等待房主再開五戰';
  } else if (isHost) {
    exitTimer = setTimeout(startNextMatchRound, 3500);
  }
}

function gameLoop(now) {
  const dt = Math.min(0.04, Math.max(0, (now - lastFrameAt) / 1000));
  lastFrameAt = now;
  if (state === "COUNTDOWN") {
    const remaining = Math.max(0, (roundStartedAt - Date.now()) / 1000);
    const beat = Math.ceil(remaining);
    if (beat !== lastCountdownBeat && beat > 0) {
      lastCountdownBeat = beat;
      setCountdown(beat);
    }
    if (remaining <= 0) {
      setCountdown("GO!");
      enterPlay();
    }
  } else if (state === "PLAYING") {
    roundElapsed = Math.min(ROUND_SECONDS, (Date.now() - roundStartedAt) / 1000);
    updatePlayerInput(dt);
    maybeStartSpecialEvents(roundElapsed);
    if (roundElapsed > 0 && Math.random() < dt * 1.35 && (!sdk || isHost)) spawnReplacementOrb();
    updatePhysics(dt, roundElapsed);
    if (sdk && localPlayer && now - lastSendAt > 125) {
      lastSendAt = now;
      for (const player of entities) {
        if (!player.local && !(player.bot && isHost)) continue;
        broadcast("PLAYER_STATE", {
          playerId: player.id,
          x: player.x, y: player.y, z: player.z,
          vx: player.vx, vy: player.vy, vz: player.vz,
          score: player.score, combo: player.combo,
          timestamp: Date.now()
        });
      }
    }
    if (roundElapsed >= ROUND_SECONDS && (!sdk || isHost)) finishRound();
  }
  renderScene(now, dt);
  renderHud(now);
  requestAnimationFrame(gameLoop);
}

async function boot() {
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas, { passive: true });
  bindGameEvents();
  try { await resolveBootIdentity(); } catch (error) { console.warn("BoomRoom identity unavailable; using mock player", error); }
  if (sdk) {
    // Room roster can update while a user is joining or reconnecting.
    setInterval(() => {
      if (state === "RESULT" || state === "EXIT") return;
      syncRoomRoster();
    }, 2200);
  }
  startRound();
  requestAnimationFrame(gameLoop);
}

boot();
document.querySelector('#match-replay').addEventListener('click',()=>{
  if(state!=='RESULT'||matchRound<MATCH_ROUNDS||!isHost)return;
  clearTimeout(exitTimer);matchWins.clear();matchPoints.clear();gameOverCalled=false;
  document.querySelector('#match-replay').hidden=true;document.querySelector('#match-exit').hidden=true;
  startRound();
});
document.querySelector('#match-exit').addEventListener('click',()=>{state='EXIT';sdk?.leaveGame?.();});
