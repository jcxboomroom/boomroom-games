const BOARD_SIZE = 15;
const COLS_LABELS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O'];

// 🌟 全局預先綁定 SDK 訊息監聽器，確保不漏接任何 postMessage
window.addEventListener('message', e => {
  // SDK v2 validates parent/source/session and owns dispatch. Keep the legacy
  // path only for older native hosts to avoid processing every move twice.
  if (window.BoomRoomSDK?.version === 2) return;
  try {
    const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    if (!data) return;
    if (data.action === 'initSDK' || data.user || data.roomPlayers || data.roomId) {
      setupSDK(data);
    } else if (data.action === 'gameEventReceived' || data.action === 'gameEvent') {
      handleNetworkEvent(data.eventName || data.name, data.payload || data.data, data.userId || data.senderId);
    }
  } catch (_) {}
});

window.addEventListener('gameEventReceived', e => {
  if (window.BoomRoomSDK?.version === 2) return;
  const detail = e.detail || {};
  handleNetworkEvent(detail.eventName, detail.payload, detail.senderId);
});

let sdk = window.BoomRoomSDK || null;

const ui = {
  canvas: document.getElementById('boardCanvas'),
  playerCounter: document.getElementById('playerCounter'),
  turnStone: document.getElementById('turnStone'),
  turnText: document.getElementById('turnText'),
  matchScore: document.getElementById('matchScore'),
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
  aiDifficultyBar: document.getElementById('aiDifficultyBar'),
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
let sdkInitialized = false;

// Game State & Match Score (三勝制)
let board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(0));
let moveHistory = [];
let currentTurn = 1; // 1: black, 2: white
let isPlaying = false;
let gameOverCalled = false;
let winningStones = [];
let hintPos = null;
let audioCtx = null;

let playerBlack = null;
let playerWhite = null;
const playerScores = new Map();
let roundCount = 0;
let singlePlayerHumanColor = 1;
let aiDifficulty = 'normal';
const handledUndoRequests = new Set();
const appliedUndoRequests = new Set();
let pendingUndoRequestId = null;
let authoritativeGomoku = false, serverVersion = 0, serverState = null;
let serverStartTime = 0, serverTimeReceived = 0, serverReceivedAt = 0;
let serverSyncTimer = null, serverUiTimer = null, shownServerRequest = null;
let serverCommandPending = false;
let serverPendingCommand = null, serverCommandTimeout = null, optimisticMove = null;

