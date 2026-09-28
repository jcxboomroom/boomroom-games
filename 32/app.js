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

const MATCH_SECONDS = 32;
const OVERTIME_SECONDS = 8;
const SERIES_BATTLES = 5;
const MAX_PLAYERS = 10;
const AUTO_START_STABLE_MS = 900;
const HEARTBEAT_MS = 1200;
const SDK_RECOVERY_MS = 2200;
const BOT_COUNT_FOR_SOLO = 5;
const BOT_NAMES = ["碰碰", "閃閃", "豆包", "小彈珠", "泡泡", "阿蹦", "蘑菇", "麻糬", "火花"];
const MAPS = [
  { id: "courtyard", name: "小型庭院", tag: "7×7 小圖", grid: 7, radius: 1.04 },
  { id: "neon-square", name: "霓虹方陣", tag: "8×8 中圖", grid: 8, radius: 1.03 },
  { id: "wide-arena", name: "寬域競技場", tag: "9×9 大圖", grid: 9, radius: 1.02 },
  { id: "fracture", name: "裂谷平台", tag: "8×8 窄場", grid: 8, radius: 0.92 },
  { id: "final-ring", name: "終局圓環", tag: "10×10 極限", grid: 10, radius: 0.84 },
];
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
let sdk = null;
let mockMode = false;
let sdkReady = false;
let sdkSignalSeen = false;
let hostFlag = null;
let parentEmbedded = window.parent && window.parent !== window;
let devFallbackUsed = false;
let fallbackTimer = null;
let boundSdk = null;
const mockSdk = {
  isHost: true,
  roomId: "mock-room",
  roomPlayers: [],
  async getUser() { return { id: "mock-you", username: "你", avatar_url: null }; },
  sendGameEvent(eventName, payload) {
    queueMicrotask(() => handleGameEvent({ eventName, payload: { ...payload, sourceId: payload?.sourceId || localPlayer?.id }, senderId: payload?.sourceId || localPlayer?.id }));
  },
  async requestPurchase() { return { success: false, mock: true }; },
  gameOver(winAmount) { console.info("[Floor Brawl] Mock gameOver:", winAmount); },
};

let roomId = "room";
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
let gridSize = MAPS[0].grid;
let currentMapIndex = 0;
let battleNumber = 1;
let seriesParticipants = [];
let roomHumans = [];
let lastRoomSignature = "";
let rosterStableSince = 0;
let autoStartTimer = null;
let battleTransitionTimer = null;
let seriesFinished = false;
let currentRoundId = "";
let roundStartAt = 0;
let countdownEndsAt = 0;

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
    seriesPoints: Number(raw?.seriesPoints) || 0,
    battleWins: Number(raw?.battleWins) || 0,
  };
}

function getMapForBattle(number = battleNumber) {
  return MAPS[(Math.max(1, number) - 1) % MAPS.length];
}

function normalizeRawPlayers(rawPlayers) {
  const roster = Array.isArray(rawPlayers)
    ? rawPlayers
    : Array.isArray(rawPlayers?.players) ? rawPlayers.players : [];
  const currentId = String(user?.id ?? user?.userId ?? "");
  const normalized = [];
  const seen = new Set();
  roster.forEach((raw) => {
    if (!raw) return;
    const id = String(raw.id ?? raw.userId ?? raw.user_id ?? raw.uid ?? "");
    if (!id || seen.has(id)) return;
    seen.add(id);
    normalized.push({
      id,
      username: String(raw.username ?? raw.name ?? raw.displayName ?? raw.nickname ?? `玩家 ${normalized.length + 1}`).slice(0, 14),
      avatar: raw.avatar ?? raw.avatar_url ?? raw.avatarStyle ?? null,
      isBot: Boolean(raw.isBot ?? raw.bot ?? false),
    });
  });
  if (user && currentId && !seen.has(currentId)) {
    normalized.unshift({
      id: currentId,
      username: String(user.username ?? user.name ?? "你").slice(0, 14),
      avatar: user.avatar ?? user.avatar_url ?? null,
      isBot: false,
    });
  }
  return normalized.slice(0, MAX_PLAYERS);
}

function makeBotRoster() {
  return Array.from({ length: BOT_COUNT_FOR_SOLO }, (_, i) => ({
    id: `bot-${roomId}-${i + 1}`,
    username: BOT_NAMES[i] || `AI ${i + 1}`,
    avatar: null,
    isBot: true,
  }));
}

function buildParticipants(humans) {
  const realHumans = normalizeRawPlayers(humans).filter((p) => !p.isBot).slice(0, MAX_PLAYERS);
  // 只有房內真的只有 1 位真人時才補 AI。2～10 位真人完全不補假玩家。
  if (realHumans.length === 1) return [...realHumans, ...makeBotRoster()];
  return realHumans;
}

function createGameplayPlayers(participants) {
  return (Array.isArray(participants) ? participants : []).slice(0, MAX_PLAYERS)
    .map((raw, index) => makePlayer(raw, index, raw.id === String(user?.id ?? ""), Boolean(raw.isBot)));
}

function resetTilesForMap(map) {
  gridSize = map.grid;
  safeRadius = map.radius;
  tiles = [];
  for (let row = 0; row < gridSize; row += 1) {
    for (let col = 0; col < gridSize; col += 1) {
      const x = ((col + 0.5) / gridSize) * 2 - 1;
      const y = ((row + 0.5) / gridSize) * 2 - 1;
      if (Math.hypot(x, y) < 1.055) {
        tiles.push({ col, row, x, y, level: 0, collapseAt: 0, key: `${col}:${row}` });
      }
    }
  }
}

