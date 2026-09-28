const GRID_SIZE = 22;
const ROUND_SECONDS = 45;
const SNAKE_COLORS = ['#35e6ff', '#ff3a9d', '#ffd65a', '#4ee08a', '#a992ff', '#ff8d53', '#f477e2', '#b9e66c', '#73a3ff', '#ffadca'];

let sdk = window.BoomRoomSDK || null;

const ui = {
  canvas: document.getElementById('snakeCanvas'),
  playerCounter: document.getElementById('playerCounter'),
  timerBox: document.getElementById('timerBox'),
  scoreBox: document.getElementById('scoreBox'),
  autoStartNotice: document.getElementById('autoStartNotice'),
  rosterList: document.getElementById('rosterList'),
  resultOverlay: document.getElementById('resultOverlay'),
  resultTitle: document.getElementById('resultTitle'),
  resultSubtitle: document.getElementById('resultSubtitle'),
  resultReward: document.getElementById('resultReward'),
  btnUp: document.getElementById('btnUp'),
  btnLeft: document.getElementById('btnLeft'),
  btnRight: document.getElementById('btnRight'),
  btnDown: document.getElementById('btnDown'),
};

const ctx = ui.canvas.getContext('2d');

let me = { id: `local-${Math.random().toString(36).slice(2, 8)}`, username: '你', avatar: '' };
let isHost = sdk ? !!sdk.isHost : true;
let roomId = sdk ? (sdk.roomId || '') : '';
let roomPlayersMap = new Map();
let readyPlayersSet = new Set();
let totalRoomPlayersCount = 1;
let autoStarted = false;
let autoStartTimer = null;

// Game State
let snakes = new Map(); // id -> { id, username, body: [{x,y}], dir: 'RIGHT', nextDir: 'RIGHT', score: 0, color: '', alive: true, isBot: false }
let foodItems = []; // [{ x, y, type: 'apple'|'gold'|'bomb' }]
let isPlaying = false;
let gameOverCalled = false;
let remainingSeconds = ROUND_SECONDS;
let gameLoopInterval = null;
let aiDifficulty = 'normal'; // 'easy' | 'normal' | 'master'
let audioCtx = null;

/* =========================================================
   AUDIO & SFX
========================================================= */

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playEatSound() {
  try {
    ensureAudio();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.08);
  } catch (_) {}
}

function playBombSound() {
  try {
    ensureAudio();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.15);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  } catch (_) {}
}

function playWinSound() {
  try {
    ensureAudio();
    const now = audioCtx.currentTime;
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.1);
      gain.gain.setValueAtTime(0.2, now + i * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.25);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.25);
    });
  } catch (_) {}
}

/* =========================================================
   SDK INIT & MULTIPLAYER
========================================================= */

function setupSDK(data) {
  if (data && data.user) {
    me.id = String(data.user.id || me.id);
    me.username = String(data.user.username || '你').slice(0, 16);
    me.avatar = String(data.user.avatar || '');
  }
  isHost = !!(data && data.isHost);
  roomId = data && data.roomId ? String(data.roomId) : '';

  roomPlayersMap.clear();
  roomPlayersMap.set(me.id, me);

  if (data && Array.isArray(data.roomPlayers)) {
    totalRoomPlayersCount = Math.max(1, data.roomPlayers.length);
    data.roomPlayers.slice(0, 10).forEach((rp, i) => {
      if (rp && rp.id != null) {
        const id = String(rp.id);
        roomPlayersMap.set(id, {
          id,
          username: String(rp.username || `玩家${i + 1}`).slice(0, 16),
          avatar: String(rp.avatar || '')
        });
      }
    });
  }

  readyPlayersSet.add(me.id);
  updateRosterUI();
  updateAutoStartNotice();
  scheduleAutoStartFallback();
  bindGameEvents();
}

function updateRosterUI() {
  ui.playerCounter.textContent = `👥 ${roomPlayersMap.size}/10 人`;
  ui.rosterList.innerHTML = '';
  [...roomPlayersMap.values()].forEach((p, idx) => {
    const chip = document.createElement('div');
    chip.className = `roster-chip${p.id === me.id ? ' active' : ''}`;
    chip.textContent = `${p.username}`;
    ui.rosterList.appendChild(chip);
  });
}

