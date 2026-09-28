const BOARD_SIZE = 15;
let sdk = window.BoomRoomSDK || null;

const ui = {
  canvas: document.getElementById('boardCanvas'),
  playerCounter: document.getElementById('playerCounter'),
  turnBanner: document.getElementById('turnBanner'),
  turnStone: document.getElementById('turnStone'),
  turnText: document.getElementById('turnText'),
  autoStartNotice: document.getElementById('autoStartNotice'),
  rosterList: document.getElementById('rosterList'),
  resultOverlay: document.getElementById('resultOverlay'),
  resultTitle: document.getElementById('resultTitle'),
  resultSubtitle: document.getElementById('resultSubtitle'),
  resultReward: document.getElementById('resultReward'),
};

const ctx = ui.canvas.getContext('2d');

let me = { id: `local-${Math.random().toString(36).slice(2, 8)}`, username: '玩家', avatar: '' };
let isHost = sdk ? !!sdk.isHost : true;
let roomId = sdk ? (sdk.roomId || '') : '';
let roomPlayersMap = new Map();
let readyPlayersSet = new Set();
let totalRoomPlayersCount = 1;
let autoStarted = false;
let autoStartTimer = null;

// Game State
let board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(0)); // 0: empty, 1: black, 2: white
let currentTurn = 1; // 1: black, 2: white
let isPlaying = false;
let gameOverCalled = false;
let winningStones = [];

let playerBlack = null;
let playerWhite = null;