function setRoomHumans(list, source = "sdk") {
  const next = normalizeRawPlayers(list).filter((p) => !p.isBot);
  if (user?.id && !next.some((p) => p.id === String(user.id))) {
    next.unshift({ id: String(user.id), username: String(user.username ?? "你").slice(0, 14), avatar: user.avatar ?? null, isBot: false });
  }
  const limited = next.slice(0, MAX_PLAYERS);
  const signature = limited.map((p) => p.id).sort().join("|");
  if (signature !== lastRoomSignature) {
    lastRoomSignature = signature;
    rosterStableSince = Date.now();
  }
  roomHumans = limited;
  if (state === GAME_STATE.LOADING || state === GAME_STATE.RESULT) {
    const current = seriesParticipants.length ? seriesParticipants : buildParticipants(roomHumans);
    players = createGameplayPlayers(current);
    localPlayer = players.find((p) => p.isLocal) || players[0] || null;
  }
  renderRoomHud();
}

function exportRoster() {
  return roomHumans.map((p) => ({ id: p.id, username: p.username, avatar: p.avatar ?? null, isBot: false }));
}

function exportParticipants() {
  return seriesParticipants.map((p) => ({
    id: p.id,
    username: p.name,
    avatar: p.avatar ?? null,
    isBot: Boolean(p.isBot),
    seriesPoints: Number(p.seriesPoints || 0),
    battleWins: Number(p.battleWins || 0),
  }));
}

function renderRoomHud() {
  const count = roomHumans.length;
  const roomText = $("#roomCountText");
  const participantCount = seriesParticipants.length || (count === 1 ? 6 : count);
  if (roomText) {
    roomText.textContent = state === GAME_STATE.PLAYING || state === GAME_STATE.COUNTDOWN
      ? `參賽 ${participantCount} 人 · 真人 ${count}`
      : `房內真人 ${count} / ${MAX_PLAYERS}`;
  }
  const battleNode = $("#battle");
  if (battleNode) battleNode.textContent = `${Math.min(SERIES_BATTLES, battleNumber)} / ${SERIES_BATTLES}`;
  const mapNode = $("#mapInfo");
  if (mapNode) {
    const map = getMapForBattle(battleNumber);
    mapNode.textContent = `第 ${battleNumber} 戰 · ${map.name} · ${map.tag}`;
  }

  const chips = $("#playerChips");
  if (chips) {
    const visible = (seriesParticipants.length ? seriesParticipants : buildParticipants(roomHumans)).slice(0, MAX_PLAYERS);
    chips.innerHTML = visible.map((player) => {
      const bot = Boolean(player.isBot);
      const name = escapeHtml(player.name || player.username || "玩家");
      return `<span class="player-chip ${bot ? 'bot' : ''}">` +
        `<span class="dot"></span><span class="chip-name">${name}</span>` +
        `<span class="chip-tag">${bot ? 'AI' : (String(player.id) === String(user?.id ?? '') ? '你' : '真人')}</span>` +
        `</span>`;
    }).join(
      visible.length ? '' : '<span class="player-chip"><span class="dot"></span><span class="chip-name">等待玩家進入</span></span>'
    );
  }
}

async function boot() {
  installNetworkEvents();
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas, { passive: true });
  window.addEventListener("orientationchange", resizeCanvas, { passive: true });
  installControls();
  resetTilesForMap(getMapForBattle(1));
  renderRoomHud();

  // BoomRoom 標準：SDK 存在時優先使用真實玩家；沒有 SDK 時也必須可以完整遊玩。
  if (window.BoomRoomSDK) {
    sdkSignalSeen = true;
    adoptSdk(window.BoomRoomSDK);
    let currentUser = null;
    try { currentUser = typeof sdk.getUser === "function" ? await Promise.resolve(sdk.getUser()) : null; } catch {}
    setupSDK({
      user: currentUser,
      isHost: sdk.isHost,
      roomId: sdk.roomId,
      roomPlayers: sdk.roomPlayers || sdk.players || [],
    });
    return;
  }

  // 主頁可能在 HTML 之後才把 SDK bridge 注入，所以主動要求初始化。
  requestParentSdkInit();

  // 沒有任何 SDK 訊號時，進入真正可玩的 Mock 模式；若之後 SDK 抵達會立即接管。
  fallbackTimer = setTimeout(() => {
    if (sdkReady || window.BoomRoomSDK || sdkSignalSeen) return;
    startMockFallback();
  }, SDK_RECOVERY_MS);
}

function requestParentSdkInit() {
  try { window.BoomRoomSDK?.requestInit?.(); } catch {}
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(JSON.stringify({ action: "requestInitSDK", gameId: "floor_brawl" }), "*");
      window.parent.postMessage(JSON.stringify({ action: "getRoomState", gameId: "floor_brawl" }), "*");
    }
  } catch {}
}

function startMockFallback() {
  if (sdkReady || window.BoomRoomSDK) return;
  devFallbackUsed = true;
  sdk = mockSdk;
  mockMode = true;
  sdkReady = true;
  hostFlag = true;
  const queryCount = Number.parseInt(new URLSearchParams(window.location.search).get("mockPlayers") || "1", 10);
  const mockCount = clamp(Number.isFinite(queryCount) ? queryCount : 1, 1, MAX_PLAYERS);
  user = { id: "mock-you", username: "你", avatar: null };
  roomId = "mock-room";
  const mockHumans = Array.from({ length: mockCount }, (_, index) => ({
    id: index === 0 ? "mock-you" : `mock-player-${index + 1}`,
    username: index === 0 ? "你" : `測試真人 ${index + 1}`,
    avatar: null,
    isBot: false,
  }));
  setRoomHumans(mockHumans, "mock-fallback");
  showCallout("3");
  scheduleSeriesAutoStart();
}

function adoptSdk(realSdk) {
  if (!realSdk || typeof realSdk !== "object") return false;
  sdk = realSdk;
  mockMode = false;
  sdkReady = true;
  if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
  const flag = realSdk.isHost;
  if (flag !== undefined && flag !== null) hostFlag = flag;
  if (realSdk.roomId != null) roomId = String(realSdk.roomId);
  bindSdkEventBridge(realSdk);
  return true;
}