function updateAutoStartNotice() {
  if (!ui.autoStartNotice) return;
  const count = readyPlayersSet.size;
  ui.autoStartNotice.textContent = `⏱️ 房間人數 ${count}/${totalRoomPlayersCount}，準備自動開始...`;

  if (count >= totalRoomPlayersCount && !autoStarted && !isPlaying) {
    triggerAutoStart();
  }
}

function triggerAutoStart() {
  if (autoStarted) return;
  autoStarted = true;
  clearTimeout(autoStartTimer);
  ui.autoStartNotice.textContent = '🚀 人數已齊全，自動開局！';
  setTimeout(() => {
    startSnakeRound();
  }, 600);
}

function scheduleAutoStartFallback() {
  clearTimeout(autoStartTimer);
  autoStartTimer = setTimeout(() => {
    if (!autoStarted && !isPlaying) {
      triggerAutoStart();
    }
  }, 3500);
}

function startSnakeRound() {
  snakes.clear();
  foodItems = [];
  isPlaying = true;
  gameOverCalled = false;
  remainingSeconds = ROUND_SECONDS;

  // Initialize Snakes for room players
  const pList = [...roomPlayersMap.values()];
  pList.forEach((p, idx) => {
    const startX = 4 + (idx % 4) * 5;
    const startY = 4 + Math.floor(idx / 4) * 5;
    snakes.set(p.id, {
      id: p.id,
      username: p.username,
      body: [{ x: startX, y: startY }, { x: startX - 1, y: startY }, { x: startX - 2, y: startY }],
      dir: 'RIGHT',
      nextDir: 'RIGHT',
      score: 0,
      color: SNAKE_COLORS[idx % SNAKE_COLORS.length],
      alive: true,
      isBot: false
    });
  });

  // Solo mode: add 2 AI snakes if playing alone!
  if (pList.length === 1) {
    for (let i = 1; i <= 2; i++) {
      const botId = `bot-${i}`;
      const startX = 16;
      const startY = 6 * i;
      snakes.set(botId, {
        id: botId,
        username: `🤖 蛇蛇 AI-${i}`,
        body: [{ x: startX, y: startY }, { x: startX + 1, y: startY }],
        dir: 'LEFT',
        nextDir: 'LEFT',
        score: 0,
        color: SNAKE_COLORS[(pList.length + i) % SNAKE_COLORS.length],
        alive: true,
        isBot: true
      });
    }
  }

  // Spawn initial foods
  spawnFoods();

  ui.autoStartNotice.textContent = '🎮 貪吃蛇大亂鬥 · 按 D-Pad 鍵控制方向';

  clearInterval(gameLoopInterval);
  gameLoopInterval = setInterval(gameStep, 150);
  drawBoard();
}

function spawnFoods() {
  foodItems = [];
  const types = ['apple', 'apple', 'gold', 'bomb'];
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(Math.random() * (GRID_SIZE - 2)) + 1;
    const y = Math.floor(Math.random() * (GRID_SIZE - 2)) + 1;
    const type = types[Math.floor(Math.random() * types.length)];
    foodItems.push({ x, y, type });
  }
}

/* =========================================================
   GAME STEP & MOVEMENT
========================================================= */

