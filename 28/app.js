const ROUND_SECONDS = 45;
const HIT_WINDOW_MS = 1450;
const AUTO_START_MS = 3500;
const RETURN_DELAY_MS = 3000;
const WIRE_NAMES = ['紅線', '藍線', '黃線'];
const sdk = window.BoomRoomSDK || null;

const ui = {
  roomLabel: document.querySelector('#roomLabel'),
  playerCount: document.querySelector('#playerCount'),
  phaseLabel: document.querySelector('#phaseLabel'),
  headline: document.querySelector('#headline'),
  timer: document.querySelector('#timer'),
  arena: document.querySelector('#arena'),
  arenaStatus: document.querySelector('#arenaStatus'),
  targetWrap: document.querySelector('#targetWrap'),
  target: document.querySelector('#target'),
  targetWord: document.querySelector('#targetWord'),
  targetHint: document.querySelector('#targetHint'),
  wireButtons: [...document.querySelectorAll('.wire-button')],
  streak: document.querySelector('#streak'),
  scoreList: document.querySelector('#scoreList'),
  resultScreen: document.querySelector('#resultScreen'),
  resultTitle: document.querySelector('#resultTitle'),
  resultSummary: document.querySelector('#resultSummary'),
  resultWinner: document.querySelector('#resultWinner'),
};

const state = {
  me: { id: `guest-${Math.random().toString(36).slice(2, 8)}`, username: '玩家', avatar: '' },
  isHost: sdk ? !!sdk.isHost : true,
  roomId: '',
  players: new Map(),
  phase: 'menu',
  startAt: 0,
  endAt: 0,
  currentTarget: -1,
  attemptedTargets: new Map(),
  playerStreaks: new Map(),
  localAttemptedTarget: -1,
  localStreak: 0,
  localStreakTarget: -1,
  fallbackTimer: 0,
  returnTimer: 0,
  raf: 0,
  finished: false,
};

function cleanPlayer(raw, fallbackId) {
  const id = raw?.id == null ? fallbackId : String(raw.id);
  return {
    id,
    username: String(raw?.username || '玩家').slice(0, 22),
    avatar: String(raw?.avatar || ''),
    score: 0,
  };
}

function addPlayer(raw, fallbackId) {
  if (!raw || raw.id == null && !fallbackId) return;
  const player = cleanPlayer(raw, fallbackId);
  const previous = state.players.get(player.id);
  if (previous) {
    previous.username = player.username || previous.username;
    previous.avatar = player.avatar || previous.avatar;
  } else if (state.players.size < 10) {
    state.players.set(player.id, player);
  }
}

function seedPlayers(roomPlayers = []) {
  if (Array.isArray(roomPlayers)) roomPlayers.slice(0, 10).forEach(player => addPlayer(player));
  addPlayer(state.me);
  ui.playerCount.textContent = String(Math.max(1, Math.min(10, state.players.size)));
  ui.roomLabel.textContent = state.roomId ? `房間 ${state.roomId}` : '派對進行中';
  renderScores();
}

async function setupSdk() {
  if (!sdk) {
    seedPlayers([]);
    scheduleAutoStart();
    return;
  }

  state.roomId = sdk.roomId == null ? '' : String(sdk.roomId);
  state.isHost = !!sdk.isHost;
  try {
    if (typeof sdk.getUser === 'function') {
      const user = await sdk.getUser();
      if (user) state.me = cleanPlayer(user, state.me.id);
    }
  } catch (error) {
    console.warn('BoomRoom 玩家資料讀取失敗', error);
  }

  seedPlayers(sdk.roomPlayers);
  bindGameEvents();
  scheduleAutoStart();
}