function bindSdkEventBridge(realSdk) {
  if (!realSdk || boundSdk === realSdk) return;
  boundSdk = realSdk;
  const listener = (detail) => {
    const d = detail?.detail ?? detail ?? {};
    const eventName = d?.eventName ?? d?.name ?? d?.event ?? d?.type;
    if (!eventName) return;
    const payload = d?.payload ?? d?.data ?? {};
    const senderId = d?.userId ?? d?.senderId ?? payload?.sourceId ?? payload?.playerId ?? null;
    handleGameEvent({ eventName, payload, senderId });
  };
  try { realSdk.addEventListener?.("gameEventReceived", listener); } catch {}
  try { realSdk.on?.("gameEventReceived", listener); } catch {}
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  dpr = Math.min(2, window.devicePixelRatio || 1);
  canvasWidth = Math.max(1, rect.width);
  canvasHeight = Math.max(1, rect.height);
  canvas.width = Math.round(canvasWidth * dpr);
  canvas.height = Math.round(canvasHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 把最大的可用中央區交給地板，同時預留 HUD / 操控區。
  const topReserve = Math.max(118, canvasHeight * 0.16);
  const bottomReserve = Math.max(128, canvasHeight * 0.19);
  const corridor = Math.max(160, canvasHeight - topReserve - bottomReserve);
  const side = Math.min(canvasWidth * 0.96, corridor * 0.98, 1080);
  board = {
    side,
    x: canvasWidth / 2,
    y: topReserve + corridor / 2,
  };
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
    const eventName = detail?.eventName ?? detail?.name ?? detail?.event ?? detail?.type;
    const payload = detail?.payload ?? detail?.data ?? {};
    const senderId = detail?.userId ?? detail?.senderId ?? payload?.sourceId ?? payload?.playerId ?? null;
    if (eventName) handleGameEvent({ eventName, payload, senderId });
  };
  window.addEventListener("gameEventReceived", listener);
  document.addEventListener("gameEventReceived", listener);
  window.addEventListener("message", (event) => {
    try {
      const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      if (!data || typeof data !== "object") return;
      if (data.action === "initSDK" || data.action === "sdkReady" || data.action === "boomroom:sdkReady" || data.user || data.roomPlayers || data.roomId) {
        sdkSignalSeen = true;
        setupSDK(data.data && typeof data.data === "object" ? data.data : data);
        return;
      }
      if (data.action === "roomPlayersUpdated" || data.action === "roomRoster" || data.action === "playersUpdated") {
        sdkSignalSeen = true;
        const list = data.roomPlayers || data.players || data.data?.roomPlayers || data.data?.players;
        if (Array.isArray(list)) setRoomHumans(list, "postMessage-roster");
        if (isHost()) { sendRoomSync(state === GAME_STATE.PLAYING ? "PLAYING" : "WAITING"); scheduleSeriesAutoStart(); }
        return;
      }
      if (data.action === "gameEventReceived" || data.action === "gameEvent") {
        handleGameEvent({
          eventName: data.eventName || data.name || data.event || "",
          payload: data.payload || data.data || {},
          senderId: data.userId ?? data.senderId ?? data.payload?.sourceId ?? null,
        });
      }
    } catch {}
  });
  try { sdk.addEventListener?.("gameEventReceived", listener); } catch {}
  try { sdk.on?.("gameEventReceived", listener); } catch {}

  window.initBoomRoomSDK = function(data) {
    sdkSignalSeen = true;
    setupSDK(data || {});
  };

  window.onBoomRoomSDKReady = async () => {
    if (!window.BoomRoomSDK) return;
    sdkSignalSeen = true;
    adoptSdk(window.BoomRoomSDK);
    let sdkUser = null;
    try { sdkUser = typeof sdk.getUser === "function" ? await Promise.resolve(sdk.getUser()) : null; } catch {}
    setupSDK({ user: sdkUser, isHost: sdk.isHost, roomId: sdk.roomId, roomPlayers: sdk.roomPlayers || sdk.players || [] });
  };

  // SDK 已存在時，不等待任何外部按鈕或主持人。
  if (window.BoomRoomSDK) window.onBoomRoomSDKReady();
}

function setupSDK(data = {}) {
  sdkSignalSeen = true;
  const wasMock = mockMode;
  adoptSdk(window.BoomRoomSDK || sdk);
  const nested = data?.data && typeof data.data === "object" ? data.data : data;
  if (wasMock && !mockMode) {
    // 真正 SDK 抵達後，捨棄暫時 Mock 場，不讓假玩家殘留。
    state = GAME_STATE.LOADING;
    seriesFinished = false;
    battleNumber = 1;
    currentMapIndex = 0;
    currentRoundId = "";
    roundStartAt = 0;
    countdownEndsAt = 0;
    seriesParticipants = [];
    players = [];
    localPlayer = null;
    resultNode.classList.remove("show");
  }
  if (nested.user) user = nested.user;
  if (nested.roomId != null) roomId = String(nested.roomId);
  if (nested.isHost !== undefined && nested.isHost !== null) {
    hostFlag = nested.isHost;
    try { if (sdk) sdk.isHost = nested.isHost; } catch {}
  }
  sdkReady = true;
  mockMode = false;
  if (Array.isArray(nested.roomPlayers)) setRoomHumans(nested.roomPlayers, "initSDK");
  else if (Array.isArray(nested.players)) setRoomHumans(nested.players, "initSDK.players");
  else setRoomHumans(roomHumans, "initSDK-existing");
  sendRoomHello();
  if (isHost()) {
    sendRoomSync("WAITING");
    scheduleSeriesAutoStart();
  } else {
    showCallout("等待房間同步");
  }
}

function sendEvent(eventName, payload = {}) {
  const sourceId = String(localPlayer?.id ?? user?.id ?? payload?.sourceId ?? "");
  const event = { ...payload, sourceId, roomId, at: Date.now() };
  try {
    const liveSdk = window.BoomRoomSDK || sdk;
    if (liveSdk && typeof liveSdk.sendGameEvent === "function") {
      liveSdk.sendGameEvent(eventName, event);
      return true;
    }
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(JSON.stringify({ action: "sendGameEvent", eventName, payload: event }), "*");
      return true;
    }
  } catch (error) {
    console.warn("BoomRoom event send failed", error);
  }
  return false;
}

