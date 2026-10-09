const $ = (selector) => document.querySelector(selector);
const canvas = $("#field");
const ctx = canvas.getContext("2d", { alpha: false });
const clockEl = $("#clock");
const standingsEl = $("#standings");
const hintEl = $("#hint");
const toastEl = $("#toast");
const countdownEl = $("#countdown");
const resultEl = $("#result");
const podiumEl = $("#podium");
const joyEl = $("#joystick");
const joyKnob = $("#joyKnob");
const dashEl = $("#dash");

const W = 1000;
let H = 700;
const DURATION = 60;
const TARGET_SCORE = 5;
const COLORS = ["#f0784e", "#5299db", "#b46bd2", "#e3a52f", "#38aa87", "#dd668e", "#6d79db", "#83a940", "#dc7357", "#47a7b5"];
const STAGE = { x: 34, y: 74, w: 932, h: 570 };
const nests = [];
const players = new Map();
const particles = [];
const floatingTexts = [];
const keys = new Set();
const obstacles = [];

let GAME_STATE = "LOADING";
let sdk = window.BoomRoomSDK || null;
let sdkInitialized = false;
let localId = "mock-local";
let localName = "你";
let isHost = true;
let roomId = "mock-room";
let mockMode = true;
let playerSequence = 0;
let roundStartAt = 0;
let roundEndAt = 0;
let resultAt = 0;
let lastFrameAt = performance.now();
let lastOwnSend = 0;
let lastBotSend = 0;
let lastChickenSend = 0;
let lastCornSend = 0;
let lastFootstepAt = 0;
let lastHudUpdate = 0;
let lastHintAt = 0;
let toastToken = 0;
let stopReason = "";
let matchWinnerId = null;
let gameOverCalled = false;
let returning = false;
let screenShake = 0;
let lastCarrierId = null;
let chicken = { x: 500, y: 338, vx: 0, vy: 0, holderId: null, targetX: 500, targetY: 340, nextWanderAt: 0, panicUntil: 0, frenzyUntil: 0, nextFrenzyAt: 0 };
const corn = { active: false, x: 500, y: 350, expiresAt: 0, nextSpawnAt: 0 };
let audioContext = null;
let musicTimer = null;
let musicStep = 0;
let audioStarted = false;
let layout = { scale: 1, ox: 0, oy: 0 };
let joystickPointer = null;
let joyVector = { x: 0, y: 0 };
let dashHeld = false;
let touchMode = false;
let simulationTime = 0;
let localScoreBeforeResult = 0;

const now = () => performance.now();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const random = (min, max) => min + Math.random() * (max - min);
const playerList = () => [...players.values()].filter((p) => !p.disconnected);

const mockSDK = {
  getUser: () => ({ id: localId, username: localName }),
  get isHost() { return true; },
  get roomId() { return roomId; },
  get roomPlayers() {
    return playerList().map((player) => ({ id: player.id, username: player.name }));
  },
  sendGameEvent(eventName, payload) {
    window.dispatchEvent(new CustomEvent("mockGameEventSent", { detail: { eventName, payload } }));
  },
  requestPurchase(itemId, cost) {
    return Promise.resolve({ success: false, itemId, cost, mock: true });
  },
  gameOver(winAmount) {
    console.info("[BoomRoom mock] gameOver:", winAmount);
  },
  receive(eventName, payload = {}, senderId = "mock-remote") {
    handleGameEvent(eventName, payload, senderId);
  }
};
window.BoomRoomMock = mockSDK;

function sendEvent(name, payload = {}) {
  const bridge = sdk && typeof sdk.sendGameEvent === "function" ? sdk : mockSDK;
  try {
    bridge.sendGameEvent(name, payload);
  } catch (error) {
    console.warn("BoomRoom event send failed:", name, error);
  }
}

function vibrate(pattern = 18) {
  try { navigator.vibrate?.(pattern); } catch (_) {}
}

function wakeAudio() {
  if (audioContext) {
    if (audioContext?.state === "suspended") audioContext.resume().catch(() => {});
    return;
  }
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    audioContext = new AudioCtx();
    audioStarted = true;
    audioContext.resume().catch(() => {});
    musicTimer = window.setInterval(playMusicNote, 430);
  } catch (_) {}
}

function tone(frequency, duration = 0.11, type = "sine", volume = 0.045, slide = 0) {
  if (!audioContext || audioContext.state !== "running") return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const start = audioContext.currentTime;
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(Math.max(35, frequency), start);
  if (slide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(35, frequency + slide), start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.025);
}

function playMusicNote() {
  if (!audioContext || audioContext.state !== "running" || GAME_STATE === "RESULT" || GAME_STATE === "EXIT") return;
  const ending = GAME_STATE === "PLAYING" && roundEndAt - Date.now() < 10000;
  const notes = ending
    ? [262, 330, 392, 330, 294, 370, 440, 370]
    : [196, 247, 294, 247, 220, 262, 330, 262];
  const beat = musicStep++ % notes.length;
  tone(notes[beat], 0.19, "triangle", ending ? 0.012 : 0.008);
  if (beat % 4 === 0) tone(notes[beat] / 2, 0.26, "sine", ending ? 0.016 : 0.011, 28);
  if (beat % 2 === 1) tone(1300 + (beat % 4) * 90, 0.035, "square", ending ? 0.007 : 0.004, -500);
}

function sound(kind) {
  wakeAudio();
  if (kind === "pickup") {
    tone(540, .08, "triangle", .07, 280);
    tone(880, .14, "sine", .045, 180);
  } else if (kind === "steal") {
    tone(250, .12, "sawtooth", .045, -110);
    tone(420, .09, "triangle", .05, 220);
  } else if (kind === "score") {
    tone(520, .1, "triangle", .07, 220);
    window.setTimeout(() => tone(780, .17, "sine", .055, 300), 80);
  } else if (kind === "dash") {
    tone(290, .09, "triangle", .035, 250);
  } else if (kind === "powerDash") {
    tone(220, .15, "sawtooth", .045, 520);
    window.setTimeout(() => tone(740, .12, "triangle", .055, 240), 75);
  } else if (kind === "corn") {
    tone(480, .08, "triangle", .06, 170);
    window.setTimeout(() => tone(720, .12, "sine", .05, 260), 65);
  } else if (kind === "squawk") {
    tone(680, .07, "square", .038, -250);
    window.setTimeout(() => tone(480, .1, "triangle", .045, 190), 65);
  } else if (kind === "step") {
    tone(105, .045, "sine", .012, -35);
  } else if (kind === "bump") {
    tone(155, .08, "square", .035, -50);
  } else if (kind === "count") {
    tone(410, .07, "sine", .035, 80);
  } else if (kind === "go") {
    tone(600, .12, "triangle", .07, 400);
  } else if (kind === "win") {
    tone(523, .16, "triangle", .055, 130);
    window.setTimeout(() => tone(659, .17, "triangle", .055, 170), 100);
    window.setTimeout(() => tone(784, .23, "triangle", .06, 220), 220);
  } else if (kind === "lose") {
    tone(390, .16, "triangle", .04, -90);
    window.setTimeout(() => tone(275, .22, "sine", .035, -75), 120);
  }
}

function showToast(message, duration = 1050) {
  const token = ++toastToken;
  toastEl.textContent = message;
  toastEl.classList.remove("show");
  void toastEl.offsetWidth;
  toastEl.classList.add("show");
  window.setTimeout(() => {
    if (token === toastToken) toastEl.classList.remove("show");
  }, duration);
}

function safeParse(data) {
  if (typeof data !== "string") return data;
  try { return JSON.parse(data); } catch (_) { return null; }
}

function normalizePlayer(source, index = 0) {
  const user = source?.user || source?.player || source || {};
  const id = String(user.id ?? source?.userId ?? source?.id ?? `guest-${index + 1}`);
  return {
    id,
    name: String(user.username ?? user.name ?? source?.username ?? source?.name ?? `玩家${index + 1}`).slice(0, 12),
    color: COLORS[index % COLORS.length],
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    dir: 0,
    score: 0,
    carrying: false,
    dashCharge: false,
    disconnected: false,
    bot: false,
    dashUntil: 0,
    boostedDashUntil: 0,
    nextDashAt: 0,
    dashCooldownMs: 1450,
    stunnedUntil: 0,
    remoteTargetX: 0,
    remoteTargetY: 0,
    pulse: random(0, Math.PI * 2)
  };
}