function gameStep() {
  if (!isPlaying) return;

  remainingSeconds -= 0.15;
  if (remainingSeconds <= 0) {
    remainingSeconds = 0;
    finishSnakeRound();
    return;
  }

  ui.timerBox.textContent = `⏱️ 剩餘時間: ${Math.ceil(remainingSeconds)}s`;

  // 1. Move all snakes
  snakes.forEach(snake => {
    if (!snake.alive) return;

    if (snake.isBot) {
      updateBotDir(snake);
    }

    snake.dir = snake.nextDir;
    const head = { ...snake.body[0] };

    if (snake.dir === 'UP') head.y -= 1;
    if (snake.dir === 'DOWN') head.y += 1;
    if (snake.dir === 'LEFT') head.x -= 1;
    if (snake.dir === 'RIGHT') head.x += 1;

    // Boundary Wrap / Collisions
    if (head.x < 0) head.x = GRID_SIZE - 1;
    if (head.x >= GRID_SIZE) head.x = 0;
    if (head.y < 0) head.y = GRID_SIZE - 1;
    if (head.y >= GRID_SIZE) head.y = 0;

    snake.body.unshift(head);

    // Check Food Collision
    let ate = false;
    for (let i = foodItems.length - 1; i >= 0; i--) {
      const f = foodItems[i];
      if (f.x === head.x && f.y === head.y) {
        ate = true;
        if (f.type === 'apple') {
          snake.score += 10;
          if (snake.id === me.id) playEatSound();
        } else if (f.type === 'gold') {
          snake.score += 30;
          if (snake.id === me.id) playEatSound();
        } else if (f.type === 'bomb') {
          snake.score = Math.max(0, snake.score - 50);
          snake.body.pop(); // Shrink!
          if (snake.id === me.id) playBombSound();
        }
        foodItems.splice(i, 1);
        break;
      }
    }

    if (!ate) {
      snake.body.pop();
    }

    if (snake.id === me.id) {
      ui.scoreBox.textContent = `🍏 得分: ${snake.score}`;
    }
  });

  // Maintain Food Count
  if (foodItems.length < 5) {
    const types = ['apple', 'apple', 'gold', 'bomb'];
    foodItems.push({
      x: Math.floor(Math.random() * (GRID_SIZE - 2)) + 1,
      y: Math.floor(Math.random() * (GRID_SIZE - 2)) + 1,
      type: types[Math.floor(Math.random() * types.length)]
    });
  }

  drawBoard();
}

function updateBotDir(snake) {
  const head = snake.body[0];
  const target = foodItems.find(f => f.type !== 'bomb') || foodItems[0];
  if (!target) return;

  const validDirs = [];
  if (snake.dir !== 'DOWN' && head.y > target.y) validDirs.push('UP');
  if (snake.dir !== 'UP' && head.y < target.y) validDirs.push('DOWN');
  if (snake.dir !== 'RIGHT' && head.x > target.x) validDirs.push('LEFT');
  if (snake.dir !== 'LEFT' && head.x < target.x) validDirs.push('RIGHT');

  if (validDirs.length > 0) {
    if (aiDifficulty === 'easy' && Math.random() < 0.35) {
      // Easy AI: random mistake
      const allDirs = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
      snake.nextDir = allDirs[Math.floor(Math.random() * allDirs.length)];
    } else {
      snake.nextDir = validDirs[Math.floor(Math.random() * validDirs.length)];
    }
  }
}

/* =========================================================
   CANVAS DRAWING
========================================================= */