function sendRoomHello() {
  const id = String(user?.id ?? localPlayer?.id ?? "");
  if (!id) return;
  sendEvent("FLOOR_ROOM_HELLO", {
    playerId: id,
    player: { id, username: String(user?.username ?? user?.name ?? "玩家").slice(0, 14), avatar: user?.avatar ?? user?.avatar_url ?? null },
  });
}

function sendRoomSync(phase = "WAITING") {
  if (!isHost()) return;
  sendEvent("FLOOR_ROOM_SYNC", {
    hostId: String(localPlayer?.id ?? user?.id ?? ""),
    phase,
    roomPlayers: exportRoster(),
    playerCount: roomHumans.length,
    battleNumber,
    mapIndex: currentMapIndex,
    roundId: currentRoundId,
    participants: exportParticipants(),
    startAt: Number(roundStartAt || 0),
    countdownEndsAt: Number(countdownEndsAt || 0),
  });
}

function scheduleSeriesAutoStart() {
  if (!sdkReady || !isHost()) return;
  if (state === GAME_STATE.PLAYING || state === GAME_STATE.COUNTDOWN || state === GAME_STATE.RESULT) return;
  if (seriesFinished) return;
  if (autoStartTimer) clearTimeout(autoStartTimer);
  autoStartTimer = setTimeout(() => {
    autoStartTimer = null;
    if (roomHumans.length <= 0) return;
    const age = Date.now() - (rosterStableSince || Date.now());
    if (age < AUTO_START_STABLE_MS) { scheduleSeriesAutoStart(); return; }
    startSeries();
  }, AUTO_START_STABLE_MS);
}

function startSeries() {
  if (!isHost() || roomHumans.length <= 0 || state === GAME_STATE.PLAYING || state === GAME_STATE.COUNTDOWN) return;
  seriesFinished = false;
  battleNumber = 1;
  currentMapIndex = 0;
  seriesParticipants = createGameplayPlayers(buildParticipants(roomHumans));
  seriesParticipants.forEach((p) => { p.seriesPoints = 0; p.battleWins = 0; });
  const startAt = Date.now() + 900;
  const roundId = `${roomId}-${Date.now()}-B1`;
  const startPayload = { roundId, battleNumber, mapIndex: 0, startAt, participants: exportParticipants() };
  sendEvent("FLOOR_ROUND_START", startPayload);
  beginCountdown(startAt, { roundId, participants: startPayload.participants, battleNumber: 1, mapIndex: 0, broadcast: true });
}

function resetBattleState(participants, mapIndex = 0, number = 1) {
  battleNumber = Math.max(1, Math.min(SERIES_BATTLES, Number(number) || 1));
  currentMapIndex = Math.max(0, Math.min(MAPS.length - 1, Number(mapIndex) || ((battleNumber - 1) % MAPS.length)));
  resetTilesForMap(MAPS[currentMapIndex]);
  players = createGameplayPlayers(participants);
  localPlayer = players.find((p) => p.isLocal) || players[0] || null;
  players.forEach((player, index) => {
    const angle = index * 2.3999632297 + 0.28;
    const radius = index === 0 ? 0.10 : 0.43 + (index % 3) * 0.065;
    player.alive = true;
    player.charged = false;
    player.vx = 0; player.vy = 0;
    player.lastDashAt = -99;
    player.lastTile = "";
    player.survival = MATCH_SECONDS;
    player.knockouts = 0;
    player.orbs = 0;
    player.koReason = "";
    player.seriesPoints = Number(player.seriesPoints) || 0;
    player.battleWins = Number(player.battleWins) || 0;
    player.x = Math.cos(angle) * radius * MAPS[currentMapIndex].radius;
    player.y = Math.sin(angle) * radius * MAPS[currentMapIndex].radius;
  });
  cachedTimeLeft = MATCH_SECONDS;
  safeRadius = MAPS[currentMapIndex].radius;
  orb = null;
  lastOrbAt = 0;
  overtimeAt = 0;
  gameOverCalled = false;
  resultNode.classList.remove("show");
  renderRoomHud();
}

function beginCountdown(startAt, meta = {}) {
  if (state === GAME_STATE.COUNTDOWN || state === GAME_STATE.PLAYING) return;
  state = GAME_STATE.COUNTDOWN;
  stateStartedAt = now();
  const participants = Array.isArray(meta.participants) && meta.participants.length
    ? meta.participants
    : (seriesParticipants.length ? seriesParticipants.map((p) => ({ id: p.id, username: p.name, avatar: null, isBot: p.isBot })) : buildParticipants(roomHumans));
  seriesParticipants = createGameplayPlayers(participants);
  resetBattleState(participants, meta.mapIndex ?? ((Number(meta.battleNumber || battleNumber) - 1) % MAPS.length), meta.battleNumber || battleNumber);
  roundStartAt = Number(startAt || Date.now() + 700);
  countdownEndsAt = roundStartAt;
  currentRoundId = String(meta.roundId || currentRoundId || `${roomId}-${Date.now()}-B${battleNumber}`);
  showCallout(`第 ${battleNumber} 戰 · ${getMapForBattle(battleNumber).name}`);
  matchStartedAt = 0;
  safeRadius = getMapForBattle(battleNumber).radius;
  renderRoomHud();
  if (isHost() && !mockMode && meta.broadcast !== false) sendRoomSync("COUNTDOWN");
}

function addRoomPlayer(raw) {
  const id = String(raw?.id ?? raw?.userId ?? raw?.user_id ?? "");
  if (!id || roomHumans.some((player) => player.id === id) || roomHumans.length >= MAX_PLAYERS) return;
  setRoomHumans([...roomHumans, {
    id,
    username: String(raw?.username ?? raw?.name ?? raw?.displayName ?? raw?.nickname ?? `玩家 ${roomHumans.length + 1}`).slice(0, 14),
    avatar: raw?.avatar ?? raw?.avatar_url ?? null,
    isBot: false,
  }], "hello");
  if (isHost()) {
    sendRoomSync(state === GAME_STATE.PLAYING ? "PLAYING" : "WAITING");
    scheduleSeriesAutoStart();
  }
}