function getSDKUser() {
  try {
    const value = typeof sdk?.getUser === "function" ? sdk.getUser() : null;
    return value && typeof value.then !== "function" ? value : null;
  } catch (_) {
    return null;
  }
}

function setupSDK(data = {}) {
  if (data?.sdk) sdk = data.sdk;
  else if (window.BoomRoomSDK) sdk = window.BoomRoomSDK;

  const providedUser = data.user || getSDKUser() || {};
  const incomingRoom = Array.isArray(data.roomPlayers) ? data.roomPlayers : (Array.isArray(sdk?.roomPlayers) ? sdk.roomPlayers : []);
  const hostValue = data.isHost ?? sdk?.isHost;
  roomId = String(data.roomId ?? sdk?.roomId ?? "mock-room");
  isHost = hostValue === undefined ? true : !!hostValue;
  mockMode = !sdk;

  const userId = String(providedUser.id ?? providedUser.userId ?? "mock-local");
  const userName = String(providedUser.username ?? providedUser.name ?? "你");
  if (localId !== userId && players.size && GAME_STATE !== "LOADING") {
    const old = players.get(localId);
    if (old) players.delete(localId);
  }
  localId = userId;
  localName = userName.slice(0, 12);

  const sources = incomingRoom.slice(0, 10);
  let localIndex = sources.findIndex((entry) => String((entry?.user || entry)?.id ?? entry?.userId ?? "") === localId);
  if (localIndex < 0) {
    sources.unshift({ id: localId, username: localName });
    localIndex = 0;
  }
  sources.splice(10);
  const desiredCount = clamp(sources.length, 1, 10);
  sources.forEach((entry, index) => {
    const normalized = normalizePlayer(entry, index);
    const existing = players.get(normalized.id);
    if (existing) {
      existing.name = normalized.id === localId ? localName : normalized.name;
      existing.color = COLORS[index % COLORS.length];
      existing.disconnected = false;
    } else {
      players.set(normalized.id, normalized);
    }
  });

  if (mockMode) {
    const requested = Number(new URLSearchParams(location.search).get("players"));
    const targetCount = Number.isFinite(requested) && requested >= 1 && requested <= 10 ? Math.round(requested) : 4;
    const total = Math.max(4, targetCount);
    while (playerList().length < total) {
      const index = playerList().length;
      const bot = normalizePlayer({ id: `mock-bot-${index}`, username: ["Clucky", "豆豆", "阿毛", "小麥", "Pip", "蛋黃", "啾啾", "栗子", "花生"][index % 9] }, index);
      bot.bot = true;
      bot.name=`🤖 ${bot.name} AI`;
      players.set(bot.id, bot);
    }
    for (const player of playerList()) player.bot = player.id !== localId;
  } else {
    for(const player of playerList()){
      if(player.id.startsWith('cpu-')){
        player.bot=true;
        if(desiredCount>1){players.delete(player.id);}
      }else player.bot=false;
    }
    if (desiredCount === 1 && isHost) {
      for (let i = 0; i < 3; i++) {
        const id = `cpu-${roomId}-${i}`;
        if (!players.has(id)) {
          const bot = normalizePlayer({ id, username: ["小麥", "Pip", "豆豆"][i] }, playerList().length);
          bot.bot = true;
          bot.name=`🤖 ${bot.name} AI`;
          players.set(id, bot);
        }
      }
    }
    const liveIDs = new Set(sources.map((entry) => String((entry?.user || entry)?.id ?? entry?.userId ?? entry?.id ?? "")));
    for (const player of playerList()) {
      if (!player.bot && player.id !== localId && liveIDs.size && !liveIDs.has(player.id)) player.disconnected = true;
    }
  }

  arrangePlayers();
  if (!sdkInitialized) {
    sdkInitialized = true;
    beginAutomaticRound();
  }
  updateStandings();
}

function arrangePlayers() {
  const list = playerList();
  const count = Math.max(1, list.length);
  list.forEach((player, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
    const x = 500 + Math.cos(angle) * 340;
    const y = STAGE.y + STAGE.h * .5 + Math.sin(angle) * STAGE.h * .36;
    if (!player.x || !player.y) {
      player.x = x;
      player.y = y;
      player.remoteTargetX = x;
      player.remoteTargetY = y;
    }
    nests[index] = { id: player.id, x, y, color: player.color, index };
    player.nestIndex = index;
  });
  nests.length = count;
}

function beginAutomaticRound() {
  if (GAME_STATE !== "LOADING") return;
  if(!mockMode&&!isHost){sendEvent('PLAYER_READY',{userId:localId});return;}
  GAME_STATE = "COUNTDOWN";
  roundStartAt = Date.now() + 3500;
  roundEndAt = roundStartAt + DURATION * 1000;
  if (isHost) sendEvent("ROUND_START", { roomId, startAt: roundStartAt, duration: DURATION });
}

function startCountdown(startAt = Date.now() + 3500) {
  if(startAt===roundStartAt)return;
  if(GAME_STATE==='RESULT')resetRoundForReplay();
  if (GAME_STATE === "PLAYING" || GAME_STATE === "EXIT") return;
  GAME_STATE = "COUNTDOWN";
  roundStartAt = startAt;
  roundEndAt = roundStartAt + DURATION * 1000;
}

function handleGameEvent(eventName, payload = {}, senderId = "") {
  const data = payload && typeof payload === "object" ? payload : {};
  if(eventName==='PLAYER_READY'){
    if(isHost&&['COUNTDOWN','PLAYING'].includes(GAME_STATE))sendEvent('ROUND_START',{roomId,startAt:roundStartAt,duration:DURATION});
  }else if (eventName === "ROUND_START") {
    if (!isHost || GAME_STATE === "LOADING") startCountdown(Number(data.startAt) || Date.now() + 2500);
  } else if (eventName === "PLAYER_STATE") {
    const id = String(data.userId || senderId || "");
    if (!id || id === localId) return;
    let player = players.get(id);
    if (!player) {
      player = normalizePlayer({ id, username: data.name || "玩家" }, players.size);
      players.set(id, player);
      arrangePlayers();
    }
    if (Number.isFinite(data.x) && Number.isFinite(data.y)) {
      player.remoteTargetX = clamp(data.x, STAGE.x + 22, STAGE.x + STAGE.w - 22);
      player.remoteTargetY = clamp(data.y, STAGE.y + 28, STAGE.y + STAGE.h - 25);
      player.dir = Number(data.dir) || player.dir;
      player.disconnected = false;
    }
  } else if (eventName === "CHICKEN_STATE") {
    if (isHost) return;
    const previousHolder = chicken.holderId;
    if (Number.isFinite(data.x) && Number.isFinite(data.y)) {
      chicken.x = data.x;
      chicken.y = data.y;
    }
    chicken.holderId = data.holderId ? String(data.holderId) : null;
    if (Number.isFinite(data.frenzyUntil)) chicken.frenzyUntil = data.frenzyUntil;
    updateCarrying();
    if (!previousHolder && chicken.holderId) {
      const holder = players.get(chicken.holderId);
      sound("pickup");
      if (holder?.id === localId) {
        vibrate(15);
        showToast("抓到雞了！帶回你的窩");
      } else if (holder) showToast(`${holder.name} 抓到雞了！`);
    }
  } else if (eventName === "CHICKEN_FRENZY") {
    if (isHost) return;
    chicken.frenzyUntil = Number(data.until) || Date.now() + 1600;
    sound("squawk");
    vibrate(9);
    screenShake = Math.max(screenShake, 2.5);
    showToast("雞暴走了！快追！");
  } else if (eventName === "CORN_STATE") {
    if (isHost) return;
    const wasActive = corn.active;
    corn.active = !!data.active;
    corn.x = Number.isFinite(data.x) ? data.x : corn.x;
    corn.y = Number.isFinite(data.y) ? data.y : corn.y;
    corn.expiresAt = Number(data.expiresAt) || 0;
    if (!wasActive && corn.active) {
      showToast("金玉米出現！強化下一次衝刺");
      sound("corn");
      vibrate(12);
    }
  } else if (eventName === "PLAYER_POWERUP") {
    if (isHost) return;
    const player = players.get(String(data.userId || senderId || ""));
    if (player) {
      const newlyCharged = !!data.dashCharge && !player.dashCharge;
      player.dashCharge = !!data.dashCharge;
      if (newlyCharged && player.id === localId) {
        sound("corn");
        vibrate([10, 18, 28]);
        showToast("金玉米到手！下一次衝刺更強");
      }
    }
  } else if (eventName === "PLAYER_DASH") {
    const id = String(data.userId || senderId || "");
    if (!id || id === localId) return;
    let player = players.get(id);
    if (!player) {
      player = normalizePlayer({ id, username: data.name || "玩家" }, players.size);
      players.set(id, player);
      arrangePlayers();
    }
    if (Number.isFinite(data.dir)) player.dir = data.dir;
    activateDash(player, false);
  } else if (eventName === "PLAYER_SCORED") {
    if (isHost) return;
    const player = players.get(String(data.userId || ""));
    if (player && Number.isFinite(data.score)) {
      player.score = data.score;
      updateStandings();
      showToast(player.id === localId ? `送回雞舍！ +${Number(data.earned) || 1}` : `${player.name} 得分！`);
      sound("score");
      if (player.id === localId) vibrate([12, 30, 22]);
      burst(Number(data.x) || player.x, Number(data.y) || player.y, player.color, 22);
    }
  } else if (eventName === "CHICKEN_STOLEN") {
    if (isHost) return;
    const victim = players.get(String(data.fromId || ""));
    const thief = players.get(String(data.toId || ""));
    if (victim) victim.stunnedUntil = now() + 220;
    if (thief) {
      chicken.holderId = thief.id;
      chicken.x = thief.x;
      chicken.y = thief.y - 18;
      const involved = thief.id === localId || victim?.id === localId;
      if (involved) showToast(thief.id === localId ? "搶到雞了！" : "雞被搶走了！");
      else showToast(`${thief.name} 搶走雞！`);
      burst(thief.x, thief.y, "#fff5c0", 13);
      if (involved) {
        sound("steal");
        vibrate(thief.id === localId ? [14, 20, 24] : [26, 18, 35]);
      }
      updateCarrying();
    }
  } else if (eventName === "GAME_RESULT") {
    if (isHost) return;
    applyResult(data.winnerId ? String(data.winnerId) : null, data.scores || null);
  } else if (eventName === "PLAYER_LEFT") {
    const player = players.get(String(data.userId || senderId || ""));
    if (player && player.id !== localId) {
      player.disconnected = true;
      if (chicken.holderId === player.id && isHost) dropChicken(player, true);
      arrangePlayers();
    }
  }
}