function gameServerTime() {
  return serverTimeReceived + performance.now() - serverReceivedAt;
}
function clearPendingServerCommand() {
  clearTimeout(serverCommandTimeout); serverCommandTimeout = null;
  serverPendingCommand = null; serverCommandPending = false;
}
function syncAiDifficultyControls() {
  const aiGame = authoritativeGomoku && serverState && (serverState.blackId === null || serverState.whiteId === null);
  ui.aiDifficultyBar?.classList.toggle('hidden', !aiGame);
  if (!aiGame) return;
  const selected = serverPendingCommand?.kind === 'SET_DIFFICULTY'
    ? aiDifficulty : (['easy', 'normal', 'master'].includes(serverState.aiDifficulty) ? serverState.aiDifficulty : 'normal');
  aiDifficulty = selected;
  for (const difficulty of ['easy', 'normal', 'master']) {
    const button = document.getElementById(`diff${difficulty[0].toUpperCase()}${difficulty.slice(1)}`);
    button?.classList.toggle('active', selected === difficulty);
    if (button) button.disabled = serverState.phase !== 'PLAYING' || serverState.moves.length > 0 ||
      serverCommandPending || optimisticMove !== null;
  }
}
function sendServerCommand(kind, fields = {}) {
  if (!authoritativeGomoku || !sdk?.isReady) return false;
  if (kind !== 'SYNC' && serverCommandPending) return false;
  let command = { kind };
  if (kind !== 'SYNC') {
    if (!window.crypto?.randomUUID) { showToast('此環境無法送出正式棋局操作，請更新瀏覽器。'); return false; }
    command = { ...fields, kind, commandId: window.crypto.randomUUID(), expectedVersion: serverVersion };
    serverCommandPending = true; serverPendingCommand = command;
    clearTimeout(serverCommandTimeout);
    const commandId = command.commandId;
    serverCommandTimeout = setTimeout(() => {
      if (serverPendingCommand?.commandId !== commandId) return;
      const timedOutKind = serverPendingCommand.kind;
      clearPendingServerCommand(); optimisticMove = null;
      if (timedOutKind === 'SET_DIFFICULTY' && serverState) aiDifficulty = serverState.aiDifficulty || 'normal';
      updateTurnUI(); drawBoard(); syncAiDifficultyControls();
      showToast('伺服器回覆較慢，已取消暫存並重新同步棋局。');
      sendServerCommand('SYNC');
    }, 5000);
    syncAiDifficultyControls();
  }
  const sent = sdk.sendGameEvent('GOMOKU_COMMAND', command);
  if (!sent && kind !== 'SYNC') clearPendingServerCommand();
  return sent;
}
function refreshServerNotice() {
  if (!serverState) return;
  const now = gameServerTime();
  if (serverState.phase === 'PLAYING') {
    isPlaying = now >= serverStartTime;
    ui.autoStartNotice.textContent = isPlaying ? '🎮 伺服器對局中 · 三勝制'
      : `⏱️ ${Math.max(0, Math.ceil((serverStartTime - now) / 1000))} 秒後開始`;
  } else if (serverState.phase === 'MATCH_RESULT') {
    const hint = document.querySelector('.auto-close-hint');
    if (hint) hint.textContent = `${Math.max(0, Math.ceil((serverState.returnAt - now) / 1000))} 秒後返回房間…`;
  } else {
    ui.resultReward.textContent = `${Math.max(0, Math.ceil((serverState.nextRoundAt - now) / 1000))} 秒後下一局…`;
  }
}
function applyServerState(packet) {
  if (!packet || !Number.isSafeInteger(packet.version) || packet.version < serverVersion ||
      !packet.state || packet.state.rulesVersion !== 1 || !Array.isArray(packet.state.board)) return;
  const state = packet.state;
  // State is only dispatched from the SDK's authenticated SYSTEM envelope.
  if (state.board.length !== BOARD_SIZE || state.board.some(row => !Array.isArray(row) || row.length !== BOARD_SIZE)) return;
  if (serverPendingCommand && packet.version > serverPendingCommand.expectedVersion) clearPendingServerCommand();
  if (optimisticMove && packet.version > optimisticMove.expectedVersion) {
    const confirmed = Array.isArray(state.moves) && state.moves.some(move =>
      move[0] === optimisticMove.row && move[1] === optimisticMove.col && move[2] === optimisticMove.color);
    optimisticMove = null;
    if (!confirmed) showToast('這步沒有被伺服器接受，棋盤已同步。');
  } else if (optimisticMove && Array.isArray(state.moves) && state.moves.some(move =>
    move[0] === optimisticMove.row && move[1] === optimisticMove.col && move[2] === optimisticMove.color)) {
    optimisticMove = null;
  }
  serverVersion = packet.version; serverState = state;
  serverStartTime = Number(packet.startTime); serverTimeReceived = Number(packet.serverTime); serverReceivedAt = performance.now();
  const participants = sdk.getSession().players;
  const role = id => id === null ? { id: 'AI', username: '🤖 伺服器 AI', isBot: true }
    : { ...participants.find(p => Number(p.userId ?? p.id) === id), id: String(id) };
  playerBlack = role(state.blackId); playerWhite = role(state.whiteId);
  board = state.board.map(row => [...row]); moveHistory = state.moves.map(move => [...move]);
  currentTurn = state.turn; winningStones = state.winningStones || []; hintPos = null;
  playerScores.clear(); Object.entries(state.scores).forEach(([id, score]) => playerScores.set(id, score));
  roundCount = state.round - 1; autoStarted = true; isPlaying = state.phase === 'PLAYING' && gameServerTime() >= serverStartTime;
  aiDifficulty = ['easy', 'normal', 'master'].includes(state.aiDifficulty) ? state.aiDifficulty : 'normal';
  if (ui.btnHint) ui.btnHint.style.display = 'none';
  updateRosterUI(); updateTurnUI(); syncAiDifficultyControls(); drawBoard(); refreshServerNotice();
  if (state.phase === 'PLAYING') ui.resultOverlay.classList.add('hidden');
  else {
    const winner = state.winnerColor === 1 ? playerBlack : state.winnerColor === 2 ? playerWhite : null;
    ui.resultTitle.textContent = !winner ? '🤝 平手！' : state.phase === 'MATCH_RESULT'
      ? `🏆 ${winner.username} 奪得三勝總冠軍！` : `🎉 本局由 ${winner.username} 獲勝！`;
    ui.resultSubtitle.textContent = `伺服器比分：${playerBlack.username} ${getPlayerScore(playerBlack)} : ${getPlayerScore(playerWhite)} ${playerWhite.username}`;
    if (state.phase === 'MATCH_RESULT') ui.resultReward.textContent = packet.resultVerified
      ? '結果已由伺服器驗證 · 本遊戲尚未設定銀幣獎勵' : '結果等待伺服器驗證';
    ui.resultOverlay.classList.remove('hidden');
  }
  const pending = state.pending;
  if (!pending) { shownServerRequest = null; document.getElementById('confirmOverlay')?.classList.add('hidden'); }
  if (pending && pending.requesterId !== Number(me.id) && isActivePlayer() && shownServerRequest !== pending.id) {
    shownServerRequest = pending.id;
    const kind = pending.kind === 'UNDO' ? 'UNDO_RESPONSE' : 'RESTART_RESPONSE';
    showConfirmModal(pending.kind === 'UNDO' ? '💬 悔棋申請' : '🔄 重開對局申請',
      pending.kind === 'UNDO' ? '對手申請悔棋一步，是否同意？' : '對手申請重開並重置比分，是否同意？',
      () => sendServerCommand(kind, { requestId: pending.id, accept: true }),
      () => sendServerCommand(kind, { requestId: pending.id, accept: false }));
  }
}