function startPlaying() {
  if (state !== GAME_STATE.COUNTDOWN) return;
  state = GAME_STATE.PLAYING;
  matchStartedAt = now();
  stateStartedAt = matchStartedAt;
  lastOrbAt = matchStartedAt + 2600;
  resultNode.classList.remove("show");
  showCallout("撞！把對手撞下去！");
  renderRoomHud();
  if (isHost() && !mockMode) sendRoomSync("PLAYING");
}

function isHost() {
  const flag = hostFlag ?? window.BoomRoomSDK?.isHost ?? sdk?.isHost;
  if (flag !== undefined && flag !== null) return flag === true || flag === 1 || flag === "true";
  return players[0]?.id === String(user?.id ?? localPlayer?.id ?? "");
}

function handleGameEvent({ eventName, payload = {}, senderId = null }) {
  const event = String(eventName || "");
  if (!payload || typeof payload !== "object") return;
  const sender = senderId != null ? String(senderId) : String(payload.sourceId ?? payload.playerId ?? "");
  const me = String(user?.id ?? localPlayer?.id ?? "");
  if (sender && sender === me && !mockMode) return;

  switch (event) {
    case "FLOOR_ROOM_HELLO": {
      const p = payload.player || { id: payload.playerId || sender, username: payload.playerName || "玩家", avatar: payload.avatar || null };
      if (p?.id && String(p.id) !== me) addRoomPlayer(p);
      if (isHost() && p?.id && String(p.id) !== me) {
        sendRoomSync(state === GAME_STATE.PLAYING ? "PLAYING" : state === GAME_STATE.COUNTDOWN ? "COUNTDOWN" : "WAITING");
        scheduleSeriesAutoStart();
      }
      break;
    }
    case "FLOOR_ROOM_SYNC": {
      const hostId = String(payload.hostId || "");
      if (hostId && hostId === me) return;
      if (Array.isArray(payload.roomPlayers)) setRoomHumans(payload.roomPlayers, "remote-sync");
      if (Array.isArray(payload.participants) && payload.participants.length) {
        seriesParticipants = createGameplayPlayers(payload.participants);
      }
      if (payload.phase === "COUNTDOWN") {
        currentRoundId = String(payload.roundId || currentRoundId || `${roomId}-${Date.now()}-B${battleNumber}`);
        beginCountdown(Number(payload.startAt || payload.countdownEndsAt || Date.now() + 700), {
          roundId: payload.roundId,
          participants: payload.participants,
          battleNumber: Number(payload.battleNumber || battleNumber),
          mapIndex: Number(payload.mapIndex ?? ((Number(payload.battleNumber || battleNumber) - 1) % MAPS.length)),
          broadcast: false,
        });
      } else if (payload.phase === "PLAYING" && state !== GAME_STATE.PLAYING) {
        currentRoundId = String(payload.roundId || currentRoundId || `${roomId}-${Date.now()}-B${battleNumber}`);
        beginCountdown(Number(payload.startAt || Date.now()), {
          roundId: payload.roundId,
          participants: payload.participants,
          battleNumber: Number(payload.battleNumber || battleNumber),
          mapIndex: Number(payload.mapIndex ?? ((Number(payload.battleNumber || battleNumber) - 1) % MAPS.length)),
          broadcast: false,
        });
        startPlaying();
      }
      break;
    }
    case "FLOOR_ROUND_START":
      currentRoundId = String(payload.roundId || currentRoundId || `${roomId}-${Date.now()}-B${battleNumber}`);
      beginCountdown(Number(payload.startAt || Date.now() + 700), {
        roundId: payload.roundId,
        participants: Array.isArray(payload.participants) ? payload.participants : buildParticipants(roomHumans),
        battleNumber: Number(payload.battleNumber || battleNumber),
        mapIndex: Number(payload.mapIndex ?? ((Number(payload.battleNumber || battleNumber) - 1) % MAPS.length)),
        broadcast: false,
      });
      break;
    case "SHOVE_REQUEST":
      if (isHost()) hostResolveShove(payload);
      break;
    case "ORB_PICKUP_REQUEST":
      if (isHost()) handleOrbRequest(payload);
      break;
    case "PLAYER_MOVE": {
      const player = players.find((candidate) => candidate.id === String(payload.playerId ?? sender));
      if (!player || player.isLocal) break;
      const nextX = Number(payload.x), nextY = Number(payload.y);
      if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) break;
      player.x += (nextX - player.x) * 0.42;
      player.y += (nextY - player.y) * 0.42;
      player.vx = clamp(Number(payload.vx) || 0, -2.8, 2.8);
      player.vy = clamp(Number(payload.vy) || 0, -2.8, 2.8);
      player.faceX = Number(payload.faceX) || player.faceX;
      player.faceY = Number(payload.faceY) || player.faceY;
      if (payload.dashing) { player.dashX = player.faceX; player.dashY = player.faceY; player.dashUntil = now() + 180; }
      break;
    }
    case "PLAYER_HIT": applyHit(payload); break;
    case "PLAYER_OUT": eliminatePlayer(String(payload.targetId), payload.reason || "落進裂縫", payload.attackerId); break;
    case "PLAYER_ABANDONED": {
      const abandonedId = String(payload.playerId ?? sender);
      if (isHost() && abandonedId && abandonedId !== me) {
        const player = players.find((candidate) => candidate.id === abandonedId);
        if (player?.alive) {
          eliminatePlayer(abandonedId, "離開遊戲", "");
          sendEvent("PLAYER_OUT", { targetId: abandonedId, reason: "離開遊戲", attackerId: "" });
        }
      }
      break;
    }
    case "TILE_STATE": applyTileState(payload); break;
    case "ORB_STATE": orb = payload.active ? { id: payload.id, x: payload.x, y: payload.y, until: payload.until } : null; break;
    case "ORB_PICKUP": applyOrbPickup(payload); break;
    case "GAME_STATE": applySnapshot(payload); break;
    case "BATTLE_END": applyBattleEnd(payload); break;
    case "SERIES_END": applySeriesEnd(payload); break;
    default: break;
  }
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
  const col = Math.floor(((x + 1) / 2) * gridSize);
  const row = Math.floor(((y + 1) / 2) * gridSize);
  if (col < 0 || col >= gridSize || row < 0 || row >= gridSize) return null;
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
    const player = players.find((candidate) => candidate.id === String(snap.id));
    if (!player || player.isLocal) return;
    player.x = Number(snap.x) || 0;
    player.y = Number(snap.y) || 0;
    player.vx = Number(snap.vx) || 0;
    player.vy = Number(snap.vy) || 0;
    player.alive = Boolean(snap.alive);
    player.charged = Boolean(snap.charged);
    player.knockouts = Number(snap.knockouts) || 0;
    player.orbs = Number(snap.orbs) || 0;
    player.seriesPoints = Number(snap.seriesPoints) || Number(player.seriesPoints) || 0;
    player.battleWins = Number(snap.battleWins) || Number(player.battleWins) || 0;
  });
}

