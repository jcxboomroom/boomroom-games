const BOARD_SIZE = 15;
const COLS_LABELS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O'];

let sdk = window.BoomRoomSDK || null;

const ui = {
  canvas: document.getElementById('boardCanvas'),
  playerCounter: document.getElementById('playerCounter'),
  turnStone: document.getElementById('turnStone'),
  turnText: document.getElementById('turnText'),
  moveCount: document.getElementById('moveCount'),
  autoStartNotice: document.getElementById('autoStartNotice'),
  rosterList: document.getElementById('rosterList'),
  resultOverlay: document.getElementById('resultOverlay'),
  resultTitle: document.getElementById('resultTitle'),
  resultSubtitle: document.getElementById('resultSubtitle'),
  resultReward: document.getElementById('resultReward'),
  btnHint: document.getElementById('btnHint'),
  btnUndo: document.getElementById('btnUndo'),
  btnResign: document.getElementById('btnResign'),
  btnRestart: document.getElementById('btnRestart'),
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
let board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(0)); // 0: empty, 1: black, 2: white
let moveHistory = []; // [[row, col, color], ...]
let currentTurn = 1; // 1: black, 2: white
let isPlaying = false;
let gameOverCalled = false;
let winningStones = [];
let hintPos = null;
let audioCtx = null;

let playerBlack = null;
let playerWhite = null;

/* =========================================================
   AUDIO & SFX
========================================================= */

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function playStoneSound() {
  try {
    ensureAudio();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320 + Math.random() * 40, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.08);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.08);
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
  assignRoles();
  updateRosterUI();
  updateAutoStartNotice();
  scheduleAutoStartFallback();
  bindGameEvents();
}

// 🌟 定期同步房間最新玩家清單（防止房主端漏接其他玩家）
setInterval(() => {
  if (window.BoomRoomSDK && Array.isArray(window.BoomRoomSDK.roomPlayers)) {
    if (window.BoomRoomSDK.roomPlayers.length > 0) {
      let changed = false;
      window.BoomRoomSDK.roomPlayers.forEach((rp, i) => {
        if (rp && rp.id != null) {
          const id = String(rp.id);
          if (!roomPlayersMap.has(id)) {
            roomPlayersMap.set(id, {
              id,
              username: String(rp.username || `玩家${i + 1}`).slice(0, 16),
              avatar: String(rp.avatar || '')
            });
            readyPlayersSet.add(id);
            changed = true;
          }
        }
      });
      if (changed) {
        totalRoomPlayersCount = Math.max(1, roomPlayersMap.size);
        assignRoles();
        updateRosterUI();
        updateAutoStartNotice();
      }
    }
  }
}, 1000);

function assignRoles() {
  const pList = [...roomPlayersMap.values()];
  playerBlack = pList[0] || me;

  if (pList.length > 1) {
    playerWhite = pList[1];
  } else {
    // 🌟 單人模式：自動分配智能 AI「🤖 智勝 AI」為白子！
    playerWhite = { id: 'ai-bot', username: '🤖 智勝 AI', isBot: true };
  }
}