function updateCarrying() {
  for (const player of players.values()) player.carrying = player.id === chicken.holderId;
}

window.initBoomRoomSDK = function (data) {
  setupSDK(data || {});
};

window.onBoomRoomSDKReady = function () {
  sdk = window.BoomRoomSDK || sdk;
  const init = (user) => setupSDK({
    user: user || {},
    isHost: sdk?.isHost,
    roomId: sdk?.roomId,
    roomPlayers: sdk?.roomPlayers || []
  });
  try {
    const user = typeof sdk?.getUser === "function" ? sdk.getUser() : null;
    if (user && typeof user.then === "function") {
      init(null);
      user.then(init).catch(() => {});
    }
    else init(user);
  } catch (_) {
    init(null);
  }
};

window.addEventListener("message", (event) => {
  if(sdk?.onGameEvent)return;
  const data = safeParse(event.data);
  if (!data || typeof data !== "object") return;
  if (data.action === "initSDK") setupSDK(data);
  else if (data.action === "gameEventReceived" || data.eventName || data.name) {
    const eventName = data.eventName || data.name;
    const payload = data.payload || {};
    const senderId = data.userId || data.senderId || "";
    handleGameEvent(eventName, payload, senderId);
  }
});
window.addEventListener("gameEventReceived", (event) => {
  if(sdk?.onGameEvent)return;
  const data = event.detail || {};
  handleGameEvent(data.eventName || data.name, data.payload || {}, data.userId || data.senderId || "");
});

if(sdk?.onGameEvent){
  const controls=new Set(['ROUND_START','CHICKEN_STATE','CHICKEN_FRENZY','CORN_STATE','PLAYER_POWERUP','PLAYER_SCORED','CHICKEN_STOLEN','GAME_RESULT']);
  sdk.onGameEvent((eventName,payload,senderId)=>{
    const session=sdk.getSession(),sender=String(senderId||'');
    if(!session?.players.some(p=>String(p.userId)===sender))return;
    if(controls.has(eventName)&&sender!==String(session.hostId))return;
    if(['PLAYER_STATE','PLAYER_DASH','PLAYER_LEFT','PLAYER_READY'].includes(eventName)&&String(payload?.userId)!==sender)return;
    if(payload?.userId&&String(payload.userId)!==sender&&sender!==String(session.hostId))return;
    handleGameEvent(eventName,payload,sender);
  });
}
if (window.BoomRoomSDK) window.onBoomRoomSDKReady();
else setupSDK({});

function resize() {
  const previousStage = { y: STAGE.y, h: STAGE.h };
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  H = W * canvas.height / canvas.width;
  STAGE.y = H * .11;
  STAGE.h = H * .71;
  layout.scale = canvas.width / W;
  layout.ox = 0;
  layout.oy = 0;
  obstacles.splice(
    0,
    obstacles.length,
    { x: 300, y: STAGE.y + STAGE.h * .31, r: 27, kind: "hay" },
    { x: 700, y: STAGE.y + STAGE.h * .31, r: 27, kind: "hay" },
    { x: 300, y: STAGE.y + STAGE.h * .69, r: 27, kind: "hay" },
    { x: 700, y: STAGE.y + STAGE.h * .69, r: 27, kind: "hay" },
    { x: 500, y: STAGE.y + STAGE.h * .5, r: 34, kind: "pond" }
  );
  if (previousStage.h > 0) {
    const ratio = STAGE.h / previousStage.h;
    for (const player of players.values()) {
      player.y = STAGE.y + (player.y - previousStage.y) * ratio;
      player.remoteTargetY = STAGE.y + (player.remoteTargetY - previousStage.y) * ratio;
      player.vy *= ratio;
    }
    chicken.y = STAGE.y + (chicken.y - previousStage.y) * ratio;
    chicken.targetY = STAGE.y + (chicken.targetY - previousStage.y) * ratio;
    chicken.vy *= ratio;
    arrangePlayers();
  }
}

window.addEventListener("resize", resize);
resize();

function spawnParticle(x, y, color, vx, vy, size, life, shape = "circle") {
  particles.push({ x, y, color, vx, vy, size, life, maxLife: life, shape, rot: random(0, Math.PI * 2), spin: random(-5, 5) });
}

function burst(x, y, color = "#fff2a5", amount = 12) {
  for (let i = 0; i < amount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = random(45, 190);
    spawnParticle(x, y, color, Math.cos(angle) * speed, Math.sin(angle) * speed - 25, random(3, 8), random(.32, .72), Math.random() < .4 ? "star" : "circle");
  }
}

function popText(text, x, y, color = "#fff9cf", size = 22) {
  floatingTexts.push({ text, x, y, color, size, life: .9, maxLife: .9, vy: -40 });
}

function updateEffects(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 120 * dt;
    p.vx *= Math.pow(.1, dt);
    p.rot += p.spin * dt;
  }
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const item = floatingTexts[i];
    item.life -= dt;
    if (item.life <= 0) { floatingTexts.splice(i, 1); continue; }
    item.y += item.vy * dt;
  }
  screenShake = Math.max(0, screenShake - dt * 22);
}

function activateDash(player, isLocal = false) {
  if (GAME_STATE !== "PLAYING") return false;
  const time = now();
  if (time < player.nextDashAt || time < player.stunnedUntil) return false;
  const powered = player.dashCharge;
  player.dashCharge = false;
  player.dashUntil = time + (powered ? 410 : 270);
  player.boostedDashUntil = powered ? player.dashUntil : 0;
  player.dashCooldownMs = powered ? 880 : 1450;
  player.nextDashAt = time + player.dashCooldownMs;
  const speed = (player.carrying ? 460 : 590) * (powered ? 1.28 : 1);
  player.vx += Math.cos(player.dir) * speed;
  player.vy += Math.sin(player.dir) * speed;
  if (isLocal) {
    sound(powered ? "powerDash" : "dash");
    vibrate(powered ? [14, 22, 28] : 9);
    popText(powered ? "超級衝刺！" : "嗖！", player.x, player.y - 22, powered ? "#ffe774" : "#fff6c9", powered ? 22 : 18);
  }
  if (isLocal || (player.bot && isHost)) {
    sendEvent("PLAYER_DASH", {
      userId: player.id,
      name: player.name,
      x: Math.round(player.x),
      y: Math.round(player.y),
      dir: Math.round(player.dir * 100) / 100
    });
  }
  return true;
}