/* =========================================================
   AUDIO & SFX
========================================================= */

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
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
  sdkInitialized = true;
  clearTimeout(autoStartTimer);
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
    data.roomPlayers.forEach((rp, i) => {
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

  totalRoomPlayersCount = Math.max(1, roomPlayersMap.size);
  readyPlayersSet.add(me.id);
  const session = window.BoomRoomSDK?.getSession?.();
  if (session?.engine === 'GOMOKU' && window.BoomRoomSDK.version === 2) {
    authoritativeGomoku = true; sdk = window.BoomRoomSDK;
    applyServerState({ state: session.engineState, version: session.version, startTime: session.startTime,
      serverTime: session.serverTime, resultVerified: session.resultVerified });
    if (!serverSyncTimer) serverSyncTimer = setInterval(() => sendServerCommand('SYNC'), 2000);
    if (!serverUiTimer) serverUiTimer = setInterval(refreshServerNotice, 200);
    sendServerCommand('SYNC'); return;
  }
  assignRoles();
  updateRosterUI();
  updateAutoStartNotice();

  // 🌟 無論單人或多人，初始化後 600ms 內強制自動開局，絕不卡在 1/1
  setTimeout(() => {
    if (!isPlaying && !autoStarted) {
      triggerAutoStart();
    }
  }, 600);

  // The global message listeners above are installed once before SDK init.
  // Rebinding here on every init caused duplicate undo events and repeated rollbacks.
}

// 定期同步房間最新玩家清單
const rosterTimer = setInterval(() => {
  if (window.BoomRoomSDK && Array.isArray(window.BoomRoomSDK.roomPlayers)) {
    if (window.BoomRoomSDK.version === 2 && window.BoomRoomSDK.isReady) {
      const players = window.BoomRoomSDK.getRoomPlayers();
      const activeIds = new Set(players.map(player => String(player.id ?? player.userId)));
      let removed = false;
      for (const id of roomPlayersMap.keys()) {
        if (!activeIds.has(id)) { roomPlayersMap.delete(id); readyPlayersSet.delete(id); removed = true; }
      }
      if (removed) {
        totalRoomPlayersCount = roomPlayersMap.size;
        // Existing stones/roles stay bound to this round after a disconnect.
        if (!isPlaying && !authoritativeGomoku) assignRoles();
        updateRosterUI(); updateAutoStartNotice();
      }
    }
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
        if (!isPlaying && !authoritativeGomoku) assignRoles();
        updateRosterUI();
        updateAutoStartNotice();
        if (roomPlayersMap.size >= 2 && !isPlaying && !autoStarted) {
          triggerAutoStart();
        }
      }
    }
  }
}, 800);

function assignRoles() {
  const pList = [...roomPlayersMap.values()].sort((a, b) => {
    return String(a.id).localeCompare(String(b.id));
  });

  const roundIndex = roundCount;

  if (pList.length > 1) {
    // 🌟 每局黑白動態互換：偶數局 pList[0]為黑子，奇數局 pList[1]為黑子
    const isEvenRound = roundIndex % 2 === 0;
    playerBlack = isEvenRound ? pList[0] : pList[1];
    playerWhite = isEvenRound ? pList[1] : pList[0];
    ui.aiDifficultyBar?.classList.add('hidden');
    if (ui.btnHint) ui.btnHint.style.display = 'none'; // 🌟 對真人對打隱藏提示按鈕！
  } else {
    const bot = { id: 'ai-bot', username: '🤖 智勝 AI', isBot: true };
    playerBlack = singlePlayerHumanColor === 1 ? me : bot;
    playerWhite = singlePlayerHumanColor === 2 ? me : bot;
    ui.aiDifficultyBar?.classList.remove('hidden');
    if (ui.btnHint) ui.btnHint.style.display = 'inline-flex'; // 🌟 對 AI 顯示提示按鈕！
  }
}

