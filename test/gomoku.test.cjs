const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../30/app.js'), 'utf8');

// Run the actual game source in independent player documents. Drawing/audio
// are stubbed; these tests cover room role and result state, not rendering,
// server authorization, network timing or real multiplayer transport.
function player(id, roster, formalSession = null) {
  const elements = new Map();
  const canvasContext = new Proxy({}, {
    get: (_, key) => key === 'createRadialGradient'
      ? () => ({ addColorStop() {} }) : () => {},
    set: () => true,
  });
  const container = { getBoundingClientRect: () => ({ width: 600, height: 620 }) };
  function element() {
    const listeners = new Map();
    const item = {
      textContent: '', children: [], style: {}, disabled: false,
      classList: { add() {}, remove() {}, toggle() {} },
      clientWidth: 580, clientHeight: 580, parentElement: container,
      addEventListener: (name, callback) => listeners.set(name, callback),
      click: () => listeners.get('click')?.({ clientX: 290, clientY: 290 }),
      appendChild: child => item.children.push(child),
      remove() {}, getContext: () => canvasContext,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 580, height: 580 }),
    };
    Object.defineProperty(item, 'innerHTML', { set() { item.children = []; } });
    return item;
  }
  const get = name => {
    if (!elements.has(name)) elements.set(name, element());
    return elements.get(name);
  };
  const sent = [];
  const timers = [];
  let formalListener = null;
  const window = {
    devicePixelRatio: 1, addEventListener() {},
    crypto: globalThis.crypto,
    BoomRoomSDK: { sendGameEvent: (name, payload) => { sent.push({ name, payload }); return true; },
      ...(formalSession ? { version: 2, isReady: false, getSession: () => formalSession,
        onGameEvent: callback => { formalListener = callback; return () => {}; } } : {}) },
  };
  window.parent = window;
  const context = vm.createContext({
    window, console, performance,
    document: { getElementById: get, querySelector: get, createElement: element,
      body: { appendChild() {} } },
    getComputedStyle: () => ({ paddingLeft: '10', paddingRight: '10', paddingTop: '10', paddingBottom: '10' }),
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimeout() {}, setInterval() {}, clearInterval() {},
  });
  vm.runInContext(source, context);
  if (formalSession) window.BoomRoomSDK.isReady = true;
  window.initBoomRoomSDK({ user: { id, username: `player-${id}` }, isHost: id === '1',
    roomId: 'test-room', roomPlayers: roster });
  // Complete the scheduled opening through its real public SDK path.
  if (!formalSession) {
    const start = timers.find(timer => timer.delay === 500);
    assert.ok(start); start.callback();
  }
  return { window, get, sent, receive: (name, payload, sender) =>
    formalSession ? formalListener(name, payload, sender) : window.handleGameEvent(name, payload, sender) };
}

const roster = ['1', '2', '3'].map(id => ({ id, username: `player-${id}` }));

test('one local player appears once when SDK roster contains a separate object', () => {
  const local = player('1', [roster[0]]);
  assert.deepEqual(local.get('rosterList').children.map(child => child.textContent),
    ['player-1 (黑子)', '🤖 智勝 AI (白子)']);
});

test('spectator controls cannot resign, undo or restart a room match', () => {
  const observer = player('3', roster);
  for (const control of ['btnResign', 'btnUndo', 'btnRestart']) {
    assert.equal(observer.get(control).disabled, true);
    observer.get(control).click();
  }
  assert.deepEqual(observer.sent, []);
  assert.equal(observer.get('resultTitle').textContent, '');
});

test('white resigning awards black on both opponent and spectator clients', () => {
  const opponent = player('1', roster);
  const observer = player('3', roster);
  for (const client of [opponent, observer]) {
    client.receive('GOMOKU_RESIGN', { senderId: '2' }, 2);
    assert.match(client.get('resultSubtitle').textContent, /player-1 1 : 0 player-2/);
    assert.match(client.get('resultTitle').textContent, /player-1/);
  }
});

test('a spectator or mismatched sender cannot award a resignation result', () => {
  const opponent = player('1', roster);
  opponent.receive('GOMOKU_RESIGN', { senderId: '3' }, 3);
  opponent.receive('GOMOKU_RESIGN', { senderId: '2' }, 3);
  assert.equal(opponent.get('resultTitle').textContent, '');
});

function formalGame() {
  return { engine: 'GOMOKU', version: 1, startTime: 0, serverTime: 10000, resultVerified: false,
    players: roster.map(p => ({ userId: Number(p.id), username: p.username })),
    engineState: { rulesVersion: 1, round: 1, phase: 'PLAYING', blackId: 1, whiteId: 2,
      board: Array.from({ length: 15 }, () => Array(15).fill(0)), moves: [], turn: 1,
      scores: { 1: 0, 2: 0 }, winnerColor: 0, winnerId: null, winningStones: [], pending: null } };
}
test('formal board waits for canonical server state and cannot locally award moves or resignations', () => {
  const session = formalGame();
  const black = player('1', roster, session);
  assert.equal(black.get('moveCount').textContent, '第 0 步');
  black.get('boardCanvas').click();
  assert.equal(black.sent.at(-1).name, 'GOMOKU_COMMAND');
  assert.equal(black.sent.at(-1).payload.kind, 'MOVE');
  assert.equal(black.sent.at(-1).payload.expectedVersion, 1);
  assert.equal(black.get('moveCount').textContent, '第 0 步');
  black.receive('GOMOKU_MOVE', { row: 7, col: 7, stoneColor: 1, userId: '1' }, 1);
  const state = structuredClone(session.engineState);
  state.board[7][7] = 1; state.moves = [[7, 7, 1]]; state.turn = 2;
  const packet = { state, version: 2, startTime: 0, serverTime: 11000 };
  black.receive('GOMOKU_STATE', packet, 2);
  assert.equal(black.get('moveCount').textContent, '第 0 步');
  black.receive('GOMOKU_STATE', packet, 'SYSTEM');
  assert.equal(black.get('moveCount').textContent, '第 1 步');
  black.get('btnResign').click();
  assert.equal(black.sent.at(-1).payload.kind, 'RESIGN');
  assert.equal(black.get('resultTitle').textContent, '');
  black.receive('GOMOKU_STATE', { ...packet, version: 1, state: session.engineState }, 'SYSTEM');
  assert.equal(black.get('moveCount').textContent, '第 1 步');
});
test('formal results are identical for players and spectators without client gameOver awards', () => {
  const session = formalGame();
  const clients = ['1', '2', '3'].map(id => player(id, roster, session));
  const state = { ...session.engineState, phase: 'MATCH_RESULT', winnerColor: 1, winnerId: 1,
    scores: { 1: 3, 2: 0 }, returnAt: 15000 };
  for (const client of clients) {
    client.receive('GOMOKU_STATE', { state, version: 5, startTime: 0, serverTime: 10000, resultVerified: true }, 'SYSTEM');
    assert.match(client.get('resultTitle').textContent, /player-1/);
    assert.match(client.get('resultReward').textContent, /已由伺服器驗證/);
    assert.ok(client.sent.every(event => event.name === 'GOMOKU_COMMAND'));
  }
  const spectator = clients[2]; const count = spectator.sent.length;
  for (const name of ['btnUndo', 'btnResign', 'btnRestart']) spectator.get(name).click();
  assert.equal(spectator.sent.length, count);
});