function getLocalInput() {
  let x = joyVector.x;
  let y = joyVector.y;
  if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) x -= 1;
  if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) x += 1;
  if (keys.has("ArrowUp") || keys.has("w") || keys.has("W")) y -= 1;
  if (keys.has("ArrowDown") || keys.has("s") || keys.has("S")) y += 1;
  const magnitude = Math.hypot(x, y);
  if (magnitude > 1) { x /= magnitude; y /= magnitude; }
  return { x, y, sprint: dashHeld || keys.has(" ") || keys.has("Shift") };
}

function updateLocalPlayer(player, dt) {
  const input = getLocalInput();
  if (input.x || input.y) player.dir = Math.atan2(input.y, input.x);
  if (input.sprint && now() >= player.nextDashAt) activateDash(player, true);
  movePlayer(player, input.x, input.y, dt, false);
  if (Math.hypot(player.vx, player.vy) > 95 && now() - lastFootstepAt > 430) {
    lastFootstepAt = now();
    sound("step");
  }
}

function movePlayer(player, inputX, inputY, dt, ai = false) {
  const isStunned = now() < player.stunnedUntil;
  if (isStunned) { inputX *= .25; inputY *= .25; }
  const sprint = now() < player.dashUntil;
  const maxSpeed = player.carrying ? 153 : 184;
  const speed = maxSpeed * (sprint ? 2.2 : 1);
  const accel = sprint ? 11 : 9;
  player.vx += (inputX * speed - player.vx) * Math.min(1, accel * dt);
  player.vy += (inputY * speed - player.vy) * Math.min(1, accel * dt);
  if (!inputX && !inputY) {
    player.vx *= Math.pow(.035, dt);
    player.vy *= Math.pow(.035, dt);
  }
  player.x += player.vx * dt;
  player.y += player.vy * dt;
  player.x = clamp(player.x, STAGE.x + 23, STAGE.x + STAGE.w - 23);
  player.y = clamp(player.y, STAGE.y + 26, STAGE.y + STAGE.h - 25);
  resolveObstacle(player, dt);
  if (Math.hypot(player.vx, player.vy) > 15) player.dir = Math.atan2(player.vy, player.vx);
}

function resolveObstacle(player, dt) {
  for (const obstacle of obstacles) {
    const dx = player.x - obstacle.x;
    const dy = player.y - obstacle.y;
    const dist = Math.hypot(dx, dy) || .01;
    const min = obstacle.r + 17;
    if (dist < min) {
      const nx = dx / dist;
      const ny = dy / dist;
      player.x = obstacle.x + nx * min;
      player.y = obstacle.y + ny * min;
      const dot = player.vx * nx + player.vy * ny;
      if (dot < 0) { player.vx -= dot * nx * 1.5; player.vy -= dot * ny * 1.5; }
      if (!player.lastObstacleBump || now() - player.lastObstacleBump > 800) {
        player.lastObstacleBump = now();
        if (player.id === localId) {
          sound("bump");
          vibrate(7);
          burst(player.x, player.y, "#fff0bc", 4);
        }
      }
    }
  }
}

function updateRemotePlayers(dt) {
  for (const player of playerList()) {
    if (player.id === localId || (player.bot && isHost)) continue;
    const amount = Math.min(1, dt * 12);
    player.x += (player.remoteTargetX - player.x) * amount;
    player.y += (player.remoteTargetY - player.y) * amount;
  }
}

function chooseChickenTarget() {
  const carrier = chicken.holderId ? players.get(chicken.holderId) : null;
  if (carrier && !carrier.disconnected) {
    const pursuers = playerList().filter((p) => p.id !== carrier.id);
    if (pursuers.length) {
      pursuers.sort((a, b) => distance(a, carrier) - distance(b, carrier));
      const chaser = pursuers[0];
      const dx = carrier.x - chaser.x;
      const dy = carrier.y - chaser.y;
      const d = Math.hypot(dx, dy) || 1;
      chicken.targetX = carrier.x + dx / d * 14;
      chicken.targetY = carrier.y + dy / d * 14;
      return;
    }
  }
  if (simulationTime > chicken.nextWanderAt) {
    const point = Math.random() < .44 ? nests[Math.floor(Math.random() * nests.length)] : null;
    chicken.targetX = point ? point.x + random(-35, 35) : random(STAGE.x + 70, STAGE.x + STAGE.w - 70);
    chicken.targetY = point ? point.y + random(-25, 25) : random(STAGE.y + 70, STAGE.y + STAGE.h - 70);
    chicken.nextWanderAt = simulationTime + random(1.1, 2.7);
  }
}

function updateChicken(dt) {
  if (chicken.holderId) {
    const holder = players.get(chicken.holderId);
    if (!holder || holder.disconnected) {
      if (holder) dropChicken(holder, true);
      else chicken.holderId = null;
      return;
    }
    chicken.x = holder.x - Math.cos(holder.dir) * 13;
    chicken.y = holder.y - Math.sin(holder.dir) * 13 - 17;
    return;
  }
  if (isHost && chicken.nextFrenzyAt && Date.now() >= chicken.nextFrenzyAt) {
    chicken.frenzyUntil = Date.now() + 1700;
    chicken.nextFrenzyAt = Date.now() + random(11000, 15500);
    chicken.targetX = random(STAGE.x + 55, STAGE.x + STAGE.w - 55);
    chicken.targetY = random(STAGE.y + 55, STAGE.y + STAGE.h - 55);
    chicken.nextWanderAt = simulationTime + 1.5;
    chicken.vx += random(-145, 145);
    chicken.vy += random(-145, 145);
    sendEvent("CHICKEN_FRENZY", { until: chicken.frenzyUntil });
    sound("squawk");
    vibrate(9);
    showToast("雞暴走了！快追！");
    burst(chicken.x, chicken.y, "#fff7d4", 12);
  }
  chooseChickenTarget();
  let tx = chicken.targetX;
  let ty = chicken.targetY;
  const nearest = playerList().sort((a, b) => distance(a, chicken) - distance(b, chicken))[0];
  if (nearest && distance(nearest, chicken) < 100) {
    const dx = chicken.x - nearest.x;
    const dy = chicken.y - nearest.y;
    const d = Math.hypot(dx, dy) || 1;
    tx = chicken.x + dx / d * 105;
    ty = chicken.y + dy / d * 75;
    chicken.panicUntil = simulationTime + .8;
  }
  const dx = tx - chicken.x;
  const dy = ty - chicken.y;
  const d = Math.hypot(dx, dy) || 1;
  const speed = Date.now() < chicken.frenzyUntil ? 315 : (simulationTime < chicken.panicUntil ? 205 : 86);
  chicken.vx += (dx / d * speed - chicken.vx) * Math.min(1, dt * 2.8);
  chicken.vy += (dy / d * speed - chicken.vy) * Math.min(1, dt * 2.8);
  chicken.x = clamp(chicken.x + chicken.vx * dt, STAGE.x + 28, STAGE.x + STAGE.w - 28);
  chicken.y = clamp(chicken.y + chicken.vy * dt, STAGE.y + 38, STAGE.y + STAGE.h - 27);
  for (const obstacle of obstacles) {
    if (obstacle.kind !== "hay") continue;
    const ddx = chicken.x - obstacle.x;
    const ddy = chicken.y - obstacle.y;
    const dist = Math.hypot(ddx, ddy) || .01;
    const min = obstacle.r + 13;
    if (dist < min) {
      chicken.x = obstacle.x + ddx / dist * min;
      chicken.y = obstacle.y + ddy / dist * min;
      chicken.vx += ddx / dist * 90;
      chicken.vy += ddy / dist * 90;
    }
  }
}

function botInput(player) {
  const currentCarrier = chicken.holderId ? players.get(chicken.holderId) : null;
  let target = chicken;
  if (player.carrying) {
    target = nests.find((nest) => nest.id === player.id) || { x: 500, y: STAGE.y + STAGE.h * .5 };
  } else if (corn.active && !player.dashCharge) {
    target = corn;
  } else if (currentCarrier && currentCarrier.id !== player.id) {
    target = currentCarrier;
  } else if (!currentCarrier && distance(player, chicken) < 75) {
    const angle = Math.atan2(player.y - chicken.y, player.x - chicken.x);
    target = { x: chicken.x + Math.cos(angle) * 45, y: chicken.y + Math.sin(angle) * 35 };
  }
  let dx = target.x - player.x;
  let dy = target.y - player.y;
  for (const obstacle of obstacles) {
    const ox = player.x - obstacle.x;
    const oy = player.y - obstacle.y;
    const d = Math.hypot(ox, oy);
    if (d < obstacle.r + 52) {
      dx += ox / (d || 1) * 100;
      dy += oy / (d || 1) * 100;
    }
  }
  const d = Math.hypot(dx, dy) || 1;
  const shouldDash = d > 105 && now() > player.nextDashAt && (
    (player.carrying && d > 220) ||
    (!player.carrying && d < 180 && Math.random() < .012)
  );
  if (shouldDash) activateDash(player, false);
  return { x: dx / d, y: dy / d };
}