function bindGameEvents() {
  const receive = (...args) => {
    if (typeof args[0] === 'string') {
      receiveGameEvent(args[0], args[1] || {}, args[2]);
      return;
    }
    const detail = args[0]?.detail ?? args[0] ?? {};
    if (typeof detail.eventName === 'string') {
      receiveGameEvent(detail.eventName, detail.payload || {}, detail.senderId);
    } else if (typeof detail.name === 'string') {
      receiveGameEvent(detail.name, detail.payload || {}, detail.senderId);
    }
  };

  window.handleGameEvent = receiveGameEvent;
  window.addEventListener('gameEventReceived', receive);
  window.addEventListener('message', event => {
    const data = event.data;
    if (data?.action === 'gameEventReceived') {
      receiveGameEvent(data.eventName, data.payload || {}, data.senderId);
    }
  });

  if (typeof sdk?.addEventListener === 'function') {
    sdk.addEventListener('gameEventReceived', receive);
  }
  if (typeof sdk?.on === 'function') {
    sdk.on('gameEventReceived', receive);
  }
}

function sendEvent(eventName, payload) {
  if (typeof sdk?.sendGameEvent === 'function') {
    sdk.sendGameEvent(eventName, payload);
  }
}

function receiveGameEvent(eventName, payload = {}, senderId) {
  if (!payload || typeof payload !== 'object') payload = {};
  const sender = senderId == null ? String(payload.userId || '') : String(senderId);
  if (sender && !state.players.has(sender) && payload.player) addPlayer(payload.player, sender);

  if (eventName === 'BR_START' && !state.finished && state.phase === 'menu') {
    startRound(Number(payload.startAt) || Date.now() + 500);
  } else if (eventName === 'BR_CHOICE' && state.isHost && state.phase === 'playing') {
    processChoice(sender, Number(payload.targetId), Number(payload.wire));
  } else if (eventName === 'BR_SCORE') {
    applyScores(payload.scores);
  } else if (eventName === 'BR_RESULT' && state.phase !== 'results') {
    applyScores(payload.scores);
    finishRound(false);
  }
}

function scheduleAutoStart() {
  clearTimeout(state.fallbackTimer);
  ui.phaseLabel.textContent = '自動配對中';
  ui.headline.textContent = '準備拆彈';
  ui.targetWord.textContent = '等一下';
  ui.targetHint.textContent = '即將自動開始';
  state.fallbackTimer = window.setTimeout(() => {
    if (state.phase !== 'menu') return;
    const startAt = Date.now() + 1200;
    if (state.isHost) sendEvent('BR_START', { startAt });
    startRound(startAt);
  }, AUTO_START_MS);
}

function startRound(startAt) {
  if (state.phase !== 'menu' || state.finished) return;
  clearTimeout(state.fallbackTimer);
  state.phase = 'playing';
  state.startAt = startAt;
  state.endAt = startAt + ROUND_SECONDS * 1000;
  state.currentTarget = -1;
  state.localAttemptedTarget = -1;
  state.localStreak = 0;
  state.localStreakTarget = -1;
  ui.phaseLabel.textContent = '反應時間';
  ui.headline.textContent = '看到就拆！';
  ui.arenaStatus.textContent = '回合進行中';
  ui.arenaStatus.parentElement.classList.add('active');
  renderFrame();
}

function renderFrame() {
  if (state.phase !== 'playing') return;
  const now = Date.now();
  const remaining = Math.max(0, state.endAt - now);
  if (now < state.startAt) {
    const count = Math.max(1, Math.ceil((state.startAt - now) / 1000));
    ui.timer.innerHTML = `${count}<span>s</span>`;
    ui.targetWord.textContent = String(count);
    ui.targetHint.textContent = '準備';
    ui.wireButtons.forEach(button => { button.disabled = true; });
    state.raf = requestAnimationFrame(renderFrame);
    return;
  }
  if (state.startAt && state.endAt - now > ROUND_SECONDS * 1000) {
    state.endAt = state.startAt + ROUND_SECONDS * 1000;
  }
  if (remaining <= 0) {
    finishRound(true);
    return;
  }

  ui.timer.innerHTML = `${Math.ceil(remaining / 1000)}<span>s</span>`;
  const targetId = Math.floor((now - state.startAt) / HIT_WINDOW_MS);
  ui.wireButtons.forEach(button => { button.disabled = state.localAttemptedTarget === targetId; });
  if (targetId !== state.currentTarget) {
    state.currentTarget = targetId;
    moveTarget(targetId);
    const wire = expectedWire(targetId);
    ui.targetWord.textContent = WIRE_NAMES[wire];
    ui.targetHint.textContent = `剪線倒數 ${(HIT_WINDOW_MS / 1000).toFixed(1)} 秒`;
    ui.target.dataset.wire = String(wire);
    ui.target.classList.remove('hit', 'miss');
    ui.wireButtons.forEach(button => button.classList.remove('chosen', 'wrong'));
  }
  const wireProgress = 1 - ((now - state.startAt) % HIT_WINDOW_MS) / HIT_WINDOW_MS;
  ui.target.style.setProperty('--wire-progress', `${wireProgress * 100}%`);
  state.raf = requestAnimationFrame(renderFrame);
}