function drawBoard() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = ui.canvas.getBoundingClientRect();
  ui.canvas.width = rect.width * dpr;
  ui.canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = rect.width;
  const h = rect.height;
  const cellSize = w / GRID_SIZE;

  ctx.clearRect(0, 0, w, h);

  // 1. Draw Grid Lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= GRID_SIZE; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cellSize, 0);
    ctx.lineTo(i * cellSize, h);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, i * cellSize);
    ctx.lineTo(w, i * cellSize);
    ctx.stroke();
  }

  // 2. Draw Food Items
  foodItems.forEach(f => {
    const x = f.x * cellSize + cellSize / 2;
    const y = f.y * cellSize + cellSize / 2;
    ctx.font = `${cellSize * 0.8}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (f.type === 'apple') ctx.fillText('🍏', x, y);
    else if (f.type === 'gold') ctx.fillText('🪙', x, y);
    else if (f.type === 'bomb') ctx.fillText('💣', x, y);
  });

  // 3. Draw Snakes
  snakes.forEach(s => {
    if (!s.alive) return;
    s.body.forEach((seg, idx) => {
      ctx.fillStyle = idx === 0 ? '#ffffff' : s.color;
      ctx.beginPath();
      const radius = idx === 0 ? cellSize * 0.45 : cellSize * 0.38;
      ctx.arc(seg.x * cellSize + cellSize / 2, seg.y * cellSize + cellSize / 2, radius, 0, Math.PI * 2);
      ctx.fill();
    });
  });
}

/* =========================================================
   CONTROLS & INPUT
========================================================= */

function changeDirection(newDir) {
  ensureAudio();
  const mySnake = snakes.get(me.id);
  if (!mySnake || !mySnake.alive) return;

  const opposites = { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT' };
  if (mySnake.dir !== opposites[newDir]) {
    mySnake.nextDir = newDir;
    sendGameEvent('SNAKE_MOVE', { userId: me.id, dir: newDir });
  }
}

window.addEventListener('keydown', e => {
  if (['ArrowUp', 'w', 'W'].includes(e.key)) changeDirection('UP');
  if (['ArrowDown', 's', 'S'].includes(e.key)) changeDirection('DOWN');
  if (['ArrowLeft', 'a', 'A'].includes(e.key)) changeDirection('LEFT');
  if (['ArrowRight', 'd', 'D'].includes(e.key)) changeDirection('RIGHT');
});

ui.btnUp.addEventListener('click', () => changeDirection('UP'));
ui.btnDown.addEventListener('click', () => changeDirection('DOWN'));
ui.btnLeft.addEventListener('click', () => changeDirection('LEFT'));
ui.btnRight.addEventListener('click', () => changeDirection('RIGHT'));

/* =========================================================
   RESULT & SETTLEMENT
========================================================= */

function finishSnakeRound() {
  isPlaying = false;
  clearInterval(gameLoopInterval);
  playWinSound();

  const sorted = [...snakes.values()].sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  const isWinner = winner?.id === me.id;

  ui.resultTitle.textContent = isWinner ? '🏆 貪吃蛇霸主！' : `🏆 ${winner?.username || '對手'} 獲勝！`;
  ui.resultSubtitle.textContent = `最高得分：${winner?.score || 0} 分`;
  ui.resultReward.textContent = isWinner ? '+100 銀幣' : '+0 銀幣';

  ui.resultOverlay.classList.remove('hidden');

  if (!gameOverCalled) {
    gameOverCalled = true;
    if (window.BoomRoomSDK && typeof window.BoomRoomSDK.gameOver === 'function') {
      try {
        window.BoomRoomSDK.gameOver(isWinner ? 100 : 0);
      } catch (_) {}
    }
  }

  setTimeout(() => {
    returnToRoom();
  }, 3000);
}

function returnToRoom() {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ action: 'leaveGame' }, '*');
  } else {
    try { window.close(); } catch (_) {}
  }
}

/* =========================================================
   NETWORK & SDK LISTENERS
========================================================= */

function sendGameEvent(eventName, payload) {
  if (window.BoomRoomSDK && typeof window.BoomRoomSDK.sendGameEvent === 'function') {
    window.BoomRoomSDK.sendGameEvent(eventName, payload);
  }
}

function bindGameEvents() {
  window.addEventListener('message', e => {
    const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    if (!data) return;
    if (data.action === 'initSDK') {
      setupSDK(data);
    } else if (data.action === 'gameEventReceived') {
      handleNetworkEvent(data.eventName, data.payload, data.userId);
    }
  });

  window.addEventListener('gameEventReceived', e => {
    const detail = e.detail || {};
    handleNetworkEvent(detail.eventName, detail.payload, detail.senderId);
  });
}

function handleNetworkEvent(eventName, payload, senderId) {
  if (eventName === 'SNAKE_MOVE' && payload) {
    const { userId, dir } = payload;
    const targetSnake = snakes.get(userId);
    if (targetSnake && userId !== me.id) {
      targetSnake.nextDir = dir;
    }
  }
}

/* =========================================================
   INIT & EVENT BINDINGS
========================================================= */

function setAiDifficulty(diff) {
  aiDifficulty = diff;
  document.getElementById('diffEasy')?.classList.toggle('active', diff === 'easy');
  document.getElementById('diffNormal')?.classList.toggle('active', diff === 'normal');
  document.getElementById('diffMaster')?.classList.toggle('active', diff === 'master');
}

document.getElementById('diffEasy')?.addEventListener('click', () => setAiDifficulty('easy'));
document.getElementById('diffNormal')?.addEventListener('click', () => setAiDifficulty('normal'));
document.getElementById('diffMaster')?.addEventListener('click', () => setAiDifficulty('master'));

window.initBoomRoomSDK = function(data) {
  setupSDK(data);
};

window.onBoomRoomSDKReady = function() {
  if (window.BoomRoomSDK) {
    setupSDK({
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

window.addEventListener('resize', drawBoard);
drawBoard();
