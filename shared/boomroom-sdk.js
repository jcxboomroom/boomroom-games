/* BoomRoom SDK v2. No local players, purchases or rewards are fabricated.
 * Games must wait for onBoomRoomSDKReady/onSessionStart before playing.
 * This SDK transports intents; only the authenticated server can award coins.
 */
(function (root) {
  'use strict';
  if (root.BoomRoomSDK && root.BoomRoomSDK.version === 2) return;
  const previous = root.BoomRoomSDK;
  const legacyCallbacks = root.document?.currentScript?.getAttribute('data-legacy-callbacks') === 'true';
  let native = !!previous && root.parent === root;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const hooks = new Map(), pendingPurchases = new Map();
  let data = null, closed = false, parentOrigin = null, timeAtReceive = 0, requestSequence = 0;
  const monotonic = () => root.performance ? root.performance.now() : Date.now();
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  function httpOrigin(value) {
    try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.origin : null; }
    catch (_) { return null; }
  }
  parentOrigin = httpOrigin(root.document && root.document.referrer);
  function notify(name, ...args) {
    for (const callback of [...(hooks.get(name) || [])]) {
      try { callback(...args.map(copy)); }
      catch (error) { root.console.error('BoomRoom SDK callback failed:', error); }
    }
  }
  function failure(code) { notify('error', { code }); return false; }
  function subscribe(name, callback) {
    if (typeof callback !== 'function' || closed) return () => {};
    if (!hooks.has(name)) hooks.set(name, new Set());
    hooks.get(name).add(callback);
    return () => hooks.get(name)?.delete(callback);
  }
  function players(value) {
    if (!Array.isArray(value)) return null;
    const ids = new Set();
    const list = [];
    for (const player of value) {
      const id = Number(player && (player.id ?? player.userId));
      if (!Number.isSafeInteger(id) || id <= 0 || ids.has(id)) return null;
      ids.add(id); list.push(copy(player));
    }
    return list.length <= 10 ? list : null;
  }
  function updatePlayers(list, announce) {
    const incoming = players(list);
    if (!incoming || !data) return failure('ROSTER_INVALID');
    const key = player => String(player.id ?? player.userId);
    const before = new Map(data.roomPlayers.map(player => [key(player), player]));
    const after = new Map(incoming.map(player => [key(player), player]));
    data.roomPlayers = incoming;
    if (announce) {
      for (const [id, player] of before) if (!after.has(id)) notify('playerLeave', player);
      for (const [id, player] of after) if (!before.has(id)) notify('playerJoin', player);
    }
    return true;
  }
  function initialize(packet) {
    if (closed || !packet || typeof packet !== 'object') return false;
    const session = packet.session;
    const id = packet.gameSessionId || packet.sessionId || session?.sessionId;
    const roomId = String(packet.roomId || session?.roomId || '');
    const userId = Number(packet.user?.id);
    const roster = players(packet.roomPlayers || []);
    const participants = players(session?.players);
    if (!uuid.test(id || '') || !session || session.sessionId !== id || String(session.roomId) !== roomId ||
        !roomId || !Number.isSafeInteger(userId) || userId <= 0 || !roster || !participants?.length ||
        !participants.some(player => Number(player.id ?? player.userId) === userId) ||
        !Number.isFinite(Number(session.serverTime)) || !Number.isSafeInteger(session.version) || session.version < 1 ||
        !['PLAYING', 'ENDED', 'ABORTED'].includes(session.status)) return failure('SESSION_INVALID');
    if (data && data.gameSessionId !== id) return failure('SESSION_MISMATCH');
    if (data && Number(session.version) < Number(data.session.version)) return failure('SESSION_STALE');
    const first = !data;
    const beforeStatus = data?.session.status;
    const beforePlayers = data?.roomPlayers || [];
    data = { user: copy(packet.user), roomId, gameSessionId: id, session: copy(session),
      isHost: !!packet.isHost, roomPlayers: beforePlayers };
    timeAtReceive = monotonic();
    updatePlayers(roster, !first);
    if (first && typeof root.onBoomRoomSDKReady === 'function') {
      try { root.onBoomRoomSDKReady(); }
      catch (error) { root.console.error('BoomRoom SDK ready callback failed:', error); }
    }
    if (first || beforeStatus !== session.status) {
      if (session.status === 'PLAYING') notify('sessionStart', session);
      else if (session.status === 'ENDED' || session.status === 'ABORTED') notify('sessionEnd', session);
    }
    return true;
  }
  function send(action, fields) {
    if (!data || closed || data.session.status !== 'PLAYING') return failure('SESSION_UNAVAILABLE');
    const packet = { ...fields, action, roomId: data.roomId, gameSessionId: data.gameSessionId };
    try {
      if (native && root.chrome?.webview?.postMessage) {
        if (action === 'gameOver') packet.action = 'game_over';
        root.chrome.webview.postMessage(JSON.stringify(packet));
      } else if (native && root.BoomRoomJS?.postMessage) {
        if (action === 'gameOver') packet.action = 'game_over';
        root.BoomRoomJS.postMessage(JSON.stringify(packet));
      } else if (native && previous && typeof previous[action] === 'function') {
        if (action === 'sendGameEvent') previous.sendGameEvent(fields.eventName, fields.payload);
        else if (action === 'requestPurchase') previous.requestPurchase(fields.itemId, fields.cost);
        else if (action === 'requestAdmission') previous.requestAdmission(fields.itemId);
        else if (action === 'gameOver') previous.gameOver(fields.winAmount, fields.score, fields.poolSettlement);
        else return failure('TRANSPORT_UNAVAILABLE');
      } else if (root.parent !== root && parentOrigin) {
        if (action === 'gameOver') packet.action = 'game_over';
        root.parent.postMessage(JSON.stringify(packet), parentOrigin);
      } else return failure('TRANSPORT_UNAVAILABLE');
      return true;
    } catch (_) { return failure('TRANSPORT_UNAVAILABLE'); }
  }
  function receive(event) {
    if (closed) return;
    if (!native) {
      if (root.parent === root || event.source !== root.parent || !httpOrigin(event.origin)) return;
      if (parentOrigin && event.origin !== parentOrigin) return;
    } else if (event.source !== root && event.source != null) return;
    let packet;
    try { packet = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; }
    catch (_) { return; }
    if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return;
    if (!native && !parentOrigin) {
      if (packet.action !== 'initSDK') return;
      parentOrigin = event.origin;
    }
    if (packet.action === 'initSDK') return initialize(packet);
    if (!data || packet.gameSessionId && packet.gameSessionId !== data.gameSessionId ||
        packet.roomId && String(packet.roomId) !== data.roomId) return;
    if (packet.action === 'roomPlayersUpdated') updatePlayers(packet.roomPlayers, true);
    if (packet.action === 'gameEventReceived') {
      // Existing native adapters are scoped by the app's current game page and
      // may synthesize the old envelope without a session field.
      if (packet.gameSessionId !== data.gameSessionId && !(native && !packet.gameSessionId) ||
          typeof packet.eventName !== 'string') return;
      if (packet.eventName === 'GOMOKU_STATE' && packet.userId === 'SYSTEM' && packet.payload?.session) {
        // Only the reserved server envelope refreshes canonical session data.
        // Peer payloads are still untrusted and cannot update the SDK session.
        if (!initialize({ ...data, session: packet.payload.session })) return;
      }
      notify('gameEvent', packet.eventName, packet.payload, packet.userId);
    }
    if (packet.action === 'purchaseSuccess' || packet.action === 'purchaseFailed') {
      if (!pendingPurchases.has(packet.itemId)) return;
      const pending = pendingPurchases.get(packet.itemId);
      if (packet.requestId !== pending.requestId) return;
      root.clearTimeout(pending.timer); pendingPurchases.delete(packet.itemId);
      notify(packet.action, packet.itemId, packet.silverCoins);
      if (legacyCallbacks) {
        const callback = packet.action === 'purchaseSuccess' ? root.onPurchaseSuccess : root.onPurchaseFailed;
        if (typeof callback === 'function') {
          try { callback(packet.itemId, packet.silverCoins); }
          catch (error) { root.console.error('BoomRoom admission callback failed:', error); }
        }
      }
    }
    if (packet.action === 'sessionEnd' && packet.session?.sessionId === data.gameSessionId &&
        ['ENDED', 'ABORTED'].includes(packet.session.status) && packet.session.version >= data.session.version) {
      const alreadyEnded = ['ENDED', 'ABORTED'].includes(data.session.status);
      data.session = copy(packet.session);
      for (const pending of pendingPurchases.values()) root.clearTimeout(pending.timer);
      pendingPurchases.clear();
      if (!alreadyEnded) notify('sessionEnd', data.session);
    }
  }
  const sdk = {
    version: 2,
    get isReady() { return !!data && !closed; },
    get roomId() { return data?.roomId || ''; },
    get isHost() { return data?.isHost || false; },
    get sessionId() { return data?.gameSessionId || ''; },
    get gameSessionId() { return data?.gameSessionId || ''; },
    get roomPlayers() { return copy(data?.roomPlayers || []); },
    getUser: () => copy(data?.user || null),
    getRoomPlayers: () => copy(data?.roomPlayers || []),
    getSession: () => copy(data?.session || null),
    getServerTime: () => data ? Number(data.session.serverTime) + monotonic() - timeAtReceive : null,
    sendGameEvent(eventName, payload) {
      if (typeof eventName !== 'string' || !eventName.trim() || eventName.length > 128) return failure('EVENT_INVALID');
      return send('sendGameEvent', { eventName, payload });
    },
    requestPurchase(itemId, cost) {
      if (typeof itemId !== 'string' || !itemId || itemId.length > 128 || !Number.isSafeInteger(cost) || cost <= 0) return failure('PURCHASE_INVALID');
      if (pendingPurchases.has(itemId)) return failure('PURCHASE_PENDING');
      if (pendingPurchases.size >= 16) return failure('PURCHASE_RATE_LIMITED');
      const requestId = data ? data.gameSessionId + ':' + (++requestSequence) : '';
      const timer = root.setTimeout(() => {
        if (pendingPurchases.get(itemId)?.requestId !== requestId) return;
        pendingPurchases.delete(itemId);
        notify('purchaseFailed', itemId, null);
        failure('PURCHASE_TIMEOUT');
      }, 10000);
      pendingPurchases.set(itemId, { timer, requestId });
      const sent = send('requestPurchase', { itemId, cost, requestId });
      if (!sent) { root.clearTimeout(timer); pendingPurchases.delete(itemId); }
      return sent;
    },
    requestAdmission(itemId) {
      if (typeof itemId !== 'string' || !itemId || itemId.length > 128) return failure('ADMISSION_INVALID');
      if (pendingPurchases.has(itemId)) return failure('PURCHASE_PENDING');
      if (pendingPurchases.size >= 16) return failure('PURCHASE_RATE_LIMITED');
      const requestId = data ? data.gameSessionId + ':' + (++requestSequence) : '';
      const timer = root.setTimeout(() => {
        if (pendingPurchases.get(itemId)?.requestId !== requestId) return;
        pendingPurchases.delete(itemId); notify('purchaseFailed', itemId, null); failure('ADMISSION_TIMEOUT');
      }, 10000);
      pendingPurchases.set(itemId, { timer, requestId });
      const sent = send('requestAdmission', { itemId, requestId });
      if (!sent) { root.clearTimeout(timer); pendingPurchases.delete(itemId); }
      return sent;
    },
    gameOver(winAmount = 0, score = null, poolSettlement = null) {
      return send('gameOver', { winAmount, score, poolSettlement });
    },
    // A replayable round keeps the canonical room session open. These local
    // challenge scores never request settlement or claim wallet rewards.
    completeRound(score = 0) {
      if(!Number.isFinite(score)||score<0)return failure('SCORE_INVALID');
      return send('roundComplete',{score});
    },
    leaveGame() { return send('leaveGame',{}); },
    onGameEvent: callback => subscribe('gameEvent', callback),
    onPurchaseSuccess: callback => subscribe('purchaseSuccess', callback),
    onPurchaseFailed: callback => subscribe('purchaseFailed', callback),
    onPlayerJoin: callback => subscribe('playerJoin', callback),
    onPlayerLeave: callback => subscribe('playerLeave', callback),
    onSessionStart(callback) {
      const unsubscribe = subscribe('sessionStart', callback);
      if (data?.session.status === 'PLAYING') root.queueMicrotask(() => {
        if (!closed && data?.session.status === 'PLAYING' && hooks.get('sessionStart')?.has(callback)) {
          try { callback(copy(data.session)); }
          catch (error) { root.console.error('BoomRoom SDK callback failed:', error); }
        }
      });
      return unsubscribe;
    },
    onSessionEnd: callback => subscribe('sessionEnd', callback),
    onError: callback => subscribe('error', callback),
    submitScore: () => failure('SCORE_SUBMISSION_UNSUPPORTED'),
    requestSettlement: () => failure('SETTLEMENT_REQUEST_UNSUPPORTED'),
    dispose() {
      if (closed) return;
      closed = true; hooks.clear();
      for (const pending of pendingPurchases.values()) root.clearTimeout(pending.timer);
      pendingPurchases.clear(); data = null;
      root.removeEventListener('message', receive);
      root.removeEventListener('pagehide', pageHidden);
      if (root.__BoomRoomSDKInitializeHost === initializeHost) delete root.__BoomRoomSDKInitializeHost;
    },
  };
  function initializeHost(packet) {
    // Only native app adapters call this direct hook. Browser frames initialize
    // through the parent-origin/source-checked message channel above.
    if (root.parent !== root) return false;
    native = true;
    return initialize(packet);
  }
  function pageHidden(event) { if (!event.persisted) sdk.dispose(); }
  root.BoomRoomSDK = sdk;
  root.__BoomRoomSDKInitializeHost = initializeHost;
  root.addEventListener('message', receive);
  root.addEventListener('pagehide', pageHidden);
  if (native && typeof previous.getSession === 'function') {
    const session = previous.getSession();
    initialize({ user: previous.getUser(), roomId: previous.roomId, isHost: previous.isHost,
      gameSessionId: previous.gameSessionId, session, roomPlayers: previous.roomPlayers || [] });
  }
})(window);
