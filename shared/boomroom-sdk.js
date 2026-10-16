/* BoomRoom SDK v2 / additive API revision 10.
 * No local players, purchases or rewards are fabricated.
 * Games must wait for onBoomRoomSDKReady/onSessionStart before playing.
 * This SDK transports intents; only the authenticated server can award coins.
 */
(function (root) {
  'use strict';
  if (root.BoomRoomSDK && root.BoomRoomSDK.version === 2 && root.BoomRoomSDK.apiRevision >= 10) return;
  const previous = root.BoomRoomSDK;
  const legacyCallbacks = root.document?.currentScript?.getAttribute('data-legacy-callbacks') === 'true';
  let native = !!previous && root.parent === root;
  const previousVoice=root.receiveVoiceText;
  function nativeVoice(text,isFinal,sessionId){if(native&&data&&!closed&&!data.isSpectator&&typeof text==='string'&&Number.isSafeInteger(sessionId))notify('speechResult',text.slice(0,120),Boolean(isFinal),sessionId);}
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const reservedEvents = new Set(['GOMOKU_STATE','GOMOKU_ERROR','BLUFF_PUBLIC','BLUFF_PRIVATE','BLUFF_ERROR','TETRIS_PRIVATE','TETRIS_ERROR','TETRIS_STATE','TETRIS_QUEUED','TETRIS_SPECTATOR','GAME_SPECTATOR','WAGER_STATE','BOOMGOLD_STATE','STACK_STATE','ARENA_STATE','GAME_ACTION_ERROR']);
  const hooks = new Map(), pendingPurchases = new Map();
  let data = null, closed = false, parentOrigin = null, timeAtReceive = 0, requestSequence = 0, lastHapticAt = -Infinity;
  let hostUi = null, lastWagerCommand = null;
  const uiScriptUrl = root.document?.currentScript?.src;
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
  function lifecycleState() {
    if (closed) return 'DISPOSED';
    return data ? data.session.status : 'WAITING_FOR_SESSION';
  }
  function commandUuid() {
    try {
      if (typeof root.crypto?.randomUUID === 'function') return root.crypto.randomUUID();
      if (typeof root.crypto?.getRandomValues !== 'function') return null;
      const bytes = new Uint8Array(16);
      root.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    } catch (_) { return null; }
  }
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
    const previousPlayers = data.roomPlayers;
    data.roomPlayers = incoming;
    if (announce) {
      const left = [...before].filter(([id]) => !after.has(id)).map(([, player]) => player);
      const joined = [...after].filter(([id]) => !before.has(id)).map(([, player]) => player);
      for (const player of left) notify('playerLeave', player);
      for (const player of joined) notify('playerJoin', player);
      if (JSON.stringify(previousPlayers) !== JSON.stringify(incoming)) {
        notify('roomPlayersChange', { players: incoming, joined, left });
      }
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
    const isSpectator = packet.isSpectator === true && session?.spectatorSupported === true && session?.viewerRole === 'spectator';
    if (!uuid.test(id || '') || !session || session.sessionId !== id || String(session.roomId) !== roomId ||
        !roomId || !Number.isSafeInteger(userId) || userId <= 0 || !roster || !participants?.length ||
        (!isSpectator && !participants.some(player => Number(player.id ?? player.userId) === userId)) ||
        !Number.isFinite(Number(session.serverTime)) || !Number.isSafeInteger(session.version) || session.version < 1 ||
        !['PLAYING', 'ENDED', 'ABORTED'].includes(session.status)) return failure('SESSION_INVALID');
    if (data && data.gameSessionId !== id) return failure('SESSION_MISMATCH');
    if (data && data.isSpectator !== isSpectator) return failure('SESSION_ROLE_MISMATCH');
    if (data && Number(session.version) < Number(data.session.version)) return failure('SESSION_STALE');
    const first = !data;
    const previousSession = data ? copy(data.session) : null;
    const beforeStatus = previousSession?.status;
    const beforePlayers = data?.roomPlayers || [];
    data = { user: copy(packet.user), roomId, gameSessionId: id, session: copy(session),
      isHost: !isSpectator && !!packet.isHost, isSpectator, roomPlayers: beforePlayers };
    timeAtReceive = monotonic();
    if (packet.hostUi) acceptHostUi(packet.hostUi);
    updatePlayers(roster, !first);
    if (first) {
      notify('ready', data.session);
      notify('statusChange', lifecycleState(), null);
      if (typeof root.onBoomRoomSDKReady === 'function') {
        try { root.onBoomRoomSDKReady(); }
        catch (error) { root.console.error('BoomRoom SDK ready callback failed:', error); }
      }
    } else if (Number(session.version) > Number(previousSession.version)) {
      notify('sessionUpdate', data.session, previousSession);
      if (beforeStatus !== session.status) notify('statusChange', lifecycleState(), beforeStatus);
    }
    if (first || beforeStatus !== session.status) {
      if (session.status === 'PLAYING') notify('sessionStart', session);
      else if (session.status === 'ENDED' || session.status === 'ABORTED') notify('sessionEnd', session);
    }
    return true;
  }
  function acceptHostUi(state) {
    if (!data || !state || state.protocol !== 1 || !Number.isSafeInteger(state.version) ||
        state.version < 1 || (hostUi && state.version < hostUi.version)) return false;
    hostUi = copy(state);
    if (Number.isSafeInteger(state.silverCoins) && state.silverCoins >= 0) data.user.silverCoins = state.silverCoins;
    notify('hostUiChange', hostUi);
    return true;
  }
  function send(action, fields) {
    if (!data || closed || data.session.status !== 'PLAYING') return failure('SESSION_UNAVAILABLE');
    if (data.isSpectator && !['gameUi','leaveGame','haptic'].includes(action)) return failure('SPECTATOR_READ_ONLY');
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
        else if (action === 'haptic') previous.haptic(fields.style);
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
    if (packet.action === 'hostUiState' && packet.gameSessionId === data.gameSessionId &&
        String(packet.roomId) === data.roomId) acceptHostUi(packet.state);
    if (packet.action === 'roomPlayersUpdated') updatePlayers(packet.roomPlayers, true);
    if(packet.action==='flutterSpeechResult'&&!data.isSpectator&&typeof packet.text==='string'&&Number.isSafeInteger(packet.sessionId))notify('speechResult',packet.text.slice(0,120),Boolean(packet.isFinal),packet.sessionId);
    if (packet.action === 'gameEventReceived') {
      // Existing native adapters are scoped by the app's current game page and
      // may synthesize the old envelope without a session field.
      if (packet.gameSessionId !== data.gameSessionId && !(native && !packet.gameSessionId) ||
          typeof packet.eventName !== 'string') return;
      if (data.isSpectator && (!['TETRIS_SPECTATOR','GAME_SPECTATOR'].includes(packet.eventName) || packet.userId !== 'SYSTEM')) return;
      if (['TETRIS_SPECTATOR','GAME_SPECTATOR'].includes(packet.eventName)) {
        if (!data.isSpectator || packet.userId !== 'SYSTEM' || !packet.payload?.session ||
            !initialize({ ...data, session: packet.payload.session })) return;
      }
      if (['WAGER_STATE','BOOMGOLD_STATE','STACK_STATE','ARENA_STATE'].includes(packet.eventName)) {
        if(packet.userId!=='SYSTEM'||String(packet.payload?.userId)!==String(data.user.id)||!packet.payload?.session||
          !initialize({...data,session:packet.payload.session}))return;
      }
      if (packet.eventName === 'GOMOKU_STATE' && packet.userId === 'SYSTEM' && packet.payload?.session) {
        // Only the reserved server envelope refreshes canonical session data.
        // Peer payloads are still untrusted and cannot update the SDK session.
        if (!initialize({ ...data, session: packet.payload.session })) return;
      }
      if ((packet.eventName === 'BLUFF_PRIVATE' || packet.eventName === 'TETRIS_PRIVATE') && packet.userId === 'SYSTEM' && packet.payload?.session) {
        if (packet.eventName === 'TETRIS_PRIVATE' && String(packet.payload.userId) !== String(data.user.id)) return;
        // The authenticated app forwards this reserved event only to its seat.
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
      const previousSession = copy(data.session);
      data.session = copy(packet.session);
      if (Number(data.session.version) > Number(previousSession.version)) notify('sessionUpdate', data.session, previousSession);
      if (data.session.status !== previousSession.status) notify('statusChange', lifecycleState(), previousSession.status);
      for (const pending of pendingPurchases.values()) root.clearTimeout(pending.timer);
      pendingPurchases.clear();
      if (!alreadyEnded) notify('sessionEnd', data.session);
    }
  }
  const sdk = {
    version: 2,
    apiRevision: 10,
    get isReady() { return !!data && !closed; },
    get roomId() { return data?.roomId || ''; },
    get isHost() { return data?.isHost || false; },
    get isSpectator() { return data?.isSpectator || false; },
    get sessionId() { return data?.gameSessionId || ''; },
    get gameSessionId() { return data?.gameSessionId || ''; },
    get status() { return lifecycleState(); },
    get roomPlayers() { return copy(data?.roomPlayers || []); },
    getUser: () => copy(data?.user || null),
    getRoomPlayers: () => copy(data?.roomPlayers || []),
    getAiSeats: () => copy(data?.session?.aiSeats || []),
    getSeats: () => copy([...(data?.session?.players||[]).map(p=>({...p,seatIndex:p.seatIndex??null,kind:'human'})),...(data?.session?.aiSeats||[]).map(p=>({...p,kind:'ai'}))]),
    getOfficialRules: () => copy({rankingRule:data?.session?.wager?.rankingRule||null,distribution:data?.session?.wager?.distribution||null,tournament:data?.session?.engineState?.tournament?{rules:data.session.engineState.tournament.rules,rounds:data.session.engineState.tournament.rounds,byes:data.session.engineState.tournament.byes}:null}),
    getAuthoritativeRankings: () => copy(data?.session?.resultVerified?data.session.results?.rankings||[]:[]),
    getSpectatorTargets: () => copy(data?.session?.engineState?.tournament?.tables?.map(t=>({id:t.id,version:t.version,round:t.round,blackId:t.blackId,whiteId:t.whiteId,finished:t.scored}))||data?.session?.engineState?.members?.map(p=>({id:p.id,name:p.name,finished:p.alive===false}))||[]),
    getSession: () => copy(data?.session || null),
    requestSpeech(kind,sessionId){if(!['START','STOP'].includes(kind)||!Number.isSafeInteger(sessionId)||sessionId<1)return failure('SPEECH_INVALID');return send(kind==='START'?'startVoiceRecognition':'stopVoiceRecognition',{sessionId});},
    onSpeechResult:callback=>subscribe('speechResult',callback),
    getHostUiState: () => copy(hostUi),
    onHostUiChange(callback) {
      const off = subscribe('hostUiChange', callback);
      if (hostUi && !closed) root.queueMicrotask(() => { if (hooks.get('hostUiChange')?.has(callback)) callback(copy(hostUi)); });
      return off;
    },
    requestGameUi(kind, fields = {}) {
      if (!hostUi || !['READY','MUTE','VOLUME','HAPTIC','MIC','PEER_AUDIO','LEAVE','SYNC','WAGER'].includes(kind)) return failure('UI_ACTION_INVALID');
      return send('gameUi', { ...fields, kind });
    },
    configureGameUi(options) { return root.BoomRoomGameUI?.configure(options) || false; },
    whenGameUiReady: () => uiReady,
    getWagerState: () => copy(data?.session?.wager || null),
    getLastWagerCommand: () => copy(lastWagerCommand),
    requestWager(kind, amount) {
      const wager=data?.session?.wager;
      if(data?.isSpectator||!wager?.supported||!['VOTE','CONFIRM','DECLINE','START','SYNC','CONFIGURE'].includes(kind))return failure('WAGER_UNAVAILABLE');
      if(kind==='CONFIGURE'&&data.session.engine!=='BLUFF')return failure('WAGER_UNAVAILABLE');
      if(data.session.engine==='TETRIS') {
        if(kind==='DECLINE')return sdk.sendGameEvent('TETRIS_COMMAND',{kind:'EXIT'});
        return sdk.sendCommand('TETRIS_COMMAND',kind==='CONFIRM'?'READY':kind,
          {round:wager.round,epoch:wager.epoch,stake:wager.amount,...(kind==='VOTE'?{amount}:{})});
      }
      const command=sdk.createCommand(kind,{epoch:wager.epoch,...(kind==='CONFIGURE'?amount:{amount:kind==='VOTE'?amount:wager.amount})});
      lastWagerCommand=command?{commandId:command.commandId,kind:command.kind,epoch:command.epoch}:null;
      return command?sdk.requestGameUi('WAGER',{command}):false;
    },
    whenPlayable() {
      const ready=()=>!data?.session?.wager?.supported||!['PROPOSAL'].includes(data.session.wager.phase)||data.isSpectator;
      if(ready())return Promise.resolve(copy(data?.session));
      return new Promise((resolve,reject)=>{
        const off=sdk.onSessionUpdate(()=>{if(ready()){off();endOff();resolve(sdk.getSession());}});
        const endOff=sdk.onSessionEnd(()=>{off();endOff();reject(new Error('對局已結束'));});
      });
    },
    getServerTime: () => data ? Number(data.session.serverTime) + monotonic() - timeAtReceive : null,
    getStatus: () => ({ state: lifecycleState(), ready: !!data && !closed,
      sessionStatus: data?.session.status || null, sessionId: data?.gameSessionId || null }),
    getCapabilities: () => ({
      protocolVersion: 2,
      apiRevision: 10,
      commonWagerUi: true,
      publicSpectating: true,
      tetrisSpectating: true,
      readiness: true,
      sessionSnapshots: true,
      roomRoster: true,
      gameEventRelay: true,
      versionedCommands: true,
      hapticRequests: true,
      gameUi: true,
      verifiedScoring: false,
      serverAuthoritativeRules: false,
    }),
    isSessionCurrent(sessionId, minimumVersion = 1) {
      return !!data && !closed && sessionId === data.gameSessionId &&
        Number.isSafeInteger(minimumVersion) && data.session.version >= minimumVersion;
    },
    createCommand(kind, fields = {}, options = {}) {
      if (!data || closed || data.session.status !== 'PLAYING') { failure('SESSION_UNAVAILABLE'); return null; }
      if (typeof kind !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(kind) ||
          !fields || typeof fields !== 'object' || Array.isArray(fields) ||
          !options || typeof options !== 'object' || Array.isArray(options)) {
        failure('COMMAND_INVALID'); return null;
      }
      const expectedVersion = options.expectedVersion ?? data.session.version;
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) { failure('COMMAND_VERSION_INVALID'); return null; }
      let commandFields;
      try { commandFields = copy(fields); }
      catch (_) { failure('COMMAND_FIELDS_INVALID'); return null; }
      const commandId = commandUuid();
      if (!commandId || !uuid.test(commandId)) { failure('COMMAND_ID_UNAVAILABLE'); return null; }
      return { ...commandFields, kind, commandId, expectedVersion };
    },
    sendGameEvent(eventName, payload) {
      if (typeof eventName !== 'string' || !eventName.trim() || eventName.length > 128) return failure('EVENT_INVALID');
      if (reservedEvents.has(eventName)) return failure('EVENT_RESERVED');
      return send('sendGameEvent', { eventName, payload });
    },
    sendCommand(eventName, kind, fields = {}, options = {}) {
      const command = sdk.createCommand(kind, fields, options);
      return command ? sdk.sendGameEvent(eventName, command) : false;
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
    haptic(style = 'light') {
      if (!['selection','light','medium','heavy'].includes(style)) return failure('HAPTIC_INVALID');
      if (!data || closed || data.session.status !== 'PLAYING') return false;
      if (hostUi?.hapticEnabled === false) return false;
      const time = monotonic();
      if (time - lastHapticAt < 50) return false;
      lastHapticAt = time;
      // Browser vibration is best effort; native WebViews use the APP bridge
      // so iOS can use UIKit feedback even without navigator.vibrate.
      if (!native && typeof root.navigator?.vibrate === 'function') {
        try { if (root.navigator.vibrate({selection:8,light:12,medium:25,heavy:[35,25,35]}[style])) return true; }
        catch (_) {}
      }
      return send('haptic',{style});
    },
    leaveGame() { return send('leaveGame',{}); },
    onGameEvent: callback => subscribe('gameEvent', callback),
    onReady(callback) {
      const unsubscribe = subscribe('ready', callback);
      if (data && !closed) root.queueMicrotask(() => {
        if (!closed && hooks.get('ready')?.has(callback)) {
          try { callback(copy(data.session)); }
          catch (error) { root.console.error('BoomRoom SDK callback failed:', error); }
        }
      });
      return unsubscribe;
    },
    whenReady({ timeoutMs = 15000, signal } = {}) {
      if (closed) return Promise.reject(Object.assign(new Error('SDK_DISPOSED'), { code: 'SDK_DISPOSED' }));
      if (data) return Promise.resolve(copy(data.session));
      return new Promise((resolve, reject) => {
        let timer = null, settled = false;
        const cleanup = () => {
          offReady(); offDisposed();
          if (timer !== null) root.clearTimeout(timer);
          signal?.removeEventListener?.('abort', onAbort);
        };
        const finish = (callback, value) => {
          if (settled) return;
          settled = true; cleanup(); callback(value);
        };
        const onAbort = () => finish(reject, Object.assign(new Error('SDK_WAIT_ABORTED'), { code: 'SDK_WAIT_ABORTED' }));
        const offReady = subscribe('ready', session => finish(resolve, session));
        const offDisposed = subscribe('disposed', () => finish(reject, Object.assign(new Error('SDK_DISPOSED'), { code: 'SDK_DISPOSED' })));
        if (Number.isFinite(timeoutMs) && timeoutMs >= 0) {
          timer = root.setTimeout(() => finish(reject, Object.assign(new Error('SDK_READY_TIMEOUT'), { code: 'SDK_READY_TIMEOUT' })), timeoutMs);
        }
        if (signal?.aborted) onAbort();
        else signal?.addEventListener?.('abort', onAbort, { once: true });
      });
    },
    onPurchaseSuccess: callback => subscribe('purchaseSuccess', callback),
    onPurchaseFailed: callback => subscribe('purchaseFailed', callback),
    onPlayerJoin: callback => subscribe('playerJoin', callback),
    onPlayerLeave: callback => subscribe('playerLeave', callback),
    onRoomPlayersChange: callback => subscribe('roomPlayersChange', callback),
    onSessionUpdate: callback => subscribe('sessionUpdate', callback),
    onStatusChange(callback) {
      const unsubscribe = subscribe('statusChange', callback);
      if (!closed && hooks.get('statusChange')?.has(callback)) {
        try { callback(lifecycleState(), null); }
        catch (error) { root.console.error('BoomRoom SDK callback failed:', error); }
      }
      return unsubscribe;
    },
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
      const before = lifecycleState();
      closed = true;
      notify('statusChange', 'DISPOSED', before);
      notify('disposed');
      hooks.clear();
      for (const pending of pendingPurchases.values()) root.clearTimeout(pending.timer);
      pendingPurchases.clear(); data = null;
      root.BoomRoomGameUI?.dispose(); hostUi = null;
      root.BoomRoomWagerUI?.dispose();
      root.removeEventListener('message', receive);
      root.removeEventListener('pagehide', pageHidden);
      if (root.__BoomRoomSDKInitializeHost === initializeHost) delete root.__BoomRoomSDKInitializeHost;
      if(root.receiveVoiceText===nativeVoice){if(previousVoice)root.receiveVoiceText=previousVoice;else delete root.receiveVoiceText;}
    },
  };
  function initializeHost(packet) {
    // Only native app adapters call this direct hook. Browser frames initialize
    // through the parent-origin/source-checked message channel above.
    if (root.parent !== root) return false;
    native = true;
    root.receiveVoiceText=nativeVoice;
    return initialize(packet);
  }
  function pageHidden(event) { if (!event.persisted) sdk.dispose(); }
  root.BoomRoomSDK = sdk;
  if(native)root.receiveVoiceText=nativeVoice;
  root.__BoomRoomSDKInitializeHost = initializeHost;
  root.addEventListener('message', receive);
  root.addEventListener('pagehide', pageHidden);
  const uiReady = new Promise(resolve => {
    if (root.BoomRoomGameUI) { root.BoomRoomGameUI.attach(sdk); resolve(true); return; }
    if (!uiScriptUrl || !root.document?.createElement) { resolve(false); return; }
    const script = root.document.createElement('script');
    script.src = new URL('./game-ui.js?v=3', uiScriptUrl).href;
    script.onload = () => { root.BoomRoomGameUI?.attach(sdk); resolve(!!root.BoomRoomGameUI); };
    script.onerror = () => { failure('GAME_UI_LOAD_FAILED'); resolve(false); };
    root.document.head.appendChild(script);
  });
  if(uiScriptUrl&&root.document?.createElement){
    const script=root.document.createElement('script');script.src=new URL('./wager-ui.js?v=2',uiScriptUrl).href;
    script.onload=()=>root.BoomRoomWagerUI?.attach(sdk);
    script.onerror=()=>failure('WAGER_UI_LOAD_FAILED');root.document.head.appendChild(script);
  }
  if(uiScriptUrl&&root.document?.createElement){
    const script=root.document.createElement('script');script.src=new URL('./result-ui.js?v=1',uiScriptUrl).href;
    script.onload=()=>root.BoomRoomResultUI?.attach(sdk);
    script.onerror=()=>failure('RESULT_UI_LOAD_FAILED');root.document.head.appendChild(script);
  }
  if (native && typeof previous.getSession === 'function') {
    const session = previous.getSession();
    initialize({ user: previous.getUser(), roomId: previous.roomId, isHost: previous.isHost, isSpectator: previous.isSpectator,
      gameSessionId: previous.gameSessionId, session, roomPlayers: previous.roomPlayers || [] });
  }
})(window);