function expectedWire(targetId) {
  const value = Math.sin((targetId + 1) * 127.1 + 19.19) * 43758.5453;
  return Math.floor((value - Math.floor(value)) * WIRE_NAMES.length);
}

function moveTarget(targetId) {
  const positions = [
    [50, 39], [34, 35], [65, 43], [62, 32],
    [39, 45], [50, 31], [68, 37], [32, 42],
  ];
  const [x, y] = positions[targetId % positions.length];
  ui.targetWrap.style.left = `${x}%`;
  ui.targetWrap.style.top = `${y}%`;
}

function chooseWire(wire) {
  if (state.phase !== 'playing' || Date.now() < state.startAt) return;
  const targetId = Math.floor((Date.now() - state.startAt) / HIT_WINDOW_MS);
  if (targetId !== state.currentTarget || state.localAttemptedTarget === targetId) return;
  state.localAttemptedTarget = targetId;
  const correct = wire === expectedWire(targetId);
  ui.wireButtons[wire]?.classList.add(correct ? 'chosen' : 'wrong');
  ui.target.classList.remove('hit', 'miss');
  ui.target.classList.add(correct ? 'hit' : 'miss');
  if (correct) {
    state.localStreak = state.localStreakTarget === targetId - 1 && state.localStreak > 0
      ? state.localStreak + 1 : 1;
    state.localStreakTarget = targetId;
    showStreak(state.localStreak);
  } else {
    state.localStreak = 0;
    state.localStreakTarget = targetId;
  }
  if (state.isHost) {
    processChoice(state.me.id, targetId, wire);
  } else {
    sendEvent('BR_CHOICE', { userId: state.me.id, targetId, wire, player: state.me });
  }
}

function processChoice(playerId, targetId, wire) {
  if (!playerId || !Number.isFinite(targetId) || targetId !== state.currentTarget) return;
  const player = state.players.get(String(playerId));
  if (!player) return;
  if (state.attemptedTargets.get(player.id) === targetId) return;
  state.attemptedTargets.set(player.id, targetId);
  if (wire !== expectedWire(targetId)) {
    state.playerStreaks.set(player.id, { count: 0, targetId });
    return;
  }
  const previous = state.playerStreaks.get(player.id);
  const count = previous?.targetId === targetId - 1 ? previous.count + 1 : 1;
  state.playerStreaks.set(player.id, { count, targetId });
  player.score += count % 5 === 0 ? 3 : 1;
  if (player.id === state.me.id) showStreak(count);
  renderScores();
  sendEvent('BR_SCORE', { scores: [...state.players.values()].map(({ id, score }) => ({ id, score })) });
}

function applyScores(scores) {
  if (!Array.isArray(scores)) return;
  scores.forEach(({ id, score }) => {
    const player = state.players.get(String(id));
    if (player && Number.isFinite(Number(score))) player.score = Math.max(player.score, Number(score));
  });
  renderScores();
}

