(() => {
  'use strict';

  const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const VERSION = 2;
  let sdk = null, me = null, session = null, server = null, hand = [];
  let stateVersion = 0, selected = new Set(), selectedRank = 'A', busy = false;
  let roomPlayers = [], toastTimer = 0, clockTimer = 0, audio = null, soundOn = true;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const nameOf = id => server?.players?.find(player => player.id === id)?.username || '玩家';
  const serverNow = () => Number(sdk?.getServerTime?.()) || Date.now();
  const uuid = () => crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0; return (c==='x'?r:(r&3|8)).toString(16); });
  const humans = () => server?.players?.filter(player => !player.ai) || session?.players || [];
  const maxAi = () => Math.max(0, Math.min(9, 10 - humans().length));
  const active = () => !!sdk && sdk.isReady && session?.engine === 'BLUFF' && server;

  function toast(message) {
    const element = document.getElementById('toast');
    if (!element) return;
    element.textContent = message; element.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove('show'), 2300);
  }
  function playSound(type = 'tap') {
    if (!soundOn) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') void audio.resume();
      const values = {tap:[530,.045],card:[360,.07],challenge:[210,.15],win:[820,.2],lose:[175,.17]};
      const [frequency,duration] = values[type] || values.tap;
      const oscillator = audio.createOscillator(), gain = audio.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = frequency; oscillator.connect(gain); gain.connect(audio.destination);
      gain.gain.setValueAtTime(.0001,audio.currentTime); gain.gain.exponentialRampToValueAtTime(.12,audio.currentTime+.012);
      gain.gain.exponentialRampToValueAtTime(.0001,audio.currentTime+duration); oscillator.start(); oscillator.stop(audio.currentTime+duration+.02);
    } catch (_) {}
  }
  function setTopStatus() {
    const element = document.getElementById('topStatus');
    if (element) element.textContent = active()
      ? `房間 ${sdk.roomId}・${humans().length} 真人 + ${server.settings.aiCount} AI・${server.settings.deckCount === 1 ? '54' : '108'} 張牌`
      : sdk?.isReady ? '此對局尚未啟用伺服器權威引擎' : '等待 BoomRoom 對局…';
  }
  function acceptSession(value) {
    if (!value || value.engine !== 'BLUFF' || !value.engineState?.public || !Array.isArray(value.engineState.privateHand)) return false;
    session = value; stateVersion = Number(value.version) || stateVersion;
    server = value.engineState.public;
    hand = value.engineState.privateHand.map(card => ({...card}));
    if (!RANKS.includes(selectedRank)) selectedRank = RANKS[0];
    selected = new Set([...selected].filter(id => hand.some(card => card.id === id)));
    render();
    return true;
  }
  function syncRoster() {
    const current = sdk?.getRoomPlayers?.();
    if (Array.isArray(current)) roomPlayers = current;
    setTopStatus(); render();
  }
  function initialize(data) {
    sdk = window.BoomRoomSDK;
    if (!sdk?.isReady) { renderConnection(); return; }
    const user = sdk.getUser?.();
    if (!user?.id) { renderConnection('無法驗證 BoomRoom 玩家身分。'); return; }
    me = {id:String(user.id), username:user.username || '玩家', avatar:user.avatar || ''};
    const nextSession = data?.session || sdk.getSession?.();
    if (nextSession) {
      session = nextSession;
      if (session.engineState?.public) acceptSession(session);
    }
    if (!sdk.__bluffSubscribed) {
      sdk.__bluffSubscribed = true;
      sdk.onGameEvent?.((eventName,payload,userId) => handleServerEvent(eventName,payload,userId));
      sdk.onPlayerJoin?.(() => syncRoster());
      sdk.onPlayerLeave?.(() => syncRoster());
      sdk.onError?.(error => { if (error?.code) toast('連線更新中，請稍候…'); });
    }
    roomPlayers = sdk.getRoomPlayers?.() || [];
    if (session?.engine === 'BLUFF' && !server) send('SYNC');
    render();
  }
  function renderConnection(message = '請從 BoomRoom 房間進入，等候伺服器驗證對局。') {
    document.getElementById('main').innerHTML = `<section class="panel hero"><div class="heroTitle">🃏 爆爆吹牛</div><div class="heroSub">${escapeHtml(message)}</div></section><section class="panel waitCard"><div class="waitIcon">📡</div><h3>正在連接房間</h3><p>此遊戲使用伺服器發牌和判定，不能在獨立頁面建立假房間或假玩家。</p></section>`;
  }
  function send(kind, fields = {}) {
    if (!sdk?.isReady || session?.status !== 'PLAYING') { toast('對局連線尚未恢復'); return false; }
    const payload = {kind, ...fields};
    if (kind !== 'SYNC') { payload.commandId = uuid(); payload.expectedVersion = stateVersion || session.version; }
    busy = kind !== 'SYNC'; render();
    if (!sdk.sendGameEvent?.('BLUFF_COMMAND',payload)) { busy = false; toast('操作送出失敗，請稍後重試'); render(); return false; }
    playSound(kind === 'CHALLENGE' || kind === 'VOTE' && fields.challenge ? 'challenge' : kind === 'PLAY' ? 'card' : 'tap');
    return true;
  }
  function handleServerEvent(eventName, payload, userId) {
    if (userId !== 'SYSTEM') return;
    if (eventName === 'BLUFF_PRIVATE') {
      const incoming = payload?.session;
      if (incoming?.sessionId !== session?.sessionId || Number(incoming.version) < stateVersion) return;
      busy = false; selected.clear();
      if (acceptSession(incoming)) {
        const resolution = server.lastResolution;
        if (resolution?.type === 'CHALLENGE') playSound(resolution.truthful ? 'lose' : 'win');
        if (server.phase === 'RESULT') playSound('win');
      }
      return;
    }
    if (eventName === 'BLUFF_PUBLIC') {
      if (payload?.sessionId !== session?.sessionId || Number(payload.version) < stateVersion) return;
      busy = false; stateVersion = Number(payload.version); server = payload.state;
      selected.clear(); render(); return;
    }
    if (eventName === 'BLUFF_ERROR') {
      busy = false; toast(payload?.message || '操作沒有完成，正在重新同步…'); render();
      setTimeout(() => send('SYNC'),300); return;
    }
  }

  function seatCards() {
    const turn = server?.currentTurnId;
    return (server?.players || []).map(player => {
      const isMe = player.id === me?.id, isTurn = player.id === turn;
      const badges = [player.ai ? '<span class="playerBadge">🤖 AI</span>' : '', isMe ? '<span class="playerBadge">你</span>' : '',
        player.id === server.leaderId ? '<span class="playerBadge">牌權</span>' : '', player.id === server.lastClaim?.playerId ? '<span class="playerBadge">最後出牌</span>' : '',
        isTurn ? '<span class="playerBadge turnPulse">● 行動中</span>' : '', server.skipped?.includes(player.id) ? '<span class="playerBadge">已跳過</span>' : ''].filter(Boolean).join('');
      const online = player.ai ? '伺服器 AI' : roomPlayers.some(item => String(item.id ?? item.userId) === player.id) ? '已連線' : '離線・逾時自動跳過';
      return `<article class="player ${isMe?'me':''} ${isTurn?'turn':''}"><div class="playerHead"><span class="avatarFallback">${player.ai?'🤖':escapeHtml((player.username||'玩')[0])}</span><div class="playerInfo"><b>${escapeHtml(player.username)}${isMe?'（你）':''}</b><em>剩 ${player.cardCount} 張・${online}</em></div></div><div class="playerBadges">${badges}</div><div class="playerBar"><i style="width:${Math.min(100,player.cardCount/Math.max(1,...server.players.map(p=>p.cardCount))*100)}%"></i></div></article>`;
    }).join('') || '<div class="emptyPlayer">同步座位中…</div>';
  }
  function renderSetup() {
    const isHost = !!sdk.isHost, n = server.settings.aiCount, limit = maxAi();
    const participants = server.players.length, canStart = participants >= 2;
    const hostControls = isHost ? `
      <section class="panel"><div class="sectionTitle">🤖 AI 對手</div>
        <div class="setupSummary"><span>真人玩家／上限</span><b>${humans().length}／10</b></div>
        <div class="aiStepper"><button class="cta secondary" id="aiLess" ${busy||n<=0?'disabled':''}>−</button><div class="setupSummary"><span>AI 數量</span><b>${n}</b></div><button class="cta secondary" id="aiMore" ${busy||n>=limit?'disabled':''}>＋</button></div>
        <div class="compactNote">可選 0～${limit} 位 AI・目前共 ${humans().length+n}／10 人。AI 由伺服器操控，會清楚標示，不占用真人座位。</div>
      </section>
      <section class="panel"><div class="sectionTitle">🃏 牌組</div><div class="selectRow">${[1,2].map(count=>`<button class="choice ${server.settings.deckCount===count?'active':''}" data-deck="${count}" ${busy?'disabled':''}><b>${count===1?'54 張':'108 張'}</b><span>${count===1?'一副牌':'兩副牌'}</span></button>`).join('')}</div></section>
      <section class="panel"><div class="sectionTitle">🔥 質疑回應方式</div><div class="selectRow"><button class="choice ${server.settings.challengeMode==='SEQUENTIAL'?'active':''}" data-mode="SEQUENTIAL" ${busy?'disabled':''}><b>依序回應</b><span>輪到者可質疑、跟牌或跳過</span></button><button class="choice ${server.settings.challengeMode==='VOTE_FIRST'?'active':''}" data-mode="VOTE_FIRST" ${busy?'disabled':''}><b>全員先質疑</b><span>先表態，再依序跟牌</span></button></div></section>
      <section class="panel"><div class="sectionTitle">👥 本局座位・${participants}／10</div><div class="players">${seatCards()}</div><div class="compactNote">牌局開始後座位與 AI 人數會鎖定，離線真人不會被替換成 AI。</div></section>
      <div class="actionDock"><button id="startBtn" class="cta" ${busy||!canStart?'disabled':''}>⚡ 房主開始對局</button>${!canStart?'<div class="notice">目前沒有對手；增加至少 1 位 AI 後即可開始。</div>':''}</div>`
      : `<section class="panel hero"><div class="heroTitle">🃏 等候房主開始</div><div class="heroSub">房主正在設定 AI 對手與牌組；座位固定後會由伺服器發牌。</div></section>
      <section class="panel"><div class="sectionTitle">👥 本局座位・${participants}／10</div><div class="players">${seatCards()}</div></section><section class="panel waitCard"><div class="waitIcon">👑</div><h3>等候房主</h3><p>開始後會收到只有你看得到的手牌，其他人的手牌由伺服器保密。</p></section>`;
    return `<section class="panel hero"><div class="heroTitle">👑 對局設定</div><div class="heroSub">所有真人與 AI 最多 10 位；1 位真人、0 位 AI 時不會假裝開出多人局。</div><div class="stats"><div class="stat"><b>${humans().length}</b><span>真人</span></div><div class="stat"><b>${server.settings.aiCount}</b><span>AI</span></div><div class="stat"><b>${participants}/10</b><span>總人數</span></div></div></section>${hostControls}`;
  }

  function deadlineText() {
    if (!server.actionDeadline) return '';
    const remaining = Math.max(0,Math.ceil((server.actionDeadline-serverNow())/1000));
    return `⏱ ${remaining} 秒`;
  }
  function renderResolution() {
    const result = server.lastResolution;
    if (!result) return '';
    if (result.type === 'CHALLENGE') {
      return `<section class="panel"><div class="sectionTitle">${result.truthful?'❌ 質疑失敗':'🔥 質疑成功'}</div><div class="compactNote">${escapeHtml(result.claimantName)} 宣告 ${result.revealed.length} 張 ${escapeHtml(result.rank)}。最新一手翻牌如下：${result.truthful?'全部符合宣告點數或王。':'至少一張不符合宣告點數，也不是王。'}${escapeHtml(result.takerId===result.claimantId?result.claimantName:result.challengerName)} 收走整個牌池。</div><div class="revealedHand">${result.revealed.map((card,index)=>`<span class="revealedCard ${card.joker?'joker':['♥','♦'].includes(card.suit)?'red':''}" style="animation-delay:${Math.min(index,8)*70}ms">${escapeHtml(card.joker?'🃏 王':`${card.rank}${card.suit}`)}</span>`).join('')}</div></section>`;
    }
    return `<section class="panel"><div class="compactNote">本輪無人質疑，${result.count} 張牌已移入棄牌堆；出牌者保留牌權。</div></section>`;
  }
  function renderPlaying() {
    const myTurn = server.currentTurnId === me.id;
    const claim = server.lastClaim;
    const voter = server.phase === 'CHALLENGE_VOTE' && !!claim && claim.playerId !== me.id && !(me.id in server.votes);
    const votesRemain = Math.max(0,server.players.length-1-Object.keys(server.votes||{}).length);
    const current = server.players.find(player => player.id === server.currentTurnId);
    const ownSeat = server.players.find(player => player.id === me.id);
    const canLead = myTurn && !claim;
    const canFollow = myTurn && !!claim;
    const cards = hand.map(card=>({...card})).sort((a,b)=>RANKS.indexOf(a.rank)-RANKS.indexOf(b.rank) || a.suit.localeCompare(b.suit));
    const actions = server.phase === 'CHALLENGE_VOTE'
      ? voter ? `<div class="actionRow"><button id="voteYes" class="cta danger">🔥 質疑這一手</button><button id="voteNo" class="cta secondary">不質疑</button></div>`
        : `<div class="lockHint">${me.id===claim?.playerId?'你是最後出牌者，暫不投票':server.votes[me.id]===true?'你已提出質疑，等待牌桌結算':'等待其他玩家表態'}・尚餘 ${votesRemain} 人</div>`
      : myTurn ? claim ? `<div class="actionRow"><button id="challengeBtn" class="cta danger">🔥 質疑</button><button id="passBtn" class="cta secondary" ${busy?'disabled':''}>跳過</button></div>`
        : '' : `<div class="lockHint">${escapeHtml(current?.username||'下一位玩家')} 的回合・${deadlineText()}</div>`;
    return `<section class="tableCenter"><div class="turnLabel">第 ${server.round} 局・${server.settings.challengeMode==='SEQUENTIAL'?'立即依序回應':'全員先質疑'}・${deadlineText()}</div>
      ${claim?`<div class="claimBox">目前宣告：<b>${claim.count} 張 ${escapeHtml(claim.rank)}</b><br>最後出牌：${escapeHtml(nameOf(claim.playerId))}</div>`:`<div class="claimBox">${escapeHtml(nameOf(server.currentTurnId))} 保有牌權，請選擇首手宣告</div>`}
      <div class="pileCount">🂠 ${server.pileCount} 張</div><div class="pileStack" aria-label="中央牌池 ${server.pileCount} 張">${Array.from({length:Math.min(4,server.pileCount)},()=>'<span class="pileBack"></span>').join('')}</div><div class="pileSub">中央牌池・棄牌堆 ${server.discardCount} 張</div>${current?.ai&&server.phase==='TURN'?'<div class="aiThinking">🤖 AI 正在思考並依規則行動…</div>':''}${actions}</section>
      ${renderResolution()}
      <section class="panel"><div class="sectionTitle">👥 玩家座位・${server.players.length}/10</div><div class="players">${seatCards()}</div></section>
      <section class="panel"><div class="sectionTitle">📜 牌局紀錄</div><div class="feedBox">${server.log.slice(-7).reverse().map(item=>`<div class="feedLine">${escapeHtml(item.text)}</div>`).join('')}</div></section>
      <section class="panel handPanel"><div class="handHeader"><div class="sectionTitle" style="margin:0">你的手牌・${hand.length} 張</div><div class="hint">${myTurn?'點選手牌，確認後蓋牌':server.phase==='CHALLENGE_VOTE'?'先表態是否質疑':'等待你的回合'}</div></div>
        <div class="handArea">${cards.length?cards.map(card=>`<button class="card ${card.joker?'joker':['♥','♦'].includes(card.suit)?'red':''} ${selected.has(card.id)?'selected':''} ${!canFollow&&!canLead?'disabledCard':''}" data-card="${escapeHtml(card.id)}" ${!myTurn||busy?'disabled':''} aria-label="${escapeHtml(card.rank)} ${escapeHtml(card.suit)}"><span>${card.joker?'王':escapeHtml(card.rank)}</span><span class="cardSuit">${card.joker?'🃏':escapeHtml(card.suit)}</span><span class="cardBottom">${card.joker?'JOKER':escapeHtml(card.rank)}</span></button>`).join(''):'<div class="notice" style="width:100%">目前沒有手牌，等待牌局結算。</div>'}</div>
        <div class="sectionTitle" style="margin-top:4px">${claim?'跟牌固定宣告 '+escapeHtml(claim.rank):'選擇本輪宣告'}</div>${!claim?`<div class="rankGrid">${RANKS.map(rank=>`<button class="rankBtn ${selectedRank===rank?'active':''}" data-rank="${rank}" ${!canLead||busy?'disabled':''}>${rank}</button>`).join('')}</div>`:''}
        <div class="playMeta"><span>${selected.size?`已選 ${selected.size} 張・${selectedRank}`:'選 1 張或更多牌'}</span><span>${ownSeat?`${ownSeat.cardCount} 張未出` : ''}</span></div>${selected.size&&myTurn?`<div class="compactNote" style="margin-top:8px">蓋牌預覽：${selected.size} 張，宣告 ${claim?.rank||selectedRank}。其他玩家只會看見牌背。</div>`:''}
      </section>
      ${myTurn&&server.phase==='TURN'?`<div class="actionDock"><button id="playBtn" class="cta" ${!selected.size||busy?'disabled':''}>${claim?'跟牌':'出牌'}・${selected.size} 張・宣告 ${claim?.rank||selectedRank}</button>${claim?'':''}</div>`:''}`;
  }
  function renderResult() {
    const winner = server.players.find(player => player.id === server.winnerId);
    return `<section class="panel resultHero"><div class="emoji">🏆</div><h2>${escapeHtml(winner?.username||'爆爆吹牛王')}</h2><p>爆爆吹牛王・第 ${server.round} 局</p><div class="resultActions"><button id="returnBtn" class="cta green">返回房間</button>${sdk.isHost?'<button id="nextBtn" class="cta secondary">房主再開一局</button>':''}</div></section>
      <section class="panel"><div class="sectionTitle">📊 正式排名・伺服器結算</div><div class="rankList">${server.rankings.map(row=>{const player=server.players.find(item=>item.id===row.playerId);return `<div class="rankRow"><div class="rankNo">#${row.place}</div><div class="rankName"><b>${escapeHtml(player?.username||'玩家')}${player?.ai?' ・AI':''}${row.playerId===me.id?'（你）':''}</b></div><div class="rankScore">剩 ${row.handCount} 張</div><div class="rankDetail">${row.place===1?'爆爆吹牛王':''}</div></div>`;}).join('')}</div></section>
      <section class="panel"><div class="sectionTitle">📜 本局紀錄</div><div class="feedBox">${server.log.slice(-12).reverse().map(item=>`<div class="feedLine">${escapeHtml(item.text)}</div>`).join('')}</div></section>`;
  }
  function render() {
    if (!sdk?.isReady || !me) return renderConnection();
    if (session?.engine !== 'BLUFF') return renderConnection('這場遊戲的伺服器尚未啟用爆爆吹牛權威模式，請更新 BoomRoom Server 與 APP 後重新開局。');
    if (!server) return renderConnection('正在從伺服器取回座位和你的私有手牌…');
    const main = document.getElementById('main');
    main.innerHTML = server.phase==='SETUP' ? renderSetup() : server.phase==='RESULT' ? renderResult() : renderPlaying();
    setTopStatus(); bindActions();
  }
  function configure(changes = {}) {
    send('CONFIGURE',{aiCount:changes.aiCount ?? server.settings.aiCount,
      deckCount:changes.deckCount ?? server.settings.deckCount, challengeMode:changes.challengeMode ?? server.settings.challengeMode});
  }
  function bindActions() {
    document.querySelectorAll('[data-deck]').forEach(button=>button.onclick=()=>configure({deckCount:Number(button.dataset.deck)}));
    document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>configure({challengeMode:button.dataset.mode}));
    document.getElementById('aiLess')?.addEventListener('click',()=>configure({aiCount:Math.max(0,server.settings.aiCount-1)}));
    document.getElementById('aiMore')?.addEventListener('click',()=>configure({aiCount:Math.min(maxAi(),server.settings.aiCount+1)}));
    document.getElementById('startBtn')?.addEventListener('click',()=>send('START'));
    document.querySelectorAll('[data-card]').forEach(button=>button.addEventListener('click',()=>{
      const id=button.dataset.card; selected.has(id)?selected.delete(id):selected.add(id); playSound(); render();
    }));
    document.querySelectorAll('[data-rank]').forEach(button=>button.addEventListener('click',()=>{selectedRank=button.dataset.rank;playSound();render();}));
    document.getElementById('playBtn')?.addEventListener('click',()=>{
      if (!selected.size) return toast('請先選擇至少一張手牌');
      if (!window.confirm(`蓋下 ${selected.size} 張牌並宣告 ${server.lastClaim?.rank||selectedRank}？`)) return;
      send('PLAY',{cardIds:[...selected],rank:server.lastClaim?.rank||selectedRank});
    });
    document.getElementById('passBtn')?.addEventListener('click',()=>send('PASS'));
    document.getElementById('challengeBtn')?.addEventListener('click',()=>{if(window.confirm(`質疑 ${nameOf(server.lastClaim?.playerId)} 最近蓋下的這一手？`))send('CHALLENGE');});
    document.getElementById('voteYes')?.addEventListener('click',()=>send('VOTE',{claimId:server.lastClaim.id,challenge:true}));
    document.getElementById('voteNo')?.addEventListener('click',()=>send('VOTE',{claimId:server.lastClaim.id,challenge:false}));
    document.getElementById('returnBtn')?.addEventListener('click',()=>{
      if(window.confirm('返回 BoomRoom 房間？')) sdk.leaveGame?.();
    });
    document.getElementById('nextBtn')?.addEventListener('click',()=>send('NEXT'));
  }

  function showHelp() { document.getElementById('helpModal')?.classList.add('show'); }
  function closeHelp() { document.getElementById('helpModal')?.classList.remove('show'); }
  document.getElementById('soundBtn')?.addEventListener('click',event=>{
    soundOn=!soundOn; event.currentTarget.textContent=soundOn?'🔊':'🔇'; if(soundOn)playSound();
  });
  document.getElementById('leaveBtn')?.addEventListener('click',()=>{
    if(window.confirm('返回 BoomRoom 房間？離開不會改變本局結果。')) sdk?.leaveGame?.();
  });
  document.getElementById('helpBtn')?.addEventListener('click',showHelp);
  document.getElementById('closeHelpBtn')?.addEventListener('click',closeHelp);
  document.getElementById('helpModal')?.addEventListener('click',event=>{if(event.target.id==='helpModal')closeHelp();});
  window.addEventListener('message',event=>{
    try {
      const data=typeof event.data==='string'?JSON.parse(event.data):event.data;
      if (data?.action==='initSDK') initialize(data);
      if (data?.action==='roomPlayersUpdated') { roomPlayers=data.roomPlayers||[]; render(); }
      if (data?.action==='gameEventReceived') handleServerEvent(data.eventName,data.payload,data.userId);
    } catch (_) {}
  });
  window.initBoomRoomSDK = initialize;
  window.onBoomRoomSDKReady = () => initialize();
  document.getElementById('helpModal')?.querySelector('.rules')?.replaceChildren(Object.assign(document.createElement('div'),{innerHTML:
    '<p><strong>① 先蓋牌宣告</strong><br>首位牌權玩家可宣告任一點數；其他人依序跟牌，必須沿用同一點數。大小王可作任意點數。</p><p><strong>② 選擇質疑或跟牌</strong><br>每次只檢查最後玩家最新蓋下的一手。房主可選依序回應，或全員先完成質疑表態。</p><p><strong>③ 抓包與收牌</strong><br>宣告牌與王全符合時，質疑者收走整個牌池；否則最後出牌者收走。更早的牌不會翻開。</p><p><strong>④ 全員跳過</strong><br>無人質疑時，牌池移到棄牌區，最後出牌者保留牌權。清空手牌會在正式結算時確認勝負。</p><p class="muted">你的手牌由伺服器單獨傳送。行動逾時會自動跳過，AI 也由同一套規則引擎操作。本遊戲不自行發放銀幣。</p>'}));
  if (window.BoomRoomSDK?.isReady) initialize(); else renderConnection();
  clockTimer = setInterval(()=>{if(server?.actionDeadline&&server.phase!=='SETUP'&&server.phase!=='RESULT')render();},1000);
  window.addEventListener('pagehide',()=>clearInterval(clockTimer),{once:true});
})();