function updateRosterUI() {
  ui.playerCounter.textContent = `👥 ${roomPlayersMap.size}/10 人`;
  ui.rosterList.innerHTML = '';

  const activeIds = new Set([playerBlack?.id, playerWhite?.id]);
  const pList = [playerBlack, playerWhite, ...[...roomPlayersMap.values()].filter(p => !activeIds.has(p.id))];
  pList.filter(Boolean).forEach((p, idx) => {
    const chip = document.createElement('div');
    chip.className = `roster-chip${p.id === me.id ? ' active' : ''}`;
    const roleTag = idx === 0 ? ' (黑子)' : idx === 1 ? ' (白子)' : ' (觀戰)';
    chip.textContent = `${p.username}${roleTag}`;
    ui.rosterList.appendChild(chip);
  });
  const spectator = !isActivePlayer();
  ui.btnUndo.disabled = spectator;
  ui.btnResign.disabled = spectator;
  ui.btnRestart.disabled = spectator;
}

function isActivePlayer() {
  return me.id === playerBlack?.id || me.id === playerWhite?.id;
}

function updateAutoStartNotice() {
  if (authoritativeGomoku) { refreshServerNotice(); return; }
  if (!ui.autoStartNotice) return;
  const count = readyPlayersSet.size;
  ui.autoStartNotice.textContent = `⏱️ 房間人數 ${count}/${totalRoomPlayersCount}，準備自動開始...`;

  if ((count >= totalRoomPlayersCount || roomPlayersMap.size >= 2) && !autoStarted && !isPlaying) {
    triggerAutoStart();
  }
}

function triggerAutoStart() {
  if (authoritativeGomoku) return;
  if (autoStarted) return;
  autoStarted = true;
  clearTimeout(autoStartTimer);
  ui.autoStartNotice.textContent = '🚀 人數已齊全，自動開局！';
  setTimeout(() => {
    startGomokuRound();
  }, 500);
}

function scheduleAutoStartFallback() {
  clearTimeout(autoStartTimer);
  autoStartTimer = setTimeout(() => {
    if (!autoStarted && !isPlaying) {
      triggerAutoStart();
    }
  }, 2500);
}

function startGomokuRound() {
  if (authoritativeGomoku) return;
  assignRoles();
  board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(0));
  moveHistory = [];
  currentTurn = 1;
  isPlaying = true;
  gameOverCalled = false;
  winningStones = [];
  hintPos = null;

  ui.autoStartNotice.textContent = isSinglePlayer() ? '🎮 單人 AI 對決中 · 三勝制' : '🎮 雙人對局中 · 三勝制';
  updateRosterUI();
  updateTurnUI();
  drawBoard();
}

function updateTurnUI() {
  ui.moveCount.textContent = `第 ${moveHistory.length} 步`;
  ui.matchScore.textContent = `${playerBlack?.username || '黑子'} ${getPlayerScore(playerBlack)} : ${getPlayerScore(playerWhite)} ${playerWhite?.username || '白子'} (三勝)`;

  const myColorStr = me.id === playerBlack?.id ? '⚫ 你是黑子' : (playerWhite && !playerWhite.isBot && me.id === playerWhite.id) ? '⚪ 你是白子' : '👁 觀戰中';

  if (currentTurn === 1) {
    ui.turnStone.className = 'stone-badge black';
    ui.turnText.textContent = `${myColorStr} · 黑子（${playerBlack?.username || '黑棋'}）落子`;
  } else {
    ui.turnStone.className = 'stone-badge white';
    ui.turnText.textContent = `${myColorStr} · 白子（${playerWhite?.username || '白棋'}）落子`;
  }

  if (!authoritativeGomoku && isPlaying && ((currentTurn === 1 && playerBlack?.isBot) || (currentTurn === 2 && playerWhite?.isBot))) {
    setTimeout(triggerAiMove, 400);
  }
}

function isSinglePlayer() {
  return !!(playerBlack?.isBot || playerWhite?.isBot);
}

function getPlayerScore(player) {
  return player ? (playerScores.get(String(player.id)) || 0) : 0;
}

function resetMatchScores() {
  playerScores.clear();
}