function renderScores() {
  const players = [...state.players.values()].sort((a, b) => b.score - a.score || a.username.localeCompare(b.username));
  ui.playerCount.textContent = String(Math.max(1, Math.min(10, state.players.size)));
  ui.scoreList.replaceChildren();
  players.forEach((player, index) => {
    const row = document.createElement('div');
    row.className = `score-row${player.id === state.me.id ? ' me' : ''}`;
    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = String(index + 1).padStart(2, '0');
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    if (player.avatar) {
      const image = document.createElement('img');
      image.src = player.avatar;
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      image.onerror = () => { image.remove(); avatar.textContent = player.username.slice(0, 1); };
      avatar.append(image);
    } else {
      avatar.textContent = player.username.slice(0, 1);
    }
    const name = document.createElement('span');
    name.className = 'player-name';
    name.textContent = player.id === state.me.id ? '你' : player.username;
    const points = document.createElement('span');
    points.className = 'points';
    points.textContent = String(player.score).padStart(2, '0');
    row.append(rank, avatar, name, points);
    ui.scoreList.append(row);
  });
}

function showStreak(count) {
  ui.streak.textContent = count % 5 === 0 ? `${count} 連擊  +3` : count > 1 ? `${count} 連擊` : '+1';
  ui.streak.classList.remove('show');
  void ui.streak.offsetWidth;
  ui.streak.classList.add('show');
  window.setTimeout(() => ui.streak.classList.remove('show'), 500);
}

function finishRound(notifyOthers) {
  if (state.phase === 'results' || state.finished) return;
  state.phase = 'results';
  state.finished = true;
  cancelAnimationFrame(state.raf);
  clearTimeout(state.fallbackTimer);
  ui.wireButtons.forEach(button => { button.disabled = true; });
  ui.phaseLabel.textContent = '結算完成';
  ui.headline.textContent = '引線已拆除';
  ui.arenaStatus.textContent = '本局結束';
  ui.arenaStatus.parentElement.classList.remove('active');
  ui.timer.innerHTML = `0<span>s</span>`;

  const ranking = [...state.players.values()].sort((a, b) => b.score - a.score || a.username.localeCompare(b.username));
  if (state.isHost && notifyOthers) {
    const scores = ranking.map(({ id, score }) => ({ id, score }));
    sendEvent('BR_SCORE', { scores });
    sendEvent('BR_RESULT', { scores });
  }
  const best = ranking[0];
  const winners = ranking.filter(player => best && player.score === best.score);
  const isWinner = !!best && best.score > 0 && winners.some(player => player.id === state.me.id);
  const prize = isWinner && best && best.score > 0 ? 100 : 0;

  ui.resultTitle.textContent = isWinner ? '你是拆彈高手！' : (best?.username || '本局結束');
  ui.resultSummary.textContent = `全場拆除 ${ranking.reduce((sum, player) => sum + player.score, 0)} 顆炸彈`;
  ui.resultWinner.replaceChildren();
  if (prize) {
    ui.resultWinner.append(document.createTextNode('🏆 你獲得 100 銀幣'));
  } else if (best && best.score > 0) {
    ui.resultWinner.append(document.createTextNode(`🏆 ${best.username} 獲得 100 銀幣`));
  } else {
    ui.resultWinner.append(document.createTextNode('本局平手'));
  }
  if (winners.length > 1 && best?.score > 0) {
    const tied = document.createElement('span');
    tied.className = 'winner-sub';
    tied.textContent = `${winners.length} 位玩家並列第一，各獲得 100 銀幣`;
    ui.resultWinner.append(tied);
  }
  ui.resultScreen.hidden = false;

  if (typeof sdk?.gameOver === 'function') {
    try {
      sdk.gameOver(prize);
    } catch (error) {
      console.warn('BoomRoom 結算失敗', error);
    }
  }
  state.returnTimer = window.setTimeout(returnToRoom, RETURN_DELAY_MS);
}

function returnToRoom() {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ action: 'leaveGame' }, '*');
  } else {
    window.location.href = '../room.html';
  }
}

ui.wireButtons.forEach(button => {
  button.addEventListener('click', () => chooseWire(Number(button.dataset.wire)));
});
window.addEventListener('keydown', event => {
  if (event.repeat || !['1', '2', '3'].includes(event.key)) return;
  chooseWire(Number(event.key) - 1);
});
setupSdk();