function setupSDK(data) {
  if (data && data.user) {
    me.id = String(data.user.id || me.id);
    me.username = String(data.user.username || '玩家').slice(0, 16);
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
  assignRoles();
  updateRosterUI();
  updateAutoStartNotice();
  scheduleAutoStartFallback();
  bindGameEvents();
}

function assignRoles() {
  const pList = [...roomPlayersMap.values()];
  playerBlack = pList[0] || me;
  playerWhite = pList[1] || null;
}

function updateRosterUI() {
  ui.playerCounter.textContent = `👥 ${roomPlayersMap.size}/10 人`;
  ui.rosterList.innerHTML = '';
  [...roomPlayersMap.values()].forEach((p, idx) => {
    const chip = document.createElement('div');
    chip.className = `roster-chip${p.id === me.id ? ' active' : ''}`;
    const roleTag = idx === 0 ? ' (黑子)' : idx === 1 ? ' (白子)' : ' (觀戰)';
    chip.textContent = `${p.username}${roleTag}`;
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
    startGomokuRound();
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

function startGomokuRound() {
  board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(0));
  currentTurn = 1;
  isPlaying = true;
  gameOverCalled = false;
  winningStones = [];
  ui.autoStartNotice.textContent = '🎮 對局進行中 · 點擊棋盤落子';
  updateTurnUI();
  drawBoard();
}

function updateTurnUI() {
  if (currentTurn === 1) {
    ui.turnStone.className = 'stone-indicator black';
    ui.turnText.textContent = `黑子（${playerBlack?.username || '黑棋'}）落子中`;
  } else {
    ui.turnStone.className = 'stone-indicator white';
    ui.turnText.textContent = `白子（${playerWhite?.username || '白棋'}）落子中`;
  }
}

/* =========================================================
   CANVAS & DRAWING
========================================================= */

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = ui.canvas.getBoundingClientRect();
  ui.canvas.width = rect.width * dpr;
  ui.canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawBoard();
}

function drawBoard() {
  const w = ui.canvas.clientWidth;
  const h = ui.canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);

  const padding = 20;
  const cell = (w - padding * 2) / (BOARD_SIZE - 1);

  // 1. Draw Grid Lines
  ctx.strokeStyle = '#5c3a1e';
  ctx.lineWidth = 1.2;

  for (let i = 0; i < BOARD_SIZE; i++) {
    // Horizontal
    ctx.beginPath();
    ctx.moveTo(padding, padding + i * cell);
    ctx.lineTo(w - padding, padding + i * cell);
    ctx.stroke();

    // Vertical
    ctx.beginPath();
    ctx.moveTo(padding + i * cell, padding);
    ctx.lineTo(padding + i * cell, h - padding);
    ctx.stroke();
  }

  // 2. Draw Star Points (天元, 4角)
  const stars = [3, 7, 11];
  ctx.fillStyle = '#5c3a1e';
  stars.forEach(r => {
    stars.forEach(c => {
      ctx.beginPath();
      ctx.arc(padding + c * cell, padding + r * cell, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  // 3. Draw Stones
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const stone = board[r][c];
      if (stone !== 0) {
        drawStone(c, r, stone, padding, cell);
      }
    }
  }

  // 4. Highlight Winning Stones
  if (winningStones.length > 0) {
    ctx.strokeStyle = '#35e6ff';
    ctx.lineWidth = 3;
    winningStones.forEach(([r, c]) => {
      ctx.beginPath();
      ctx.arc(padding + c * cell, padding + r * cell, cell * 0.42, 0, Math.PI * 2);
      ctx.stroke();
    });
  }
}

function drawStone(c, r, stone, padding, cell) {
  const x = padding + c * cell;
  const y = padding + r * cell;
  const radius = cell * 0.42;

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);

  if (stone === 1) {
    // Black Stone
    const grad = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
    grad.addColorStop(0, '#666');
    grad.addColorStop(1, '#000');
    ctx.fillStyle = grad;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 3;
  } else {
    // White Stone
    const grad = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#dddddd');
    ctx.fillStyle = grad;
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 3;
  }

  ctx.fill();
  ctx.restore();
}

/* =========================================================
   INTERACTION & GAME LOGIC
========================================================= */

function handleCanvasClick(e) {
  if (!isPlaying) return;

  // Check turn permission
  const isMyTurn = (currentTurn === 1 && me.id === playerBlack?.id) ||
                   (currentTurn === 2 && (playerWhite ? me.id === playerWhite.id : true));

  if (!isMyTurn) return;

  const rect = ui.canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const padding = 20;
  const cell = (rect.width - padding * 2) / (BOARD_SIZE - 1);

  const col = Math.round((x - padding) / cell);
  const row = Math.round((y - padding) / cell);

  if (col >= 0 && col < BOARD_SIZE && row >= 0 && row < BOARD_SIZE && board[row][col] === 0) {
    placeMove(row, col, currentTurn, true);
  }
}

function placeMove(row, col, stoneColor, isLocalAction) {
  board[row][col] = stoneColor;

  if (isLocalAction) {
    sendGameEvent('GOMOKU_MOVE', { row, col, stoneColor, userId: me.id });
  }

  drawBoard();

  if (checkWin(row, col, stoneColor)) {
    finishGomokuRound(stoneColor);
  } else {
    currentTurn = currentTurn === 1 ? 2 : 1;
    updateTurnUI();
  }
}

function checkWin(row, col, color) {
  const directions = [
    [[0, 1], [0, -1]],   // Horizontal
    [[1, 0], [-1, 0]],   // Vertical
    [[1, 1], [-1, -1]],  // Diagonal \
    [[1, -1], [-1, 1]]   // Anti-Diagonal /
  ];

  for (const dirPair of directions) {
    let line = [[row, col]];

    for (const [dr, dc] of dirPair) {
      let r = row + dr;
      let c = col + dc;
      while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === color) {
        line.push([r, c]);
        r += dr;
        c += dc;
      }
    }

    if (line.length >= 5) {
      winningStones = line;
      return true;
    }
  }
  return false;
}

function finishGomokuRound(winnerColor) {
  isPlaying = false;
  drawBoard();

  const winner = winnerColor === 1 ? playerBlack : (playerWhite || { username: '白棋' });
  const isWinner = winner?.id === me.id;

  ui.resultTitle.textContent = isWinner ? '🏆 恭喜獲勝！' : `🏆 ${winner?.username || '對手'} 獲勝！`;
  ui.resultSubtitle.textContent = '完成 5 子連珠連擊對決！';
  ui.resultReward.textContent = isWinner ? '+100 銀幣' : '+0 銀幣';

  ui.resultOverlay.classList.remove('hidden');

  if (!gameOverCalled) {
    gameOverCalled = true;
    if (window.BoomRoomSDK && typeof window.BoomRoomSDK.gameOver === 'function') {
      try {
        window.BoomRoomSDK.gameOver(isWinner ? 100 : 0);
      } catch (err) {
        console.warn('gameOver callback failed', err);
      }
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
  if (eventName === 'GOMOKU_MOVE' && payload) {
    const { row, col, stoneColor, userId } = payload;
    if (userId !== me.id && board[row][col] === 0) {
      placeMove(row, col, stoneColor, false);
    }
  }
}

/* =========================================================
   INIT & EVENT BINDING
========================================================= */

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

window.addEventListener('resize', resizeCanvas);
ui.canvas.addEventListener('click', handleCanvasClick);
resizeCanvas();