function dropChicken(player, forced = false) {
  if (chicken.holderId !== player.id) return;
  chicken.holderId = null;
  chicken.x = clamp(player.x + Math.cos(player.dir) * (forced ? 25 : 39), STAGE.x + 30, STAGE.x + STAGE.w - 30);
  chicken.y = clamp(player.y + Math.sin(player.dir) * (forced ? 25 : 39) - 4, STAGE.y + 30, STAGE.y + STAGE.h - 30);
  chicken.vx = Math.cos(player.dir) * 140;
  chicken.vy = Math.sin(player.dir) * 140 - 25;
  player.carrying = false;
  player.stunnedUntil = now() + 240;
  burst(chicken.x, chicken.y, "#fff4ba", 8);
  if (!forced && player.id === localId) {
    sound("steal");
    vibrate(23);
    showToast("雞被搶走了！");
  }
  if (isHost) sendChickenState();
}

function resolveBumpsAndChicken() {
  if (!isHost) return;
  const active = playerList();
  if (!chicken.holderId) {
    for (const player of active) {
      if (distance(player, chicken) < 29) {
        chicken.holderId = player.id;
        player.carrying = true;
        chicken.vx *= .15;
        chicken.vy *= .15;
        if (player.id === localId) {
          sound("pickup");
          vibrate(13);
          showToast("抓到雞了！帶回你的窩");
        } else if (!player.bot) showToast(`${player.name} 抓到雞了！`);
        burst(chicken.x, chicken.y, "#fff3b2", 12);
        sendChickenState();
        break;
      }
    }
    return;
  }
  const carrier = players.get(chicken.holderId);
  if (!carrier) return;
  for (const challenger of active) {
    if (challenger.id === carrier.id || now() < carrier.stunnedUntil || now() < challenger.stunnedUntil) continue;
    const impactRadius = now() < challenger.boostedDashUntil ? 52 : 34;
    if (distance(challenger, carrier) < impactRadius && (now() < challenger.dashUntil || Math.hypot(challenger.vx, challenger.vy) > 95)) {
      const previousHolder = carrier.id;
      chicken.holderId = challenger.id;
      carrier.carrying = false;
      challenger.carrying = true;
      carrier.stunnedUntil = now() + (now() < challenger.boostedDashUntil ? 520 : 360);
      challenger.stunnedUntil = now() + 120;
      const dx = carrier.x - challenger.x;
      const dy = carrier.y - challenger.y;
      const d = Math.hypot(dx, dy) || 1;
      carrier.vx += dx / d * 160;
      carrier.vy += dy / d * 160;
      screenShake = 5;
      burst(carrier.x, carrier.y - 8, challenger.color, now() < challenger.boostedDashUntil ? 25 : 15);
      if (challenger.id === localId || previousHolder === localId) {
        const poweredHit = now() < challenger.boostedDashUntil;
        sound(poweredHit ? "powerDash" : "steal");
        vibrate(poweredHit ? [25, 20, 42] : [16, 25, 20]);
        showToast(challenger.id === localId ? (poweredHit ? "超級撞擊！雞搶到手！" : "漂亮！把雞搶過來了") : "雞被搶走了！");
      } else if (!challenger.bot || !carrier.bot) showToast(`${challenger.name} 搶走雞！`);
      sendEvent("CHICKEN_STOLEN", { fromId: previousHolder, toId: challenger.id });
      sendChickenState();
      break;
    }
  }
}

function checkDelivery() {
  if (!isHost || !chicken.holderId) return;
  const player = players.get(chicken.holderId);
  if (!player) return;
  const nest = nests.find((item) => item.id === player.id);
  if (!nest || distance(player, nest) > 43) return;
  const timeLeft = Math.ceil((roundEndAt - Date.now()) / 1000);
  const bestOtherScore = Math.max(0, ...playerList().filter((other) => other.id !== player.id).map((other) => other.score));
  const comebackBonus = timeLeft <= 10 && player.score < bestOtherScore ? 1 : 0;
  const earned = 1 + comebackBonus;
  player.score += earned;
  chicken.holderId = null;
  player.carrying = false;
  chicken.x = 500 + random(-36, 36);
  chicken.y = STAGE.y + STAGE.h * .5 + random(-24, 24);
  chicken.vx = random(-45, 45);
  chicken.vy = random(-45, 45);
  chicken.nextWanderAt = simulationTime + .7;
  burst(nest.x, nest.y, player.color, 26);
  popText(`+${earned} 雞蛋!`, nest.x, nest.y - 25, "#fff6c3", 28);
  screenShake = 6;
  if (player.id === localId) {
    sound("score");
    vibrate([12, 30, 22]);
    showToast(comebackBonus ? "逆轉加成！ +2" : "雞回家囉！ +1");
  } else if (!player.bot) {
    sound("score");
    showToast(`${player.name} 送回雞舍！`);
  }
  updateStandings();
  sendEvent("PLAYER_SCORED", { userId: player.id, score: player.score, x: nest.x, y: nest.y, earned });
  sendChickenState();
  if (player.score >= TARGET_SCORE) finishRound(player.id);
}

function sendChickenState() {
  if (!isHost) return;
  sendEvent("CHICKEN_STATE", {
    x: Math.round(chicken.x),
    y: Math.round(chicken.y),
    holderId: chicken.holderId || null,
    frenzyUntil: chicken.frenzyUntil
  });
}

function sendCornState() {
  if (!isHost) return;
  sendEvent("CORN_STATE", {
    active: corn.active,
    x: Math.round(corn.x),
    y: Math.round(corn.y),
    expiresAt: corn.expiresAt
  });
}

function spawnCorn() {
  if (!isHost || corn.active) return;
  let point = { x: 500, y: STAGE.y + STAGE.h * .5 };
  for (let attempt = 0; attempt < 24; attempt++) {
    const candidate = {
      x: random(STAGE.x + 95, STAGE.x + STAGE.w - 95),
      y: random(STAGE.y + 72, STAGE.y + STAGE.h - 72)
    };
    const clear = obstacles.every((obstacle) => distance(candidate, obstacle) > obstacle.r + 55);
    if (clear) { point = candidate; break; }
  }
  corn.x = point.x;
  corn.y = point.y;
  corn.active = true;
  corn.expiresAt = Date.now() + 7600;
  sendCornState();
  sound("corn");
  showToast("金玉米出現！搶到可強化衝刺");
  burst(corn.x, corn.y, "#ffe46e", 17);
}

function updateCorn() {
  if (!isHost) return;
  if (corn.active && Date.now() >= corn.expiresAt) {
    corn.active = false;
    corn.nextSpawnAt = simulationTime + random(7, 10);
    sendCornState();
  }
  if (!corn.active && simulationTime >= corn.nextSpawnAt) spawnCorn();
  if (corn.active) {
    for (const player of playerList()) {
      if (player.dashCharge || distance(player, corn) > 30) continue;
      player.dashCharge = true;
      corn.active = false;
      corn.nextSpawnAt = simulationTime + random(6, 9);
      burst(corn.x, corn.y, "#ffe46e", 24);
      popText("衝刺充能！", player.x, player.y - 30, "#ffe77a", 23);
      if (player.id === localId) {
        sound("corn");
        vibrate([10, 18, 28]);
        showToast("金玉米到手！下一次衝刺更強");
      } else if (!player.bot) {
        showToast(`${player.name} 搶到金玉米！`);
      }
      sendEvent("PLAYER_POWERUP", { userId: player.id, dashCharge: true });
      sendCornState();
      break;
    }
  }
}