function makeSnapshot() {
  return {
    battleNumber,
    mapIndex: currentMapIndex,
    players: players.map((player) => ({
      id: player.id, x: player.x, y: player.y, vx: player.vx, vy: player.vy,
      alive: player.alive, charged: player.charged, knockouts: player.knockouts, orbs: player.orbs,
      seriesPoints: player.seriesPoints, battleWins: player.battleWins,
    })),
    tiles: tiles.filter((tile) => tile.level > 0).map((tile) => ({ key: tile.key, level: tile.level })),
    safeRadius,
    orb: orb ? { id: orb.id, x: orb.x, y: orb.y, until: orb.until } : null,
  };
}

function awardBattleSeriesPoints() {
  const standings = getStandings();
  const points = [5, 3, 2, 1];
  standings.forEach((player, index) => {
    player.seriesPoints = Number(player.seriesPoints || 0) + (points[index] || 0);
    if (index === 0) player.battleWins = Number(player.battleWins || 0) + 1;
  });
  return standings;
}

function finishRound(winnerId, reason = "最後站著的人") {
  if (state === GAME_STATE.RESULT || state === GAME_STATE.EXIT || seriesFinished) return;
  state = GAME_STATE.RESULT;
  stateStartedAt = now();
  players.forEach((player) => {
    if (player.alive) player.survival = Math.max(player.survival, (now() - matchStartedAt) / 1000);
  });
  const standings = isHost() ? awardBattleSeriesPoints() : getStandings();
  // Host 在本戰結算後，把累積中的系列賽分數寫回下一戰的參賽名單。
  // 否則第二戰開始時會重新建立玩家，導致前一戰的分數遺失。
  if (isHost()) seriesParticipants = [...players];
  const winner = standings.find((p) => p.id === winnerId) || standings[0];
  const resultRows = standings.slice(0, 10).map((player, index) => ({
    id: player.id, name: player.name, rank: index + 1,
    seriesPoints: Number(player.seriesPoints || 0), battleWins: Number(player.battleWins || 0),
    knockouts: Number(player.knockouts || 0), survival: Math.floor(player.survival || 0),
  }));
  const final = battleNumber >= SERIES_BATTLES;
  showResults(winner, reason, resultRows, final);

  if (!isHost()) return;
  const battlePayload = { battleNumber, winnerId: winner?.id || null, reason, standings: resultRows, nextBattleNumber: battleNumber + 1, nextMapIndex: battleNumber % MAPS.length };
  if (!mockMode) sendEvent("BATTLE_END", battlePayload);

  if (!final) {
    if (battleTransitionTimer) clearTimeout(battleTransitionTimer);
    battleTransitionTimer = setTimeout(() => {
      battleTransitionTimer = null;
      battleNumber += 1;
      currentMapIndex = (battleNumber - 1) % MAPS.length;
      const roundId = `${roomId}-${Date.now()}-B${battleNumber}`;
      const startAt = Date.now() + 1100;
      const participants = exportParticipants();
      sendEvent("FLOOR_ROUND_START", { roundId, battleNumber, mapIndex: currentMapIndex, startAt, participants });
      beginCountdown(startAt, { roundId, participants, battleNumber, mapIndex: currentMapIndex, broadcast: false });
    }, 3000);
  } else {
    seriesFinished = true;
    const seriesStanding = [...players].sort((a, b) => Number(b.seriesPoints || 0) - Number(a.seriesPoints || 0) || Number(b.battleWins || 0) - Number(a.battleWins || 0));
    const endPayload = {
      winnerId: seriesStanding[0]?.id || null,
      standings: seriesStanding.map((player, index) => ({ id: player.id, name: player.name, rank: index + 1, seriesPoints: Number(player.seriesPoints || 0), battleWins: Number(player.battleWins || 0) })).slice(0, 10),
    };
    if (!mockMode) sendEvent("SERIES_END", endPayload);
  }
}

function applyBattleEnd(payload) {
  if (Number(payload.battleNumber) !== Number(battleNumber) || !Array.isArray(payload.standings)) return;
  // 非 Host 收到 BATTLE_END 時也必須切入 RESULT，否則下一戰事件會被 PLAYING guard 擋掉。
  state = GAME_STATE.RESULT;
  stateStartedAt = now();
  payload.standings.forEach((row) => {
    const player = players.find((p) => p.id === String(row.id));
    if (!player) return;
    player.seriesPoints = Number(row.seriesPoints) || player.seriesPoints || 0;
    player.battleWins = Number(row.battleWins) || player.battleWins || 0;
  });
  const winner = players.find((p) => p.id === String(payload.winnerId)) || getStandings()[0];
  showResults(winner, payload.reason || "本戰結束", payload.standings, battleNumber >= SERIES_BATTLES);
}