function updateRosterUI() {
  ui.playerCounter.textContent = `👥 ${roomPlayersMap.size}/10 人`;
  ui.rosterList.innerHTML = '';

  const pList = [playerBlack, playerWhite, ...[...roomPlayersMap.values()].filter(p => p !== playerBlack && p !== playerWhite)];
  pList.filter(Boolean).forEach((p, idx) => {
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
  moveHistory = [];
  currentTurn = 1;
  isPlaying = true;
  gameOverCalled = false;
  winningStones = [];
  hintPos = null;

  ui.autoStartNotice.textContent = playerWhite?.isBot ? '🎮 單人 AI 對決中 · 點擊棋盤落子' : '🎮 房間多人對局中 · 點擊棋盤落子';
  updateTurnUI();
  drawBoard();
}

function updateTurnUI() {
  ui.moveCount.textContent = `第 ${moveHistory.length} 步`;

  if (currentTurn === 1) {
    ui.turnStone.className = 'stone-badge black';
    ui.turnText.textContent = `黑子（${playerBlack?.username || '黑棋'}）落子中`;
  } else {
    ui.turnStone.className = 'stone-badge white';
    ui.turnText.textContent = `白子（${playerWhite?.username || '白棋'}）落子中`;
  }

  // 🌟 單人 AI 回合自動觸發 AI 計算落子
  if (isPlaying && currentTurn === 2 && playerWhite?.isBot) {
    setTimeout(triggerAiMove, 450);
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

  const margin = 26; // Margin for A-O & 1-15 labels
  const cell = (w - margin * 2) / (BOARD_SIZE - 1);

  // 1. Draw Grid Coordinate Labels (A-O, 1-15)
  ctx.font = 'bold 9px sans-serif';
  ctx.fillStyle = '#6a4220';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < BOARD_SIZE; i++) {
    // Top & Bottom A-O
    ctx.fillText(COLS_LABELS[i], margin + i * cell, margin / 2);
    ctx.fillText(COLS_LABELS[i], margin + i * cell, h - margin / 2);

    // Left & Right 1-15
    ctx.fillText(String(i + 1), margin / 2, margin + i * cell);
    ctx.fillText(String(i + 1), w - margin / 2, margin + i * cell);
  }

  // 2. Draw Grid Lines
  ctx.strokeStyle = '#5c3a1e';
  ctx.lineWidth = 1.2;

  for (let i = 0; i < BOARD_SIZE; i++) {
    // Horizontal
    ctx.beginPath();
    ctx.moveTo(margin, margin + i * cell);
    ctx.lineTo(w - margin, margin + i * cell);
    ctx.stroke();

    // Vertical
    ctx.beginPath();
    ctx.moveTo(margin + i * cell, margin);
    ctx.lineTo(margin + i * cell, h - margin);
    ctx.stroke();
  }

  // 3. Draw Star Points (天元, 4角)
  const stars = [3, 7, 11];
  ctx.fillStyle = '#5c3a1e';
  stars.forEach(r => {
    stars.forEach(c => {
      ctx.beginPath();
      ctx.arc(margin + c * cell, margin + r * cell, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  // 4. Draw Stones
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const stone = board[r][c];
      if (stone !== 0) {
        drawStone(c, r, stone, margin, cell);
      }
    }
  }

  // 5. Highlight Last Move Marker (紅色環形最新落子標記)
  if (moveHistory.length > 0) {
    const [lastR, lastC, lastColor] = moveHistory[moveHistory.length - 1];
    ctx.strokeStyle = lastColor === 1 ? '#ff3a9d' : '#35e6ff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(margin + lastC * cell, margin + lastR * cell, cell * 0.22, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 6. Highlight Hint Position (💡 提示亮圈)
  if (hintPos && isPlaying) {
    const [hR, hC] = hintPos;
    ctx.strokeStyle = '#35e6ff';
    ctx.lineWidth = 3;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(margin + hC * cell, margin + hR * cell, cell * 0.45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 7. Highlight Winning 5 Stones
  if (winningStones.length > 0) {
    ctx.strokeStyle = '#4ee08a';
    ctx.lineWidth = 3.5;
    winningStones.forEach(([r, c]) => {
      ctx.beginPath();
      ctx.arc(margin + c * cell, margin + r * cell, cell * 0.45, 0, Math.PI * 2);
      ctx.stroke();
    });
  }
}

function drawStone(c, r, stone, margin, cell) {
  const x = margin + c * cell;
  const y = margin + r * cell;
  const radius = cell * 0.43;

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);

  if (stone === 1) {
    // 3D Metallic Black Stone
    const grad = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.35, radius * 0.1, x, y, radius);
    grad.addColorStop(0, '#777777');
    grad.addColorStop(0.5, '#222222');
    grad.addColorStop(1, '#050505');
    ctx.fillStyle = grad;
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 3;
  } else {
    // Glossy Pearl White Stone
    const grad = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.35, radius * 0.1, x, y, radius);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.7, '#ececec');
    grad.addColorStop(1, '#b5b5b5');
    ctx.fillStyle = grad;
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
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

  // Permission Check
  const isMyTurn = (currentTurn === 1 && me.id === playerBlack?.id) ||
                   (currentTurn === 2 && (playerWhite?.isBot ? false : me.id === playerWhite?.id));

  if (!isMyTurn) return;

  const rect = ui.canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const margin = 26;
  const cell = (rect.width - margin * 2) / (BOARD_SIZE - 1);

  const col = Math.round((x - margin) / cell);
  const row = Math.round((y - margin) / cell);

  if (col >= 0 && col < BOARD_SIZE && row >= 0 && row < BOARD_SIZE && board[row][col] === 0) {
    placeMove(row, col, currentTurn, true);
  }
}

function placeMove(row, col, stoneColor, isLocalAction) {
  board[row][col] = stoneColor;
  moveHistory.push([row, col, stoneColor]);
  hintPos = null;

  playStoneSound();

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

/* =========================================================
   SMART GOMOKU AI ENGINE
========================================================= */

function triggerAiMove() {
  if (!isPlaying || currentTurn !== 2) return;
  const bestMove = getBestAiMove();
  if (bestMove) {
    placeMove(bestMove[0], bestMove[1], 2, false);
  }
}

let aiDifficulty = 'normal';

function setAiDifficulty(diff) {
  aiDifficulty = diff;
  document.getElementById('diffEasy')?.classList.toggle('active', diff === 'easy');
  document.getElementById('diffNormal')?.classList.toggle('active', diff === 'normal');
  document.getElementById('diffMaster')?.classList.toggle('active', diff === 'master');
}

function getBestAiMove() {
  const scoredCandidates = [];

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === 0) {
        const centerDist = Math.abs(r - 7) + Math.abs(c - 7);
        const centerBonus = (14 - centerDist) * 3;

        const attack = evaluatePos(r, c, 2);
        const defense = evaluatePos(r, c, 1);

        let totalScore = attack * 1.15 + defense + centerBonus;

        if (attack >= 100000) totalScore += 1000000;
        if (defense >= 100000) totalScore += 800000;

        scoredCandidates.push({ r, c, score: totalScore });
      }
    }
  }

  if (scoredCandidates.length === 0) return [7, 7];

  scoredCandidates.sort((a, b) => b.score - a.score);

  if (aiDifficulty === 'easy') {
    if (Math.random() < 0.35 && scoredCandidates.length >= 4) {
      const pick = scoredCandidates[Math.floor(Math.random() * Math.min(4, scoredCandidates.length))];
      return [pick.r, pick.c];
    }
  } else if (aiDifficulty === 'normal') {
    if (Math.random() < 0.10 && scoredCandidates.length >= 2) {
      const pick = scoredCandidates[Math.floor(Math.random() * Math.min(2, scoredCandidates.length))];
      return [pick.r, pick.c];
    }
  }

  return [scoredCandidates[0].r, scoredCandidates[0].c];
}

function evaluatePos(row, col, color) {
  board[row][col] = color;
  let score = 0;

  const directions = [
    [[0, 1], [0, -1]],
    [[1, 0], [-1, 0]],
    [[1, 1], [-1, -1]],
    [[1, -1], [-1, 1]]
  ];

  for (const dirPair of directions) {
    let count = 1;
    let openEnds = 0;

    for (const [dr, dc] of dirPair) {
      let r = row + dr;
      let c = col + dc;
      while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === color) {
        count++;
        r += dr;
        c += dc;
      }
      if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === 0) {
        openEnds++;
      }
    }

    if (count >= 5) score += 100000;
    else if (count === 4 && openEnds === 2) score += 10000;
    else if (count === 4 && openEnds === 1) score += 2500;
    else if (count === 3 && openEnds === 2) score += 1000;
    else if (count === 3 && openEnds === 1) score += 200;
    else if (count === 2 && openEnds === 2) score += 100;
  }

  board[row][col] = 0;
  return score;
}

/* =========================================================
   TOOLKITS (提示, 悔棋, 認輸, 重來)
========================================================= */

function handleHint() {
  if (!isPlaying) return;
  ensureAudio();
  const move = getBestAiMove();
  if (move) {
    hintPos = move;
    drawBoard();
  }
}

function handleUndo() {
  if (!isPlaying || moveHistory.length === 0) return;
  ensureAudio();

  // In AI mode, undo 2 moves (your move + AI move)
  const steps = (playerWhite?.isBot && moveHistory.length >= 2) ? 2 : 1;

  for (let i = 0; i < steps; i++) {
    if (moveHistory.length > 0) {
      const [r, c] = moveHistory.pop();
      board[r][c] = 0;
    }
  }

  currentTurn = (moveHistory.length % 2 === 0) ? 1 : 2;
  winningStones = [];
  hintPos = null;
  updateTurnUI();
  drawBoard();
}

function handleResign() {
  if (!isPlaying) return;
  ensureAudio();
  const winnerColor = currentTurn === 1 ? 2 : 1;
  finishGomokuRound(winnerColor);
}

function handleRestart() {
  ensureAudio();
  startGomokuRound();
}

/* =========================================================
   RESULT & SETTLEMENT
========================================================= */

function finishGomokuRound(winnerColor) {
  isPlaying = false;
  playWinSound();
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
   INIT & EVENT BINDINGS
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
ui.btnHint.addEventListener('click', handleHint);
ui.btnUndo.addEventListener('click', handleUndo);
ui.btnResign.addEventListener('click', handleResign);
ui.btnRestart.addEventListener('click', handleRestart);

document.getElementById('diffEasy')?.addEventListener('click', () => setAiDifficulty('easy'));
document.getElementById('diffNormal')?.addEventListener('click', () => setAiDifficulty('normal'));
document.getElementById('diffMaster')?.addEventListener('click', () => setAiDifficulty('master'));

resizeCanvas();