function syncPlayers(time) {
  const player = players.get(localId);
  if (player && time - lastOwnSend > 110) {
    lastOwnSend = time;
    sendEvent("PLAYER_STATE", {
      userId: localId,
      name: localName,
      x: Math.round(player.x),
      y: Math.round(player.y),
      dir: Math.round(player.dir * 100) / 100
    });
  }
  if (isHost && time - lastBotSend > 250) {
    lastBotSend = time;
    for (const bot of playerList()) {
      if (!bot.bot) continue;
      sendEvent("PLAYER_STATE", {
        userId: bot.id,
        name: bot.name,
        x: Math.round(bot.x),
        y: Math.round(bot.y),
        dir: Math.round(bot.dir * 100) / 100
      });
    }
  }
  if (isHost && time - lastChickenSend > 170) {
    lastChickenSend = time;
    sendChickenState();
  }
  if (isHost && corn.active && time - lastCornSend > 700) {
    lastCornSend = time;
    sendCornState();
  }
}

function updateStandings() {
  const ordered = playerList().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  standingsEl.replaceChildren();
  for (const player of ordered) {
    const chip = document.createElement("span");
    chip.className = `score-chip${player.id === localId ? " me" : ""}`;
    chip.title = player.name;
    const dot = document.createElement("i");
    dot.className = "dot";
    dot.style.backgroundColor = player.color;
    const score = document.createElement("b");
    score.className = "score";
    score.textContent = String(player.score);
    chip.append(dot, score);
    standingsEl.append(chip);
  }
}

function finishRound(winnerId = null, scores = null) {
  if (GAME_STATE === "RESULT" || GAME_STATE === "EXIT") return;
  if (isHost) {
    const ordered = playerList().sort((a, b) => b.score - a.score);
    if (!winnerId) winnerId = ordered[0]?.id || localId;
    matchWinnerId = winnerId;
    sendEvent("GAME_RESULT", {
      winnerId,
      scores: Object.fromEntries(ordered.map((p) => [p.id, p.score])),
      reason: stopReason || "time"
    });
  }
  applyResult(winnerId, scores);
}

function applyResult(winnerId, scores = null) {
  if (GAME_STATE === "RESULT" || GAME_STATE === "EXIT") return;
  GAME_STATE = "RESULT";
  resultAt = Date.now();
  matchWinnerId = winnerId;
  if (scores && typeof scores === "object") {
    for (const [id, score] of Object.entries(scores)) {
      const player = players.get(id);
      if (player && Number.isFinite(Number(score))) player.score = Number(score);
    }
  }
  updateStandings();
  const ordered = playerList().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const winner = players.get(winnerId) || ordered[0];
  const mine = players.get(localId);
  const localWon = !!winner && winner.id === localId;
  $("#resultKicker").textContent = localWon ? "你是本局雞王" : (winner ? `${winner.name} 獲得勝利` : "本局結束");
  $("#resultTitle").textContent = localWon ? "雞王誕生！" : (mine && winner ? `差 ${Math.max(0, winner.score - mine.score)} 分` : "再來一局？");
  podiumEl.replaceChildren();
  ordered.slice(0, 10).forEach((player, index) => {
    const row = document.createElement("div");
    row.className = `podium-row${player.id === localId ? " me" : ""}`;
    row.innerHTML = `<span class="rank">${["🥇", "🥈", "🥉"][index] || index + 1}</span><i class="dot"></i><span class="name"></span><b class="pts"></b>`;
    row.querySelector(".dot").style.backgroundColor = player.color;
    row.querySelector(".name").textContent = player.id === localId ? "你" : player.name;
    row.querySelector(".pts").textContent = `${player.score} 分`;
    podiumEl.append(row);
  });
  const topScore = ordered[0]?.score ?? 0;
  localScoreBeforeResult = mine?.score ?? 0;
  $("#resultNote").textContent = localWon
    ? "把雞送回雞舍，守住了全場！"
    : `你拿下 ${localScoreBeforeResult} 分，最高 ${topScore} 分`;
  resultEl.classList.add("show");
  sound(localWon ? "win" : "lose");
  vibrate(localWon ? [25, 35, 45] : 18);
  if (!gameOverCalled) {
    gameOverCalled = true;
    if (sdk && typeof sdk.gameOver === "function") {
      try { sdk.completeRound?.(mine?.score||0); } catch (_) {}
    } else {
      mockSDK.gameOver(localWon ? 1 : 0);
    }
  }
  $('#chickenReplay').disabled=!isHost;
  $('#chickenReplay').textContent=isHost?'再挑戰一次':'等待房主再開一局';
}

function resetRoundForReplay(){
  resultEl.classList.remove('show');GAME_STATE='LOADING';gameOverCalled=false;returning=false;stopReason='';matchWinnerId=null;
  keys.clear();joyVector={x:0,y:0};particles.length=0;floatingTexts.length=0;
  for(const p of playerList()){p.score=0;p.x=0;p.y=0;p.stunnedUntil=0;p.powerUntil=0;p.carrying=false;}
  chicken.holderId=null;chicken.x=500;chicken.y=STAGE.y+STAGE.h*.5;chicken.vx=0;chicken.vy=0;chicken.frenzyUntil=0;chicken.nextFrenzyAt=0;
  corn.active=false;corn.nextSpawnAt=0;arrangePlayers();updateStandings();
}
$('#chickenReplay').addEventListener('click',()=>{if(GAME_STATE==='RESULT'&&isHost){resetRoundForReplay();beginAutomaticRound();}});
$('#chickenExit').addEventListener('click',returnToRoom);

function returnToRoom() {
  if (returning) return;
  returning = true;
  GAME_STATE = "EXIT";
  if (musicTimer) window.clearInterval(musicTimer);
  if(sdk?.leaveGame){sdk.leaveGame();return;}
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ action: "leaveGame" }, "*");
  } else {
    resultEl.classList.add('show');
  }
}

function update(dt, time) {
  simulationTime += dt;
  if (GAME_STATE === "COUNTDOWN") {
    const left = roundStartAt - Date.now();
    const beat = left <= 0 ? "GO!" : String(Math.ceil(left / 1000));
    if (countdownEl.textContent !== beat) {
      countdownEl.textContent = beat;
      countdownEl.classList.remove("pulse");
      void countdownEl.offsetWidth;
      countdownEl.classList.add("pulse");
      sound(beat === "GO!" ? "go" : "count");
      vibrate(beat === "GO!" ? [16, 28, 42] : 8);
      if (beat === "GO!") {
        GAME_STATE = "PLAYING";
        if (isHost) {
          corn.nextSpawnAt = simulationTime + 4.5;
          chicken.nextFrenzyAt = Date.now() + 9000;
        }
        hintEl.textContent = "送雞回同色雞舍＋1，先到 5 分獲勝";
      }
    }
  }

  if (GAME_STATE === "PLAYING") {
    const local = players.get(localId);
    if (local) updateLocalPlayer(local, dt);
    updateRemotePlayers(dt);
    if (isHost) {
      for (const bot of playerList()) {
        if (!bot.bot) continue;
        const input = botInput(bot);
        if (input.x || input.y) bot.dir = Math.atan2(input.y, input.x);
        movePlayer(bot, input.x, input.y, dt, true);
      }
      updateChicken(dt);
      updateCorn();
      resolveBumpsAndChicken();
      checkDelivery();
      if (Date.now() >= roundEndAt && GAME_STATE === "PLAYING") finishRound();
    } else if (chicken.holderId) {
      const holder = players.get(chicken.holderId);
      if (holder) {
        chicken.x += (holder.x - chicken.x) * Math.min(1, dt * 14);
        chicken.y += (holder.y - 18 - chicken.y) * Math.min(1, dt * 14);
      }
    }
    syncPlayers(time);
    const remaining = Math.max(0, Math.ceil((roundEndAt - Date.now()) / 1000));
    clockEl.textContent = String(remaining);
    clockEl.classList.toggle("urgent", remaining <= 10);
    const localPlayer = players.get(localId);
    dashEl.classList.toggle("charged", !!localPlayer?.dashCharge);
    const cooldownDuration = localPlayer?.dashCooldownMs || 1450;
    const cooldownLeft = Math.max(0, (localPlayer?.nextDashAt || 0) - now());
    const dashReady = clamp(1 - cooldownLeft / cooldownDuration, 0, 1);
    dashEl.style.setProperty("--dash-ready", `${Math.max(0, Math.round((dashEl.clientWidth - 24) * dashReady))}px`);
    dashEl.classList.toggle("recharging", cooldownLeft > 0);
    const dashLabel = dashEl.querySelector("small");
    if (dashLabel) {
      dashLabel.textContent = localPlayer?.dashCharge
        ? (cooldownLeft > 0 ? `⚡${(cooldownLeft / 1000).toFixed(1)}` : "強化!")
        : (cooldownLeft > 0 ? `${(cooldownLeft / 1000).toFixed(1)}s` : "衝刺");
    }
    if (remaining <= 10 && lastHintAt !== remaining) {
      lastHintAt = remaining;
      if (remaining === 10) {
        hintEl.textContent = "最後十秒：落後的人送雞得 2 分！";
        showToast("最後十秒！逆轉加成啟動");
      }
      if (remaining <= 3 && remaining > 0) {
        sound("count");
        vibrate(remaining === 1 ? [18, 24, 38] : 9);
        clockEl.classList.remove("final-beat");
        void clockEl.offsetWidth;
        clockEl.classList.add("final-beat");
      }
    }
  }
  updateEffects(dt);
}