function applySeriesEnd(payload) {
  seriesFinished = true;
  state = GAME_STATE.RESULT;
  stateStartedAt = now();
  if (Array.isArray(payload.standings)) {
    payload.standings.forEach((row) => {
      const player = players.find((p) => p.id === String(row.id));
      if (!player) return;
      player.seriesPoints = Number(row.seriesPoints) || player.seriesPoints || 0;
      player.battleWins = Number(row.battleWins) || player.battleWins || 0;
    });
  }
  const winner = players.find((p) => p.id === String(payload.winnerId)) || [...players].sort((a, b) => Number(b.seriesPoints || 0) - Number(a.seriesPoints || 0) || Number(b.battleWins || 0) - Number(a.battleWins || 0))[0];
  showResults(winner, "五戰總冠軍", payload.standings || [], true);
}

function getStandings() {
  return [...players].sort((a, b) => {
    if (a.alive !== b.alive) return Number(b.alive) - Number(a.alive);
    if (b.knockouts !== a.knockouts) return b.knockouts - a.knockouts;
    if (b.survival !== a.survival) return b.survival - a.survival;
    return b.orbs - a.orbs;
  });
}

function showResults(winner, reason, rows = [], final = false) {
  $("#resultKicker").textContent = final ? "五戰總結" : `第 ${battleNumber} 戰結算`;
  $("#resultTitle").textContent = final
    ? (winner?.id === localPlayer?.id ? "你拿下五戰總冠軍！" : `${winner?.name || "無人"} 拿下五戰總冠軍`)
    : (winner?.id === localPlayer?.id ? "你贏下這一戰！" : `${winner?.name || "無人"} 拿下本戰`);
  const list = (Array.isArray(rows) && rows.length ? rows : getStandings().slice(0, 6).map((player, index) => ({
    id: player.id, name: player.name, rank: index + 1, seriesPoints: player.seriesPoints || 0, battleWins: player.battleWins || 0,
  }))).slice(0, 6);
  $("#resultList").innerHTML = list.map((row, index) => `
    <div class="result-row">
      <span class="result-rank">0${Number(row.rank || index + 1)}</span>
      <span class="result-name">${escapeHtml(row.name || "玩家")}${String(row.id) === String(localPlayer?.id) ? "（你）" : ""}</span>
      <span class="result-meta">${Number(row.seriesPoints || 0)} 分 · ${Number(row.battleWins || 0)} 勝</span>
    </div>`).join("");
  $(".result-foot").textContent = final ? "五戰完成 · 正在結算並返回房間" : `下一戰：${getMapForBattle(battleNumber + 1).name} · 3 秒後開始`;
  resultNode.classList.add("show");
  renderRoomHud();
  if (winner?.id === localPlayer?.id) { pingSound("pickup", 0.9, 1.18); vibrate([35, 25, 55]); }

  if (final) {
    setTimeout(() => {
      if (state !== GAME_STATE.RESULT || !seriesFinished) return;
      if (!gameOverCalled) {
        gameOverCalled = true;
        const reward = winner?.id === localPlayer?.id ? 10 : localPlayer?.alive ? 4 : 2;
        try { sdk.gameOver?.(reward); } catch (error) { console.warn("BoomRoom gameOver failed", error); }
      }
      state = GAME_STATE.EXIT;
      if (!exitSent) {
        exitSent = true;
        try {
          // Web iframe：按照 BoomRoom 規範，必須以 JSON 字串傳給父頁面。
          // Android WebView：gameOver() 會經由 BoomRoomJS channel 交給 Flutter，
          // Flutter 收到 game_over 後負責 Navigator.pop() 返回房間；這裡絕不能再
          // 猜測 ../room.html，否則 WebView 會先導航到不存在的頁面而出現 404。
          if (window.parent && window.parent !== window) {
            window.parent.postMessage(
              JSON.stringify({
                action: "leaveGame",
                gameId: "floor_brawl",
                roomId,
                reason: "SERIES_COMPLETE"
              }),
              "*"
            );
          }
        } catch (error) {
          console.warn("BoomRoom leaveGame message failed", error);
        }
      }
      resultNode.classList.remove("show");
      showCallout("五戰結束 · 返回房間");
    }, 3000);
  }
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
    const remain = Math.max(0, Number(roundStartAt || countdownEndsAt || Date.now()) - Date.now());
    const number = Math.ceil(remain / 1000);
    if (number <= 0) startPlaying();
    else if (number !== Math.ceil(Math.max(0, remain + dt * 1000) / 1000)) {
      showCallout(String(number));
      pingSound("crack", 0.17, number === 1 ? 1.3 : 1);
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
  const map = getMapForBattle(battleNumber);
  if (timeLeft <= 10 && !overtimeAt) {
    const progress = (10 - timeLeft) / 10;
    safeRadius = Math.max(0.48, map.radius - progress * 0.34);
  }
  if (timeLeft === 0 && !overtimeAt) { overtimeAt = timestamp; showCallout("加時！撐住！"); }
  if (overtimeAt) safeRadius = Math.max(0.28, map.radius - 0.34 - ((timestamp - overtimeAt) / 1000) * 0.034);

  const host = isHost();
  const input = currentMoveInput();
  players.forEach((player) => {
    if (!player.alive) return;
    if (player.isLocal) {
      if (length(input.x, input.y) > 0.08) { player.faceX = input.x; player.faceY = input.y; }
      const onHit = now() < player.hitUntil;
      if (!onHit && now() >= player.dashUntil) {
        player.vx += (input.x * 0.72 - player.vx) * Math.min(1, dt * 8);
        player.vy += (input.y * 0.72 - player.vy) * Math.min(1, dt * 8);
      }
    } else if (player.isBot) {
      if (host) updateBot(player, timestamp / 1000);
    } else if (player.targetX != null) {
      player.x += (player.targetX - player.x) * 0.18;
      player.y += (player.targetY - player.y) * 0.18;
    }

    if (now() < player.dashUntil) { player.vx = player.dashX * 2.45; player.vy = player.dashY * 2.45; }
    else if (now() >= player.hitUntil) { player.vx *= Math.pow(0.08, dt); player.vy *= Math.pow(0.08, dt); }
    else { player.vx *= Math.pow(0.22, dt); player.vy *= Math.pow(0.22, dt); }

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
    if (!orb && timestamp - lastOrbAt > 6400) { lastOrbAt = timestamp; spawnOrb(); }
    if (orb && Date.now() > orb.until) { orb = null; sendEvent("ORB_STATE", { active: false }); }
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
      finishRound(living[0]?.id || getStandings()[0]?.id, "最後站著的人");
    } else if (overtimeAt && timestamp - overtimeAt > OVERTIME_SECONDS * 1000) {
      finishRound(getStandings()[0]?.id, "時間到");
    }
  }

  if (host && timestamp - lastSnapshotAt > 1000 && !mockMode) {
    lastSnapshotAt = timestamp;
    sendEvent("GAME_STATE", makeSnapshot());
  }

  if (timestamp - lastNetAt > 95 && localPlayer) {
    lastNetAt = timestamp;
    sendEvent("PLAYER_MOVE", {
      playerId: localPlayer.id,
      battleNumber,
      x: localPlayer.x, y: localPlayer.y,
      vx: localPlayer.vx, vy: localPlayer.vy,
      faceX: localPlayer.faceX, faceY: localPlayer.faceY,
      dashing: timestamp < localPlayer.dashUntil,
    });
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
  renderRoomHud();
  const alive = players.filter((player) => player.alive);
  aliveNode.textContent = String(alive.length);
  timerNode.textContent = overtimeAt
    ? `+${Math.max(0, OVERTIME_SECONDS - Math.floor((timestamp - overtimeAt) / 1000))}`
    : String(Math.max(0, Math.ceil(cachedTimeLeft)));
  timerNode.parentElement.classList.toggle("urgent", cachedTimeLeft <= 8 || Boolean(overtimeAt));
  if (state === GAME_STATE.LOADING) placeNode.textContent = mockMode ? "開發單機" : "連線中";
  else if (state === GAME_STATE.COUNTDOWN) placeNode.textContent = `第 ${battleNumber} 戰 · 進場`;
  else if (state === GAME_STATE.PLAYING) {
    const position = getStandings().findIndex((player) => player.id === localPlayer?.id);
    placeNode.textContent = localPlayer?.alive ? `本戰第 ${Math.max(1, position + 1)} 名` : "已出局";
  } else if (state === GAME_STATE.RESULT) {
    placeNode.textContent = seriesFinished ? "五戰已完成" : `第 ${battleNumber} 戰結束`;
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
  const radius = Math.max(1, board.side * 0.455 * (getMapForBattle(battleNumber).radius / 1.03));
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
  const side = Math.max(180, board.side);
  const map = getMapForBattle(battleNumber);
  const unit = side * 0.90;
  const tileSize = unit / Math.max(1, gridSize);
  ctx.save();

  // 明確的主地板底座：即使所有格子都塌掉，也仍然能看見競技場。
  const floorRadius = side * 0.455 * (map.radius / 1.03);
  ctx.fillStyle = "rgba(21, 28, 73, .95)";
  ctx.strokeStyle = "rgba(152, 172, 255, .48)";
  ctx.lineWidth = 3;
  roundedRect(ctx, board.x - floorRadius, board.y - floorRadius, floorRadius * 2, floorRadius * 2, Math.min(28, side * .06));
  ctx.fill();
  ctx.stroke();

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
      ctx.fillStyle = "rgba(7, 9, 30, .72)";
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
    ctx.fillStyle = warning ? `rgba(255, 99, 136, ${0.34 + pulse * 0.25})` : "rgba(10, 16, 49, .92)";
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
      tileGradient.addColorStop(0, index % 2 ? "rgb(82, 105, 181)" : "rgb(73, 94, 169)");
      tileGradient.addColorStop(1, index % 2 ? "rgb(45, 61, 125)" : "rgb(39, 55, 117)");
    }
    ctx.fillStyle = tileGradient;
    ctx.fill();
    ctx.strokeStyle = warning ? `rgba(255, 135, 165, ${0.65 + pulse * 0.25})` : "rgba(180, 198, 255, .34)";
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

  // 再畫一次乾淨的格線，讓玩家永遠能辨識地板格子。
  ctx.save();
  const gridUnit = unit / Math.max(1, gridSize);
  const gridLeft = board.x - unit / 2;
  const gridTop = board.y - unit / 2;
  ctx.strokeStyle = "rgba(204, 219, 255, .20)";
  ctx.lineWidth = 1;
  for (let i = 1; i < gridSize; i += 1) {
    const gx = gridLeft + gridUnit * i;
    const gy = gridTop + gridUnit * i;
    ctx.beginPath(); ctx.moveTo(gx, gridTop); ctx.lineTo(gx, gridTop + unit); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(gridLeft, gy); ctx.lineTo(gridLeft + unit, gy); ctx.stroke();
  }
  ctx.restore();

  const ring = board.side * 0.455 * safeRadius;
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
  const radius = Math.max(15, Math.min(28, board.side * 0.037));
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

window.addEventListener("pagehide", () => {
  if (state === GAME_STATE.PLAYING && localPlayer?.alive && !seriesFinished) {
    sendEvent("PLAYER_ABANDONED", { playerId: localPlayer.id, battleNumber, roundId: currentRoundId });
  }
});

// 啟動唯一主遊戲迴圈；並立即畫第一幀，避免 WebView 首畫面只有 UI。
requestAnimationFrame(frame);
requestAnimationFrame((t) => draw(t));

setInterval(() => {
  if (!sdkReady) return;
  sendRoomHello();
  if (isHost()) {
    const phase = state === GAME_STATE.PLAYING ? "PLAYING" : state === GAME_STATE.COUNTDOWN ? "COUNTDOWN" : "WAITING";
    sendRoomSync(phase);
    if (state !== GAME_STATE.PLAYING && state !== GAME_STATE.RESULT && state !== GAME_STATE.EXIT) scheduleSeriesAutoStart();
  }
}, HEARTBEAT_MS);

boot().catch((error) => {
  console.error("Game initialization failed", error);
  try { startMockFallback(); } catch {}
});