/* =========================================================
   CANVAS & DRAWING
========================================================= */

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const container = ui.canvas.parentElement;
  const available = container.getBoundingClientRect();
  const style = getComputedStyle(container);
  const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const verticalPadding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const size = Math.max(1, Math.floor(Math.min(
    available.width - horizontalPadding,
    available.height - verticalPadding
  )));
  ui.canvas.style.width = `${size}px`;
  ui.canvas.style.height = `${size}px`;
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

  const margin = 26;
  const cell = (w - margin * 2) / (BOARD_SIZE - 1);

  ctx.font = 'bold 9px sans-serif';
  ctx.fillStyle = '#6a4220';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < BOARD_SIZE; i++) {
    ctx.fillText(COLS_LABELS[i], margin + i * cell, margin / 2);
    ctx.fillText(COLS_LABELS[i], margin + i * cell, h - margin / 2);
    ctx.fillText(String(i + 1), margin / 2, margin + i * cell);
    ctx.fillText(String(i + 1), w - margin / 2, margin + i * cell);
  }

  ctx.strokeStyle = '#5c3a1e';
  ctx.lineWidth = 1.2;

  for (let i = 0; i < BOARD_SIZE; i++) {
    ctx.beginPath();
    ctx.moveTo(margin, margin + i * cell);
    ctx.lineTo(w - margin, margin + i * cell);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(margin + i * cell, margin);
    ctx.lineTo(margin + i * cell, h - margin);
    ctx.stroke();
  }

  const stars = [3, 7, 11];
  ctx.fillStyle = '#5c3a1e';
  stars.forEach(r => {
    stars.forEach(c => {
      ctx.beginPath();
      ctx.arc(margin + c * cell, margin + r * cell, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const stone = board[r][c];
      if (stone !== 0) {
        drawStone(c, r, stone, margin, cell);
      }
    }
  }

  if (optimisticMove && board[optimisticMove.row]?.[optimisticMove.col] === 0) {
    drawStone(optimisticMove.col, optimisticMove.row, optimisticMove.color, margin, cell);
  }

  if (optimisticMove || moveHistory.length > 0) {
    const [lastR, lastC, lastColor] = optimisticMove
      ? [optimisticMove.row, optimisticMove.col, optimisticMove.color]
      : moveHistory[moveHistory.length - 1];
    ctx.strokeStyle = lastColor === 1 ? '#ff3a9d' : '#35e6ff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(margin + lastC * cell, margin + lastR * cell, cell * 0.22, 0, Math.PI * 2);
    ctx.stroke();
  }

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
    const grad = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.35, radius * 0.1, x, y, radius);
    grad.addColorStop(0, '#777777');
    grad.addColorStop(0.5, '#222222');
    grad.addColorStop(1, '#050505');
    ctx.fillStyle = grad;
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 3;
  } else {
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

  const isMyTurn = (currentTurn === 1 && me.id === playerBlack?.id) ||
                   (currentTurn === 2 && playerWhite && !playerWhite.isBot && me.id === playerWhite.id);

  if (!isMyTurn) return;

  const rect = ui.canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const margin = 26;
  const cell = (rect.width - margin * 2) / (BOARD_SIZE - 1);

  const col = Math.round((x - margin) / cell);
  const row = Math.round((y - margin) / cell);

  if (col >= 0 && col < BOARD_SIZE && row >= 0 && row < BOARD_SIZE && board[row][col] === 0) {
    if (authoritativeGomoku) {
      if (serverCommandPending || optimisticMove) return;
      const color = currentTurn;
      optimisticMove = { row, col, color, expectedVersion: serverVersion };
      hintPos = null; playStoneSound(); drawBoard();
      ui.turnText.textContent = '落子已送出 · 等待伺服器確認';
      syncAiDifficultyControls();
      if (!sendServerCommand('MOVE', { row, col })) {
        optimisticMove = null; drawBoard(); syncAiDifficultyControls();
      }
      return;
    }
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
    finishRound(stoneColor);
  } else if (moveHistory.length === BOARD_SIZE * BOARD_SIZE) {
    finishRound(0);
  } else {
    currentTurn = currentTurn === 1 ? 2 : 1;
    updateTurnUI();
  }
}

function checkWin(row, col, color) {
  const directions = [
    [[0, 1], [0, -1]],
    [[1, 0], [-1, 0]],
    [[1, 1], [-1, -1]],
    [[1, -1], [-1, 1]]
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
  const aiColor = playerBlack?.isBot ? 1 : 2;
  if (!isPlaying || currentTurn !== aiColor) return;
  const bestMove = getBestAiMove(aiColor);
  if (bestMove) {
    placeMove(bestMove[0], bestMove[1], aiColor, false);
  }
}

function getBestAiMove(aiColor = playerBlack?.isBot ? 1 : 2) {
  const humanColor = aiColor === 1 ? 2 : 1;
  const scoredCandidates = [];

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === 0) {
        const centerDist = Math.abs(r - 7) + Math.abs(c - 7);
        const centerBonus = (14 - centerDist) * 3;

        const attack = evaluatePos(r, c, aiColor);
        const defense = evaluatePos(r, c, humanColor);

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

function showConfirmModal(title, msg, onAccept, onRefuse) {
  const modal = document.getElementById('confirmOverlay');
  if (!modal) return;
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMsg').textContent = msg;
  modal.classList.remove('hidden');

  const btnAccept = document.getElementById('btnConfirmAccept');
  const btnRefuse = document.getElementById('btnConfirmRefuse');

  const cleanup = () => {
    modal.classList.add('hidden');
    if (btnAccept) btnAccept.onclick = null;
    if (btnRefuse) btnRefuse.onclick = null;
  };

  if (btnAccept) {
    btnAccept.onclick = () => {
      cleanup();
      if (onAccept) onAccept();
    };
  }
  if (btnRefuse) {
    btnRefuse.onclick = () => {
      cleanup();
      if (onRefuse) onRefuse();
    };
  }
}

function showToast(msg) {
  if (ui.autoStartNotice) {
    ui.autoStartNotice.textContent = msg;
  }
}

function handleHint() {
  if (!isPlaying) return;
  if (!isSinglePlayer()) {
    showToast('⚠️ 對抗真人玩家時禁止使用 AI 提示！');
    return;
  }
  ensureAudio();
  const move = getBestAiMove(playerBlack?.isBot ? 1 : 2);
  if (move) {
    hintPos = move;
    drawBoard();
  }
}

function doUndoStep() {
  if (moveHistory.length > 0) {
    const [r, c] = moveHistory.pop();
    board[r][c] = 0;
  }
  currentTurn = (moveHistory.length % 2 === 0) ? 1 : 2;
  winningStones = [];
  hintPos = null;
  updateTurnUI();
  drawBoard();
}

function applyUndoRequestOnce(requestId) {
  if (!requestId || appliedUndoRequests.has(requestId)) return false;
  appliedUndoRequests.add(requestId);
  if (appliedUndoRequests.size > 100) {
    appliedUndoRequests.delete(appliedUndoRequests.values().next().value);
  }
  doUndoStep();
  return true;
}

function handleUndo() {
  if (!isActivePlayer() || !isPlaying || moveHistory.length === 0) return;
  if (authoritativeGomoku) { sendServerCommand('UNDO_REQUEST'); return; }
  ensureAudio();

  if (isSinglePlayer()) {
    doUndoStep();
    doUndoStep();
  } else {
    const opponent = me.id === playerBlack?.id ? playerWhite : playerBlack;
    pendingUndoRequestId = `${me.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    sendGameEvent('GOMOKU_UNDO_REQ', {
      senderId: me.id,
      senderName: me.username,
      recipientId: opponent?.id,
      requestId: pendingUndoRequestId,
    });
    showToast('📩 已向對手發送悔棋申請，等待對手同意...');
  }
}

function handleResign() {
  if (!isActivePlayer() || !isPlaying) return;
  if (authoritativeGomoku) { sendServerCommand('RESIGN'); return; }
  ensureAudio();

  if (isSinglePlayer()) {
    const aiColor = playerBlack?.isBot ? 1 : 2;
    finishRound(aiColor);
  } else {
    sendGameEvent('GOMOKU_RESIGN', { senderId: me.id });
    const myColor = me.id === playerBlack?.id ? 1 : 2;
    const winnerColor = myColor === 1 ? 2 : 1;
    finishRound(winnerColor);
  }
}

function handleRestart() {
  if (!isActivePlayer()) return;
  if (authoritativeGomoku) { sendServerCommand('RESTART_REQUEST'); return; }
  ensureAudio();

  if (isSinglePlayer()) {
    resetMatchScores();
    roundCount = 0;
    singlePlayerHumanColor = 1;
    startGomokuRound();
  } else {
    sendGameEvent('GOMOKU_RESTART_REQ', { senderId: me.id, senderName: me.username });
    showToast('📩 已向對手發送重新開局申請，等待對手同意...');
  }
}

/* =========================================================
   MATCH FINISH & BEST OF 3 (三勝制)
========================================================= */

function finishRound(winnerColor) {
  if (authoritativeGomoku) return;
  if (!isPlaying) return;
  isPlaying = false;
  playWinSound();
  drawBoard();

  const winner = winnerColor === 1 ? playerBlack : winnerColor === 2 ? playerWhite : null;
  if (winner) playerScores.set(String(winner.id), getPlayerScore(winner) + 1);
  roundCount++;
  if (isSinglePlayer()) {
    singlePlayerHumanColor = singlePlayerHumanColor === 1 ? 2 : 1;
  }

  const isMatchOver = getPlayerScore(playerBlack) >= 3 || getPlayerScore(playerWhite) >= 3;
  const roundWinnerName = winnerColor === 1 ? (playerBlack?.username || '黑子') : (playerWhite?.username || '白子');

  ui.resultTitle.textContent = winnerColor === 0
    ? '🤝 平手！'
    : isMatchOver
      ? `🏆 ${roundWinnerName} 奪得三勝總冠軍！`
      : `🎉 本局由 ${roundWinnerName} 獲勝！`;
  ui.resultSubtitle.textContent = `當前比分：${playerBlack?.username || '黑子'} ${getPlayerScore(playerBlack)} : ${getPlayerScore(playerWhite)} ${playerWhite?.username || '白子'} (三勝制)`;
  ui.resultReward.textContent = isMatchOver ? '銀幣獎勵尚待伺服器驗證' : '準備進入下一局…';

  ui.resultOverlay.classList.remove('hidden');

  if (isMatchOver) {
    const isWinner = (winnerColor === 1 && playerBlack?.id === me.id) || (winnerColor === 2 && playerWhite?.id === me.id);
    if (!gameOverCalled) {
      gameOverCalled = true;
      if (window.BoomRoomSDK && typeof window.BoomRoomSDK.gameOver === 'function') {
        try {
          const winnerWins = getPlayerScore(winner);
          const finalScore = isWinner ? 1000 + winnerWins * 100 + Math.max(0, 50 - moveHistory.length) : 0;
          window.BoomRoomSDK.gameOver(0, finalScore);
        } catch (_) {}
      }
    }

    let resultCountdownSec = 5;
    const autoCloseHintEl = document.querySelector('.auto-close-hint');
    if (autoCloseHintEl) {
      autoCloseHintEl.textContent = `${resultCountdownSec} 秒後自動返回房間...`;
    }

    const autoCloseTimer = setInterval(() => {
      resultCountdownSec--;
      if (autoCloseHintEl) {
        autoCloseHintEl.textContent = `${resultCountdownSec} 秒後自動返回房間...`;
      }
      if (resultCountdownSec <= 0) {
        clearInterval(autoCloseTimer);
        returnToRoom();
      }
    }, 1000);
  } else {
    // Automatically start next round after 2 seconds
    setTimeout(() => {
      ui.resultOverlay.classList.add('hidden');
      startGomokuRound();
    }, 2000);
  }
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
    try {
      window.BoomRoomSDK.sendGameEvent(eventName, payload);
      return;
    } catch (_) {}
  }
  if (window.parent && window.parent !== window) {
    try {
      window.parent.postMessage(JSON.stringify({ action: 'sendGameEvent', eventName, payload }), '*');
    } catch (_) {}
  }
}

window.handleGameEvent = function(eventName, payload, userId) {
  if (window.BoomRoomSDK?.version === 2) return;
  handleNetworkEvent(eventName, payload, userId);
};

function handleNetworkEvent(eventName, payload, senderId) {
  if (authoritativeGomoku) {
    if (senderId !== 'SYSTEM') return;
    if (eventName === 'GOMOKU_STATE') applyServerState(payload);
    else if (eventName === 'GOMOKU_ERROR') {
      const failedKind = serverPendingCommand?.kind;
      clearPendingServerCommand(); optimisticMove = null;
      if (failedKind === 'SET_DIFFICULTY' && serverState) aiDifficulty = serverState.aiDifficulty || 'normal';
      updateTurnUI(); drawBoard(); syncAiDifficultyControls();
      showToast(payload?.message || '操作失敗，正在重新同步');
      // One immediate read repairs rejected/stale optimistic UI. The regular
      // two-second sync remains the bounded fallback if the socket is offline.
      sendServerCommand('SYNC');
    }
    return;
  }
  if (!payload && !eventName) return;

  if (eventName === 'GOMOKU_MOVE' && payload) {
    const { row, col, stoneColor, userId } = payload;
    const expectedPlayer = stoneColor === 1 ? playerBlack : playerWhite;
    if (userId !== me.id && expectedPlayer?.id === userId && stoneColor === currentTurn &&
        Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < BOARD_SIZE &&
        col >= 0 && col < BOARD_SIZE && board[row][col] === 0 && isPlaying) {
      placeMove(row, col, stoneColor, false);
    }
  } else if (eventName === 'GOMOKU_UNDO_REQ') {
    const requestId = String(payload.requestId || `${payload.senderId}-legacy-undo`);
    if (payload.senderId !== me.id &&
        (!payload.recipientId || payload.recipientId === me.id) &&
        !handledUndoRequests.has(requestId)) {
      handledUndoRequests.add(requestId);
      showConfirmModal(
        '💬 悔棋申請',
        `對手【${payload.senderName || '玩家'}】申請悔棋一步，是否同意？`,
        () => {
          sendGameEvent('GOMOKU_UNDO_RESP', {
            senderId: me.id,
            requesterId: payload.senderId,
            requestId,
            accept: true,
          });
        },
        () => {
          sendGameEvent('GOMOKU_UNDO_RESP', {
            senderId: me.id,
            requesterId: payload.senderId,
            requestId,
            accept: false,
          });
        }
      );
    }
  } else if (eventName === 'GOMOKU_UNDO_RESP') {
    if (payload.requesterId === me.id && payload.requestId === pendingUndoRequestId) {
      const requestId = String(payload.requestId);
      pendingUndoRequestId = null;
      if (payload.accept) {
        // Apply locally once, then broadcast the same request ID so every peer
        // reaches the identical board state even if an event is delivered twice.
        applyUndoRequestOnce(requestId);
        sendGameEvent('GOMOKU_UNDO_APPLY', { requestId });
        showToast('🎉 對手同意了您的悔棋申請！');
      } else {
        showToast('❌ 對手拒絕了您的悔棋申請。');
      }
    }
  } else if (eventName === 'GOMOKU_UNDO_APPLY') {
    if (payload.requestId) {
      applyUndoRequestOnce(String(payload.requestId));
    }
  } else if (eventName === 'GOMOKU_RESIGN') {
    const resigningId = String(payload?.senderId ?? '');
    if (resigningId !== me.id &&
        (senderId == null || String(senderId) === resigningId)) {
      const winnerColor = resigningId === playerBlack?.id ? 2
        : resigningId === playerWhite?.id ? 1 : 0;
      if (!winnerColor) return;
      showToast('🏳️ 玩家認輸，本局已結算。');
      finishRound(winnerColor);
    }
  } else if (eventName === 'GOMOKU_RESTART_REQ') {
    if (payload.senderId !== me.id) {
      showConfirmModal(
        '🔄 重開對局申請',
        `對手【${payload.senderName || '玩家'}】請求重新開始比賽，是否同意？`,
        () => {
          resetMatchScores();
          roundCount = 0;
          singlePlayerHumanColor = 1;
          startGomokuRound();
          sendGameEvent('GOMOKU_RESTART_RESP', { senderId: me.id, accept: true });
        },
        () => {
          sendGameEvent('GOMOKU_RESTART_RESP', { senderId: me.id, accept: false });
        }
      );
    }
  } else if (eventName === 'GOMOKU_RESTART_RESP') {
    if (payload.senderId !== me.id) {
      if (payload.accept) {
        resetMatchScores();
        roundCount = 0;
        singlePlayerHumanColor = 1;
        startGomokuRound();
        showToast('🎉 對手同意重新開局，比分已重置！');
      } else {
        showToast('❌ 對手拒絕了重新開局申請。');
      }
    }
  }
}

/* =========================================================
   INIT & EVENT BINDINGS
========================================================= */

function setAiDifficulty(diff) {
  if (!['easy', 'normal', 'master'].includes(diff)) return;
  if (authoritativeGomoku) {
    const isAiGame = serverState && (serverState.blackId === null || serverState.whiteId === null);
    if (!isAiGame || serverState.moves.length > 0 || serverCommandPending || optimisticMove) {
      showToast('請在第一步落子前選擇 AI 難度。');
      return;
    }
    const previous = serverState.aiDifficulty || 'normal';
    aiDifficulty = diff;
    if (!sendServerCommand('SET_DIFFICULTY', { difficulty: diff })) {
      aiDifficulty = previous; syncAiDifficultyControls();
    } else syncAiDifficultyControls();
    return;
  }
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
  if (window.BoomRoomSDK && window.BoomRoomSDK.isReady !== false) {
    setupSDK({
      user: typeof window.BoomRoomSDK.getUser === 'function' ? window.BoomRoomSDK.getUser() : {},
      isHost: window.BoomRoomSDK.isHost,
      roomId: window.BoomRoomSDK.roomId,
      roomPlayers: window.BoomRoomSDK.roomPlayers || []
    });
  }
};

const sdkSubscriptions = [];
if (window.BoomRoomSDK?.version === 2) {
  sdkSubscriptions.push(window.BoomRoomSDK.onGameEvent(handleNetworkEvent));
}

if (window.BoomRoomSDK && window.BoomRoomSDK.isReady !== false) {
  window.onBoomRoomSDKReady();
} else if (window.parent === window) {
  // Standalone browser testing still starts a local human-vs-AI match.
  setTimeout(() => {
    if (!sdkInitialized) {
      setupSDK({ user: me, isHost: true, roomId: '', roomPlayers: [me] });
    }
  }, 1500);
}

window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  clearInterval(rosterTimer);
  clearInterval(serverSyncTimer); clearInterval(serverUiTimer);
  clearTimeout(autoStartTimer); clearTimeout(serverCommandTimeout);
  for (const unsubscribe of sdkSubscriptions) unsubscribe();
});

window.addEventListener('resize', resizeCanvas);
// The roster and AI controls also change the space left for the board.
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(resizeCanvas).observe(ui.canvas.parentElement);
}
ui.canvas.addEventListener('click', handleCanvasClick);
ui.btnHint.addEventListener('click', handleHint);
ui.btnUndo.addEventListener('click', handleUndo);
ui.btnResign.addEventListener('click', handleResign);
ui.btnRestart.addEventListener('click', handleRestart);

resizeCanvas();