function drawGrass() {
  ctx.fillStyle = "#a9dc79";
  ctx.fillRect(0, 0, W, H);
  const centerY = STAGE.y + STAGE.h * .5;
  const gradient = ctx.createRadialGradient(500, centerY, 90, 500, centerY, Math.max(610, H * .68));
  gradient.addColorStop(0, "#b8e586");
  gradient.addColorStop(1, "#92cf6d");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.beginPath();
  roundedRectPath(STAGE.x, STAGE.y, STAGE.w, STAGE.h, 60);
  ctx.clip();
  ctx.fillStyle = "rgba(241,246,184,.17)";
  for (let row = 0; row < 8; row++) {
    const rowHeight = STAGE.h / 8;
    ctx.fillRect(STAGE.x, STAGE.y + row * rowHeight, STAGE.w, rowHeight * .36);
  }
  for (let i = 0; i < 98; i++) {
    const x = (i * 197 + 43) % W;
    const y = STAGE.y + ((i * 131 + 89) % Math.max(1, Math.floor(STAGE.h)));
    const s = 2 + (i % 4);
    ctx.fillStyle = i % 4 === 0 ? "rgba(255,247,190,.62)" : "rgba(58,126,67,.22)";
    ctx.beginPath();
    ctx.ellipse(x, y, s * .48, s * 1.4, -.45, 0, Math.PI * 2);
    ctx.fill();
    if (i % 5 === 0) {
      ctx.fillStyle = i % 2 ? "#fff2c4" : "#ffd7a4";
      ctx.beginPath();
      ctx.arc(x + 2, y - 1, 2.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  ctx.strokeStyle = "#82bd64";
  ctx.lineWidth = 8;
  roundedRectPath(STAGE.x + 2, STAGE.y + 2, STAGE.w - 4, STAGE.h - 4, 56);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,250,215,.55)";
  ctx.lineWidth = 2;
  roundedRectPath(STAGE.x + 12, STAGE.y + 12, STAGE.w - 24, STAGE.h - 24, 49);
  ctx.stroke();

  drawObstacleDecor();
  drawNests();
}

function roundedRectPath(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawObstacleDecor() {
  for (const obstacle of obstacles) {
    if (obstacle.kind === "pond") {
      ctx.save();
      ctx.fillStyle = "rgba(70,143,157,.22)";
      ctx.beginPath();
      ctx.ellipse(obstacle.x, obstacle.y + 9, 54, 37, -.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#78c8c1";
      ctx.beginPath();
      ctx.ellipse(obstacle.x, obstacle.y, 51, 34, -.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(229,255,219,.64)";
      ctx.beginPath();
      ctx.ellipse(obstacle.x - 13, obstacle.y - 9, 15, 4, -.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      continue;
    }
    ctx.save();
    ctx.fillStyle = "rgba(70,99,45,.18)";
    ctx.beginPath();
    ctx.ellipse(obstacle.x, obstacle.y + 17, 36, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#d7a45d";
    roundedRectPath(obstacle.x - 28, obstacle.y - 19, 56, 37, 12);
    ctx.fill();
    ctx.strokeStyle = "#f1ca79";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(obstacle.x - 13, obstacle.y - 15);
    ctx.lineTo(obstacle.x + 2, obstacle.y + 14);
    ctx.moveTo(obstacle.x + 6, obstacle.y - 16);
    ctx.lineTo(obstacle.x + 18, obstacle.y + 12);
    ctx.stroke();
    ctx.restore();
  }
}

function drawNests() {
  for (const nest of nests) {
    const player = players.get(nest.id);
    if (!player) continue;
    ctx.save();
    ctx.translate(nest.x, nest.y);
    ctx.fillStyle = "rgba(54,88,47,.15)";
    ctx.beginPath();
    ctx.ellipse(0, 8, 36, 23, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#b78049";
    ctx.beginPath();
    ctx.ellipse(0, 0, 32, 21, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#e6bb77";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(0, -2, 24, 13, 0, .08, Math.PI - .08);
    ctx.stroke();
    ctx.fillStyle = "#fff5d0";
    ctx.beginPath();
    ctx.ellipse(0, -4, 8, 11, -.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = nest.color;
    ctx.beginPath();
    ctx.arc(0, -37, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff9e8";
    ctx.lineWidth = player.id === localId ? 3 : 2;
    ctx.stroke();
    ctx.fillStyle = "#fff9e8";
    ctx.font = "900 12px Nunito, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(player.id === localId ? "你" : player.name.slice(0, 5), 0, -34);
    ctx.restore();
  }
}

function drawChicken(time) {
  const bob = Math.sin(time * .009) * 3;
  const fleeing = simulationTime < chicken.panicUntil && !chicken.holderId;
  const frenzy = Date.now() < chicken.frenzyUntil;
  const angle = chicken.holderId
    ? (players.get(chicken.holderId)?.dir ?? 0)
    : Math.atan2(chicken.vy, chicken.vx);
  ctx.save();
  ctx.translate(chicken.x, chicken.y + bob);
  ctx.rotate(angle * .14);
  ctx.fillStyle = "rgba(66,92,43,.19)";
  ctx.beginPath();
  ctx.ellipse(0, 17, 18, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f5e4b5";
  ctx.beginPath();
  ctx.ellipse(-3, 0, 17, 12, -.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e7d3a0";
  ctx.beginPath();
  ctx.ellipse(-7, 1 + Math.sin(time * .017) * 2, 8, 5, -.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f7edcf";
  ctx.beginPath();
  ctx.arc(8, -8, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#dd6251";
  ctx.beginPath();
  ctx.moveTo(4, -16);
  ctx.quadraticCurveTo(7, -27, 11, -17);
  ctx.quadraticCurveTo(15, -26, 17, -15);
  ctx.quadraticCurveTo(22, -23, 22, -12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ed8d45";
  ctx.beginPath();
  ctx.moveTo(16, -7);
  ctx.lineTo(27, -4);
  ctx.lineTo(16, -1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#364536";
  ctx.beginPath();
  ctx.arc(11, -10, 1.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#d79d52";
  ctx.lineWidth = 2.1;
  ctx.beginPath();
  ctx.moveTo(-4, 10);
  ctx.lineTo(-5, 16);
  ctx.moveTo(5, 10);
  ctx.lineTo(6, 16);
  ctx.stroke();
  if (fleeing || frenzy) {
    ctx.fillStyle = frenzy ? "#fff0a0" : "#fff9d9";
    ctx.font = "1000 15px Nunito";
    ctx.textAlign = "center";
    ctx.fillText(frenzy ? "!!" : "!", 0, -28);
  }
  if (!chicken.holderId && GAME_STATE === "PLAYING") {
    ctx.strokeStyle = "rgba(255,249,219,.65)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 24 + Math.sin(time / 110) * 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCorn(time) {
  if (!corn.active) return;
  const pulse = Math.sin(time * .008) * 4;
  const seconds = clamp((corn.expiresAt - Date.now()) / 7600, 0, 1);
  ctx.save();
  ctx.translate(corn.x, corn.y);
  ctx.fillStyle = "rgba(120,91,33,.18)";
  ctx.beginPath();
  ctx.ellipse(0, 12, 24, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,244,154,.56)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 30 + pulse, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * seconds);
  ctx.stroke();
  ctx.fillStyle = "#fff0a0";
  ctx.beginPath();
  ctx.ellipse(0, 0, 20 + pulse * .25, 16 + pulse * .25, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f5c53f";
  ctx.beginPath();
  ctx.ellipse(0, 0, 8, 19, -.55, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i % 2 ? "#ffe47c" : "#f2b932";
    ctx.beginPath();
    ctx.arc(-3 + i * 2, -12 + i * 5, 2.25, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#70b957";
  ctx.beginPath();
  ctx.ellipse(-11, 7, 11, 5, -.7, 0, Math.PI * 2);
  ctx.ellipse(10, 7, 10, 4.5, .65, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = .9;
  ctx.fillStyle = "#fff9d8";
  ctx.font = "1000 13px Nunito, 'Noto Sans TC', sans-serif";
  ctx.textAlign = "center";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(88,91,50,.33)";
  ctx.strokeText("強化衝刺", 0, -34);
  ctx.fillText("強化衝刺", 0, -34);
  ctx.restore();
}

function drawPlayer(player, time) {
  const walking = Math.hypot(player.vx, player.vy) > 18;
  const step = walking ? Math.sin(time * .018 + player.pulse) * 3.5 : 0;
  const stunned = now() < player.stunnedUntil;
  const blink = stunned && Math.floor(time / 65) % 2 === 0;
  if (blink) return;
  ctx.save();
  ctx.translate(player.x, player.y);
  const carrying = player.id === chicken.holderId;
  const speed = Math.hypot(player.vx, player.vy);
  const lean = clamp(speed / 800, 0, .17);
  ctx.rotate(Math.sin(player.dir) * -lean);
  ctx.fillStyle = "rgba(54,83,43,.2)";
  ctx.beginPath();
  ctx.ellipse(0, 15, 17, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#fff8de";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-7, 9);
  ctx.lineTo(-9 - step, 17);
  ctx.moveTo(7, 9);
  ctx.lineTo(9 + step, 17);
  ctx.stroke();
  ctx.strokeStyle = player.color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-12, -1);
  ctx.lineTo(-19, 3 + step * .35);
  ctx.moveTo(12, -1);
  ctx.lineTo(19, 3 - step * .35);
  ctx.stroke();
  ctx.fillStyle = player.color;
  ctx.beginPath();
  ctx.ellipse(0, 3 + (walking ? Math.abs(step) * -.25 : 0), 15, 17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#fff9e8";
  ctx.lineWidth = player.id === localId ? 3 : 1.5;
  ctx.stroke();
  if (player.dashCharge) {
    ctx.strokeStyle = `rgba(255,224,100,${.62 + Math.sin(time * .012) * .2})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 1, 23 + Math.sin(time * .012) * 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#fff0a0";
    ctx.font = "1000 12px Nunito";
    ctx.textAlign = "center";
    ctx.fillText("⚡", 0, -29);
  }
  ctx.fillStyle = "#fff6de";
  ctx.beginPath();
  ctx.ellipse(0, -9, 13, 11, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#344336";
  ctx.beginPath();
  ctx.arc(-4, -9, 1.6, 0, Math.PI * 2);
  ctx.arc(4, -9, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e99251";
  ctx.beginPath();
  ctx.ellipse(0, -4, 3.5, 2.3, 0, 0, Math.PI * 2);
  ctx.fill();

  if (carrying) {
    ctx.save();
    ctx.translate(0, -27);
    ctx.fillStyle = "#f5e4b5";
    ctx.beginPath();
    ctx.ellipse(-1, 0, 10, 8, -.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f7edcf";
    ctx.beginPath();
    ctx.arc(6, -6, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#dd6251";
    ctx.beginPath();
    ctx.arc(6, -12, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ef9947";
    ctx.beginPath();
    ctx.moveTo(10, -6);
    ctx.lineTo(16, -4);
    ctx.lineTo(10, -2);
    ctx.fill();
    ctx.restore();
  }
  if (now() < player.dashUntil) {
    ctx.globalAlpha = .42;
    ctx.strokeStyle = now() < player.boostedDashUntil ? "#fff0a0" : player.color;
    ctx.lineWidth = now() < player.boostedDashUntil ? 5 : 3;
    ctx.lineCap = "round";
    for (let trail = 0; trail < (now() < player.boostedDashUntil ? 3 : 2); trail++) {
      const back = 19 + trail * 9;
      ctx.beginPath();
      ctx.moveTo(-Math.cos(player.dir) * back, -Math.sin(player.dir) * back + 2);
      ctx.lineTo(-Math.cos(player.dir) * (back + 11), -Math.sin(player.dir) * (back + 11) + 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawEffects() {
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    if (p.shape === "star") {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const radius = i % 2 ? p.size * .42 : p.size;
        const angle = -Math.PI / 2 + i * Math.PI / 5;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  for (const item of floatingTexts) {
    ctx.save();
    ctx.globalAlpha = clamp(item.life / item.maxLife, 0, 1);
    ctx.font = `1000 ${item.size}px Nunito, "Noto Sans TC", sans-serif`;
    ctx.textAlign = "center";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(86,93,55,.38)";
    ctx.strokeText(item.text, item.x, item.y);
    ctx.fillStyle = item.color;
    ctx.fillText(item.text, item.x, item.y);
    ctx.restore();
  }
}

function render(time) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#a9dc79";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(layout.scale, 0, 0, layout.scale, layout.ox, layout.oy);
  ctx.save();
  if (screenShake > 0) ctx.translate(random(-screenShake, screenShake), random(-screenShake, screenShake));
  drawGrass();
  drawCorn(time);
  const ordered = playerList().sort((a, b) => a.y - b.y);
  for (const player of ordered) {
    if (player.id === chicken.holderId) continue;
    drawPlayer(player, time);
  }
  drawChicken(time);
  const carrier = players.get(chicken.holderId);
  if (carrier) drawPlayer(carrier, time);
  drawEffects();
  ctx.restore();
}

function frame(time) {
  const dt = Math.min(.04, Math.max(0, (time - lastFrameAt) / 1000));
  lastFrameAt = time;
  update(dt, time);
  render(time);
  if (time - lastHudUpdate > 500) {
    lastHudUpdate = time;
    if (GAME_STATE === "COUNTDOWN") clockEl.textContent = String(Math.ceil(DURATION));
  }
  requestAnimationFrame(frame);
}

function setJoystickFromPointer(event) {
  const rect = joyEl.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = event.clientX - centerX;
  const dy = event.clientY - centerY;
  const radius = rect.width * .33;
  const length = Math.hypot(dx, dy);
  const amount = Math.min(1, length / radius);
  const nx = length ? dx / length : 0;
  const ny = length ? dy / length : 0;
  joyVector = { x: nx * amount, y: ny * amount };
  joyKnob.style.transform = `translate(${nx * amount * radius}px, ${ny * amount * radius}px)`;
}

joyEl.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  touchMode = true;
  wakeAudio();
  joystickPointer = event.pointerId;
  joyEl.setPointerCapture(event.pointerId);
  setJoystickFromPointer(event);
});
joyEl.addEventListener("pointermove", (event) => {
  if (event.pointerId === joystickPointer) setJoystickFromPointer(event);
});
function releaseJoystick(event) {
  if (event.pointerId !== joystickPointer) return;
  joystickPointer = null;
  joyVector = { x: 0, y: 0 };
  joyKnob.style.transform = "translate(0,0)";
}
joyEl.addEventListener("pointerup", releaseJoystick);
joyEl.addEventListener("pointercancel", releaseJoystick);
dashEl.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  touchMode = true;
  wakeAudio();
  dashHeld = true;
  dashEl.classList.add("pressed");
  try { dashEl.setPointerCapture(event.pointerId); } catch (_) {}
  const player = players.get(localId);
  if (player) activateDash(player, true);
});
function releaseDash() {
  dashHeld = false;
  dashEl.classList.remove("pressed");
}
dashEl.addEventListener("pointerup", releaseDash);
dashEl.addEventListener("pointercancel", releaseDash);
dashEl.addEventListener("lostpointercapture", releaseDash);

canvas.addEventListener("pointerdown", (event) => {
  wakeAudio();
  if (event.pointerType !== "mouse") touchMode = true;
});
window.addEventListener("keydown", (event) => {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "Shift"].includes(event.key)) event.preventDefault();
  keys.add(event.key);
  wakeAudio();
  if ((event.key === " " || event.key === "Shift") && !event.repeat) {
    const player = players.get(localId);
    if (player) activateDash(player, true);
  }
});
window.addEventListener("keyup", (event) => keys.delete(event.key));
window.addEventListener("blur", () => {
  keys.clear();
  joyVector = { x: 0, y: 0 };
  dashHeld = false;
  joyKnob.style.transform = "translate(0,0)";
  dashEl.classList.remove("pressed");
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && audioContext?.state === "suspended" && audioStarted) audioContext.resume().catch(() => {});
});

requestAnimationFrame(frame);
