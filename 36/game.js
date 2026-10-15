(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const rules = window.TetrisBattleEngine, { Engine } = rules;
  const sdk = window.BoomRoomSDK;
  const embedded = window.parent !== window || new URL(location.href).searchParams.get('boomroomHost') === '1';
  const colors = ['','#55dbea','#f0d56a','#b394f5','#7bdb9e','#ee718a','#669ff4','#eda776','#7d8b9e'];
  const inputs = new Map(), cleanups = [];
  const ROOM_RETURN_DELAY_MS = 10_000;
  let engine = null, room = null, session = null, mode = 'marathon', paused = false, helpPaused = false;
  let lastFrame = performance.now(), lastPublish = 0, lastSave = 0, builtRivals = '', target = null;
  let activeRound = 0, resultRound = -1, completionSent = false, exiting = false, disposed = false;
  let toastTimer = 0, feedbackTimer = 0, resultReturnTimer = 0, resultReturnDeadline = 0, clearFlash = null, bootEpoch = 0, saved = null;
  let selfId = null;
  let countPlayed = -1;
  let soundBus = null, musicBus = null;
  let raf = 0, heartbeat = 0, audio = null, musicStep = 0, lastMusic = 0, gesture = null;
  let lastSoftSound = 0;
  const clock = () => room ? room.now() : performance.now();
  const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; } };
  const write = (key,value) => { try { localStorage.setItem(key,JSON.stringify(value)); } catch (_) {} };
  const preferences = { sound:true, music:true, haptic:true, ...read('tb36:preferences') };
  const formatTime = ms => { const s=Math.max(0,Math.floor(ms/1000)); return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; };
  const decimal = n => Math.floor(n).toLocaleString('zh-TW');
  const localSeed = () => { try { return crypto.getRandomValues(new Uint32Array(1))[0]; } catch (_) { return Date.now()>>>0; } };
  const on = (element,name,fn,opts) => { element.addEventListener(name,fn,opts); cleanups.push(()=>element.removeEventListener(name,fn,opts)); };
  const show = (element,visible) => { element.hidden = !visible; };
  const storageKey = () => session ? `tb36:session:${session.sessionId}:${selfId}` : 'tb36:local';
  function toast(message) {
    $('toast').textContent=message; $('toast').classList.add('show'); clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2600);
  }
  function stopResultReturnCountdown() {
    clearTimeout(resultReturnTimer);resultReturnTimer=0;resultReturnDeadline=0;
  }
  function startResultReturnCountdown() {
    stopResultReturnCountdown();resultReturnDeadline=Date.now()+ROOM_RETURN_DELAY_MS;
    const update=()=>{
      if(disposed||exiting||$('result').hidden||room?.phase!=='results'){stopResultReturnCountdown();return;}
      const deadline=room?.verified?sdk.getSession()?.completion?.returnAt:resultReturnDeadline;
      const seconds=deadline==null?null:Math.max(0,Math.ceil((deadline-(room?.verified?sdk.getServerTime():Date.now()))/1000));
      if(room?.verified&&seconds===null){$('returnCountdown').textContent='等待伺服器共用結算…';resultReturnTimer=setTimeout(update,250);return;}
      $('returnCountdown').textContent=`${seconds} 秒後自動返回房間`;
      if(seconds===0){if(room?.verified){$('returnCountdown').textContent='等待伺服器返回原房間…';resultReturnTimer=setTimeout(update,250);return;}resultReturnTimer=0;leave();return;}
      resultReturnTimer=setTimeout(update,250);
    };
    update();
  }
  function vibrate(style='light') {
    if (!preferences.haptic) return;
    if (embedded && sdk?.haptic) sdk.haptic(style);
    else { try { navigator.vibrate?.({selection:8,light:12,medium:25,heavy:[35,25,35]}[style]); } catch (_) {} }
  }
  function unlockAudio() {
    try {
      if (!audio) { const Ctx=window.AudioContext||window.webkitAudioContext;
        if(Ctx){audio=new Ctx();soundBus=audio.createGain();musicBus=audio.createGain();soundBus.connect(audio.destination);musicBus.connect(audio.destination);preferenceUI();}
      }
      if (audio?.state==='suspended') audio.resume().catch(()=>{});
    } catch (_) {}
  }
  function tone(frequency,length=0.07,type='triangle',volume=0.04,delay=0,bus='sound') {
    if (!audio || audio.state!=='running') return;
    const oscillator=audio.createOscillator(), gain=audio.createGain(), t=audio.currentTime+delay;
    oscillator.type=type; oscillator.frequency.setValueAtTime(frequency,t);
    gain.gain.setValueAtTime(0.0001,t); gain.gain.exponentialRampToValueAtTime(volume,t+0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001,t+length);
    oscillator.connect(gain); gain.connect(bus==='music'?musicBus:soundBus); oscillator.start(t); oscillator.stop(t+length+0.015);
    oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
  }
  function sound(kind,count=0) {
    if (!preferences.sound || document.hidden) return;
    const notes = { move:[165],rotate:[330],hold:[294,440],drop:[110,82],lock:[196],clear:[392,494,587],
      tetris:[392,494,587,784],incoming:[146,138],over:[330,262,196],win:[523,659,784,1047],count:[440],go:[880,1047] };
    const melody=notes[kind]||notes.move;
    melody.forEach((note,i)=>tone(note,count>=4?.14:.07,kind==='drop'?'sine':'triangle',.035,i*.055));
    if (audio?.state==='running' && (kind==='drop'||kind==='lock')) {
      const length=kind==='drop'?.10:.055, buffer=audio.createBuffer(1,Math.ceil(audio.sampleRate*length),audio.sampleRate);
      const samples=buffer.getChannelData(0);for(let i=0;i<samples.length;i++)samples[i]=(Math.random()*2-1)*Math.pow(1-i/samples.length,3);
      const source=audio.createBufferSource(),gain=audio.createGain(),filter=audio.createBiquadFilter();source.buffer=buffer;filter.type='lowpass';filter.frequency.value=kind==='drop'?1800:1000;gain.gain.value=kind==='drop'?.13:.075;
      source.connect(filter);filter.connect(gain);gain.connect(soundBus);source.start();source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
    }
  }
  function music(time) {
    if (!preferences.music || !engine || !canPlay() || document.hidden || !audio || time-lastMusic<190) return;
    lastMusic=time;
    const melody=[0,7,12,10,7,3,5,7,0,7,15,12,10,7,5,3], step=musicStep++%16;
    const freq=130.81*Math.pow(2,melody[step]/12);
    tone(freq,.13,'triangle',.011,0,'music'); if(step%4===0)tone(65.4,.2,'sine',.018,0,'music');
  }
  function togglePreference(key) {
    preferences[key]=!preferences[key]; write('tb36:preferences',preferences); preferenceUI();
    if(key==='haptic' && preferences.haptic)vibrate('medium');
  }
  function preferenceUI() {
    for(const key of ['sound','music','haptic'])$(key+'Btn').setAttribute('aria-pressed',String(!!preferences[key]));
    if(soundBus)soundBus.gain.value=preferences.sound?1:0;
    if(musicBus)musicBus.gain.value=preferences.music?1:0;
  }
  function block(ctx,x,y,size,color,ghost=false) {
    const inset=Math.max(.7,size*.06), edge=size-inset*2;
    if(ghost){ctx.strokeStyle=color;ctx.lineWidth=Math.max(1,size*.06);ctx.strokeRect(x+inset,y+inset,edge,edge);ctx.fillStyle=color+'16';ctx.fillRect(x+inset,y+inset,edge,edge);return;}
    ctx.fillStyle=color;ctx.fillRect(x+inset,y+inset,edge,edge);
    ctx.fillStyle='#ffffff30';ctx.fillRect(x+inset,y+inset,edge,Math.max(1,size*.12));
    ctx.fillStyle='#00000024';ctx.fillRect(x+inset,y+size-inset-size*.13,edge,size*.13);
  }
  function canvasSize(canvas,w,h) {
    const ratio=Math.min(window.devicePixelRatio||1,2);
    const pw=Math.round(w*ratio),ph=Math.round(h*ratio);
    if(canvas.width!==pw || canvas.height!==ph){canvas.width=pw;canvas.height=ph;}
    const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);return ctx;
  }
  function drawBoard(canvas,view,local=false,provisionalBoard=null) {
    const width=canvas.clientWidth||300,height=width*2,unit=width/10,ctx=canvasSize(canvas,width,height);
    ctx.fillStyle='#080f1e';ctx.fillRect(0,0,width,height);
    ctx.strokeStyle='#26365155';ctx.lineWidth=.5;
    for(let x=1;x<10;x++){ctx.beginPath();ctx.moveTo(x*unit,0);ctx.lineTo(x*unit,height);ctx.stroke();}
    for(let y=1;y<20;y++){ctx.beginPath();ctx.moveTo(0,y*unit);ctx.lineTo(width,y*unit);ctx.stroke();}
    if(!view)return;
    view.board.slice(2).forEach((row,y)=>row.forEach((value,x)=>{if(value)block(ctx,x*unit,y*unit,unit,colors[value]);}));
    if(provisionalBoard){
      ctx.save();ctx.globalAlpha=.38;
      provisionalBoard.slice(2).forEach((row,y)=>row.forEach((value,x)=>{
        const confirmed=view.board[y+2][x];if(value===confirmed)return;
        if(value)block(ctx,x*unit,y*unit,unit,colors[value]);
        else{ctx.fillStyle='#d7efff';ctx.fillRect(x*unit+unit*.08,y*unit+unit*.08,unit*.84,unit*.84);}
      }));
      ctx.restore();
    }
    if(local && engine?.status==='playing')for(const c of rules.cells(engine.ghost()))if(c.y>=2)block(ctx,c.x*unit,(c.y-2)*unit,unit,colors[colorsIndex(engine.active.type)],true);
    if(view.active && view.status==='playing')for(const c of rules.cells(view.active))if(c.y>=2)block(ctx,c.x*unit,(c.y-2)*unit,unit,colors[colorsIndex(view.active.type)]);
    if(local && clearFlash && performance.now()-clearFlash.time<220){
      ctx.fillStyle='#b8faff77';for(const row of clearFlash.rows)if(row>=2)ctx.fillRect(0,(row-2)*unit,width,unit);
    }
  }
  const colorsIndex = type => rules.TYPES.indexOf(type)+1;
  function preview(canvas,types,held=false) {
    const width=120,height=held?82:260,ctx=canvasSize(canvas,width,height);ctx.clearRect(0,0,width,height);
    types.forEach((type,i)=>{
      if(!type)return;
      const shape=rules.matrix(type), filled=[];
      shape.forEach((row,y)=>row.forEach((v,x)=>{if(v)filled.push({x,y});}));
      const minX=Math.min(...filled.map(c=>c.x)),maxX=Math.max(...filled.map(c=>c.x));
      const minY=Math.min(...filled.map(c=>c.y)),maxY=Math.max(...filled.map(c=>c.y));
      const size=21,ox=(width-(maxX-minX+1)*size)/2,oy=held?(height-(maxY-minY+1)*size)/2:i*52+(52-(maxY-minY+1)*size)/2;
      filled.forEach(c=>block(ctx,ox+(c.x-minX)*size,oy+(c.y-minY)*size,size,colors[colorsIndex(type)]));
    });
  }
  function showBoardOverlay(title,note,resume=false) {
    show($('boardOverlay'),!!title);$('overlayTitle').textContent=title;$('overlayNote').textContent=note;
    show($('resumeBtn'),resume);
    show($('reconnectBtn'),title.includes('同步中'));
  }
  function canPlay() {
    return !!engine && engine.status==='playing' && !paused && !exiting && !disposed &&
      (!session || sdk.status==='PLAYING') &&
      (!room || room.phase==='playing' && !room.recovering && room.players.get(room.self)?.alive);
  }
  function releaseInput(source) { const soft=inputs.get(source)?.kind==='soft';inputs.delete(source);if(soft&&![...inputs.values()].some(p=>p.kind==='soft'))room?.input?.('softOff'); }
  function clearInputs() { const soft=[...inputs.values()].some(p=>p.kind==='soft');inputs.clear();if(soft)room?.input?.('softOff');for(const b of document.querySelectorAll('[data-action]'))b.classList.remove('pressed'); }
  function action(kind) {
    if(!canPlay())return;
    const pieces=engine.pieces;
    let success=false;
    if(kind==='left'||kind==='right'){success=engine.move(kind==='left'?-1:1);if(success)sound('move');}
    else if(kind==='cw'||kind==='ccw')success=engine.rotate(kind==='cw'?1:-1);
    else if(kind==='hold')success=engine.swapHold();
    else if(kind==='hard')success=engine.hardDrop();
    else if(kind==='soft')success=engine.drop(true);
    // Do not spend a server sequence number on a move the local rules already
    // rejected. A no-op used to poison every later authoritative input.
    if(success)room?.input?.(kind,pieces);
    if(success)vibrate(kind==='hard'?'medium':'selection');
    processEvents();if(room && success && kind!=='soft' && kind!=='left' && kind!=='right')publish();
    render();
  }
  function press(kind,source) {
    if(inputs.has(source))return;
    action(kind);inputs.set(source,{kind,start:performance.now(),last:performance.now()});
    if(kind==='soft'&&canPlay())room?.input?.('softOn');
  }
  function repeat(time) {
    const horizontal=[...inputs.values()].filter(input=>input.kind==='left'||input.kind==='right').at(-1);
    if(horizontal && time-horizontal.start>=150 && time-horizontal.last>=45){horizontal.last=time;action(horizontal.kind);}
  }
  function feedback(text) {
    $('clearFeedback').textContent=text;$('clearFeedback').classList.add('show');clearTimeout(feedbackTimer);
    feedbackTimer=setTimeout(()=>$('clearFeedback').classList.remove('show'),900);
  }
  function processEvents() {
    if(!engine)return;
    for(const event of engine.drainEvents()) {
      if(['rotate','hold','drop'].includes(event.kind))sound(event.kind);
      if(event.kind==='lock') {
        if(event.count){
          const label=event.spin?`T-SPIN${event.spin==='mini'?' MINI':''}`:['','SINGLE','DOUBLE','TRIPLE','TETRIS!'][event.count];
          feedback(`${event.backToBack?'B2B · ':''}${label}${event.combo>0?' · '+event.combo+' COMBO':''}`);
          clearFlash={rows:event.rows,time:performance.now()};sound(event.count===4||event.spin?'tetris':'clear',event.count);vibrate('heavy');
        }else sound('lock');
        if(event.damage && room)room.attack(Math.min(event.damage,20),target);
        if(event.cancelled)toast(`抵消 ${event.cancelled} 行攻擊`);
      }
      if(event.kind==='incoming'){sound('incoming');vibrate('medium');toast(`收到 ${event.lines} 行！消行可抵消`);}
      if(event.kind==='garbage')feedback(`↑ ${event.lines} 行垃圾`);
      if(event.kind==='over'){
        clearInputs();sound(event.reason==='complete'?'win':'over');vibrate('heavy');
        if(room)publish();else soloResult();
      }
    }
  }
  function publish() { if(room && engine){lastPublish=performance.now();room.publish(engine.view());} }
  function startSolo(restore=null) {
    clearInputs();paused=false;completionSent=false;resultRound=-1;activeRound=0;
    engine=restore||new Engine({seed:localSeed(),mode});mode=engine.mode;
    show($('menu'),false);show($('result'),false);show($('help'),false);
    $('modeLabel').textContent=mode==='sprint'?'40-LINE SPRINT':'MARATHON';
    $('roundLabel').textContent=mode==='sprint'?'目標 · 40 行':'目標 · 150 行';
    lastFrame=performance.now();musicStep=0;$('pauseBtn').disabled=false;
    if(engine.status!=='playing')soloResult();else sound('go');render();persist();
  }
  function persist() {
    if(room?.verified||room?.local)return;
    if(!engine && !room)return;
    write(storageKey(),{ version:1,savedAt:Date.now(),round:activeRound,engine:engine?.save()||null,
      room:room?.snapshot()||null,received:room?[...room.received]:[],stateSeq:room?.stateSeq||0,attackSeq:room?.attackSeq||0 });
  }
  function completeRound() {
    if(room?.spectator)return;
    if(completionSent)return;completionSent=true;
    if(session && sdk.status==='PLAYING')sdk.completeRound(engine?.score||0);
  }
  function stat(parent,label,value) {
    const tile=document.createElement('div'),b=document.createElement('b'),span=document.createElement('span');
    tile.className='result-stat';b.textContent=value;span.textContent=label;tile.append(b,span);parent.append(tile);
  }
  function soloResult() {
    if(!engine)return;
    stopResultReturnCountdown();show($('returnCountdown'),false);show($('replayBtn'),true);$('resultExit').className='secondary';
    completeRound();$('resultEyebrow').textContent=engine.status==='complete'?'CHALLENGE COMPLETE':'ONE MORE TRY';
    $('resultTitle').textContent=engine.status==='complete'?'漂亮！挑戰完成。':'這局，離極限更近了。';
    $('resultIntro').textContent=engine.status==='complete'?(mode==='sprint'?'40 行衝刺完成，刷新你的節奏！':'150 行馬拉松完成！'):'方塊堆到頂部。留一條空隙，下一局再突破。';
    $('resultMark').textContent=engine.status==='complete'?'✦':'↻';
    $('resultStats').replaceChildren();stat($('resultStats'),'分數',decimal(engine.score));stat($('resultStats'),'消行',engine.lines);stat($('resultStats'),'時間',formatTime(engine.elapsed));
    $('rankings').replaceChildren();
    const key=`tb36:best:${mode}`,best=read(key)||{},newScore=engine.score>(best.score||0);
    const newTime=mode==='sprint'&&engine.status==='complete'&&(!best.time||engine.elapsed<best.time);
    write(key,{score:Math.max(best.score||0,engine.score),time:newTime?engine.elapsed:best.time||null});
    $('bestResult').textContent=newTime?'新紀錄！40 行最佳時間 '+formatTime(engine.elapsed):newScore?'新紀錄！本機最高分 '+decimal(engine.score):'本機最高分 '+decimal(Math.max(best.score||0,engine.score));
    $('resultNote').textContent='單人挑戰 · 不發放銀幣';
    $('replayBtn').textContent='再挑戰一次 →';$('replayBtn').disabled=false;$('resultExit').textContent=session?'返回房間':'返回選單';
    show($('result'),true);$('replayBtn').focus();$('pauseBtn').disabled=true;persist();
  }
  function roomResult() {
    if(!room||resultRound===room.round)return;resultRound=room.round;completeRound();
    const self=room.results.find(r=>r.id===room.self),winners=room.results.filter(r=>r.rank===1),win=self?.rank===1;
    $('resultEyebrow').textContent=`BATTLE · ROUND ${room.round}`;$('resultMark').textContent=win?'✦':'↻';
    $('resultTitle').textContent=room.spectator?'本局觀戰結束':win?(winners.length>1?'勢均力敵，並列第一！':'最後一塊，由你決勝。'):'下一局，換你翻盤。';
    $('resultIntro').textContent=self?`本局第 ${self.rank} 名 · ${room.results.length} 人攻防`:'本局觀戰結束';
    $('resultStats').replaceChildren();stat($('resultStats'),'分數',decimal(self?.score||0));stat($('resultStats'),'消行',self?.lines||0);stat($('resultStats'),'送出攻擊',self?.attack||0);
    show($('resultStats'),!room.spectator);
    $('rankings').replaceChildren();
    for(const r of room.results){const row=document.createElement('div'),rank=document.createElement('b'),name=document.createElement('span'),summary=document.createElement('small');row.className='ranking'+(r.id===room.self?' self':'');rank.textContent=String(r.rank).padStart(2,'0');name.textContent=room.players.get(r.id).name+(r.id===room.self?' · 你':'');const paid=room.settlement?.awards?.find(a=>a.id===r.id);summary.textContent=paid?`+${decimal(paid.payout)} 銀幣 · ${r.attack} 攻擊`:`${r.attack} 攻擊 / ${decimal(r.score)} 分`;row.append(rank,name,summary);$('rankings').append(row);}
    const settlement=room.settlement,award=settlement?.awards?.find(a=>a.id===room.self);
    $('bestResult').textContent=room.verified?(settlement?.status==='PAID'?`已入帳 +${decimal(award?.payout||0)} 銀幣 · 本局加碼 ${decimal(room.stake)}`:room.aiLevels?.length?'AI 練習 · 伺服器計算結果':'伺服器已驗證排名'):'AI 本機練習 · 不發放銀幣';
    if(room.spectator)$('bestResult').textContent='免費觀戰 · 不參與加碼與獎勵';
    $('resultNote').textContent=settlement?.status==='PAID'?`獎池 ${decimal(settlement.pot)} 銀幣 · 無抽成 · 同名次平分` :settlement?.status==='REFUNDED'?settlement.reason:'本局加碼 0 · 不發放銀幣';
    const autoReturn=embedded&&!room.local;
    show($('replayBtn'),!autoReturn);$('replayBtn').textContent=room.local?'再練一次 →':'再戰一次 →';$('replayBtn').disabled=false;
    $('resultExit').className=autoReturn?'primary':'secondary';$('resultExit').textContent=autoReturn?'立即返回房間':room.local?'返回選單':'返回房間';
    show($('returnCountdown'),autoReturn);show($('result'),true);show($('menu'),false);clearInputs();sound(win?'win':'over');vibrate('heavy');
    if(autoReturn)startResultReturnCountdown();else{stopResultReturnCountdown();$('replayBtn').focus();}
    persist();
  }
  function updateLobby() {
    if(!room)return;
    $('lobbyPlayers').replaceChildren();
    for(const p of room.players.values()){
      const row=document.createElement('div'),name=document.createElement('span'),state=document.createElement('b');
      row.className='lobby-player'+(room.ready.has(p.id)||p.bot?' ready':'');name.textContent=p.name+(p.id===room.self?' · 你':'')+(p.id===room.host?' · 房主':'');state.textContent=p.bot?'AI 練習':!p.connected?'等待連線':room.ready.has(p.id)?'✓ 已確認':Object.hasOwn(room.proposals||{},p.id)?room.aiLevels?.length?'免費練習 · 已就緒':`提案 ${decimal(room.proposals[p.id])}`:'尚未確認';row.append(name,state);$('lobbyPlayers').append(row);
    }
    const roster=[...room.players.values()],humans=roster.filter(p=>!p.bot),bots=roster.filter(p=>p.bot),available=humans.filter(p=>p.connected),allReady=room.allReady??(humans.length>=2&&available.length===humans.length&&humans.every(p=>room.ready.has(p.id)));
    $('startBtn').textContent=room.isHost&&humans.length===1?'開始單人攻防 →':room.isHost&&allReady?'開始攻防 →':room.ready.has(room.self)?'已確認，等待其他玩家':bots.length&&humans.length<2?'確認免費 AI 對戰 →':room.stake?`確認加碼 ${decimal(room.stake)} 銀幣 →`:'確認 0 加碼 →';
    $('startBtn').disabled=room.recovering||(room.ready.has(room.self)&&!(room.isHost&&allReady));
    if(room.verified){$('startBtn').disabled=room.recovering||humans.length===1&&!room.isHost;$('startBtn').textContent=humans.length===1?'開始單人攻防 →':'開啟共用加碼與全員確認（可選 0）';}
    $('menuNote').textContent=room.recovering?'正在向伺服器自動重試同步；也可手動重試':`${humans.length} 位真人${bots.length?` · ${bots.length} 位 AI`:''} · ${humans.length===1?'單人免提案與加碼，直接開始':'真人依提案與確認結果開始'}`;
    renderProposalOptions();
    setupControls();
    if(room.spectator){$('menuTitle').textContent='觀戰爆爆方塊攻防';$('menuIntro').textContent='等待參賽者準備，開局後可選擇玩家視角。';$('startBtn').disabled=true;$('startBtn').textContent='等待玩家開局';$('menuNote').textContent='免費觀戰 · 點選玩家切換棋盤';show($('proposalOptions'),false);}
  }
  function renderProposalOptions(){
    const list=$('proposalOptions');if(!list)return;list.replaceChildren();
    if(!room?.verified||[...room.players.values()].filter(p=>!p.bot).length<2)return;
    const candidates=new Map();
    for(const [id,value] of Object.entries(room.proposals||{})){const amount=Number(value);if(!Number.isSafeInteger(amount)||amount<0)continue;if(!candidates.has(amount))candidates.set(amount,[]);candidates.get(amount).push(id);}
    const values=[...candidates.keys()].sort((a,b)=>a-b);
    if(!values.length){const empty=document.createElement('p');empty.className='proposal-empty';empty.textContent='尚無提案。送出後，每個有效金額都會列在這裡供全員選擇。';list.append(empty);return;}
    const humans=[...room.players.values()].filter(p=>!p.bot).length;
    for(const amount of values){
      const card=document.createElement('div'),copy=document.createElement('div'),title=document.createElement('b'),details=document.createElement('small'),button=document.createElement('button');
      card.className='proposal-option'+(amount===room.stake?' selected':'');title.textContent=`每人 ${decimal(amount)} 銀幣`;
      const names=candidates.get(amount).map(id=>room.players.get(id)?.name||'玩家');details.textContent=`${names.join('、')} · ${names.length}/${humans} 票${amount===room.stake?' · 目前票選':''}`;
      button.type='button';button.className='proposal-pick';button.textContent=Number(room.proposals?.[room.self])===amount?'你的提案':'採用此提案';button.disabled=room.recovering||Number(room.proposals?.[room.self])===amount;
      button.addEventListener('click',()=>{if(!room||room.recovering)return;$('stakeAmount').value=String(amount);$('stakeRange').value=String(amount);room.vote(amount);});
      copy.append(title,details);card.append(copy,button);list.append(card);
    }
  }
  let settingsKey='';
  const aiSelection=()=>[...$('aiLevels').querySelectorAll('select')].map(el=>Number(el.value));
  function aiRows(levels){
    $('aiLevels').replaceChildren();levels.forEach((level,i)=>{const label=document.createElement('label'),select=document.createElement('select');label.textContent=`AI ${i+1} `;select.setAttribute('aria-label',`AI ${i+1} 等級`);for(let n=1;n<=9;n++){const option=document.createElement('option');option.value=n;option.textContent=`Lv.${n}`;select.append(option);}select.value=level;select.disabled=!!room&&(room.verified||!room.isHost);select.addEventListener('change',()=>room?.configure?.(aiSelection()));label.append(select);$('aiLevels').append(label);});
  }
  function setupControls(){
    if(room?.spectator){for(const id of ['aiSettings','wagerSettings','soloBtn'])show($(id),false);return;}
    $('aiHeading').textContent=room?.verified?'房間 AI · 返回房間調整':'AI 練習';
    const supports=room?.verified||room?.local,offline=!room&&mode==='ai';show($('aiSettings'),!!supports||offline);show($('wagerSettings'),false);
    if(supports||offline){const max=room?10-[...room.players.values()].filter(p=>!p.bot).length:9,levels=room?.aiLevels||[5],key=(room?.local?'local':room?.verified?'server':'offline')+'|'+max+'|'+levels.join(',');
      if(key!==settingsKey){settingsKey=key;$('aiCount').replaceChildren();for(let n=offline?1:0;n<=max;n++){const option=document.createElement('option');option.value=n;option.textContent=n+' 位';$('aiCount').append(option);}$('aiCount').value=levels.length;aiRows(levels);}$('aiCount').disabled=!!room&&(room.verified||!room.isHost);
    }
    if(room?.verified&&[...room.players.values()].filter(p=>!p.bot).length>=2){const humans=[...room.players.values()].filter(p=>!p.bot).length,cap=room.limit;$('stakeAmount').max=cap;$('stakeRange').max=cap;const amount=Math.min(cap,Math.max(0,Number($('stakeAmount').value)||0));$('stakeAmount').value=amount;$('stakeRange').value=amount;$('voteBtn').disabled=room.recovering;$('voteBtn').textContent='送出提案';$('stakeAmount').disabled=$('stakeRange').disabled=false;$('stakeLabel').textContent=`每位真人 ${decimal(room.stake)} · 獎池 ${decimal(room.stake*humans)}`;$('stakeLimit').textContent=`入場費 100 已另行收取 · 目前錢包 ${room.ownBalance==null?'讀取中':decimal(room.ownBalance)} 銀幣 · 全房真人可加碼 0–${decimal(cap)} 銀幣`;}
    show($('soloBtn'),false);
  }
  function roomChanged() {
    if(!room)return;
    if(room.spectator){
      engine=null;clearInputs();
      if(['countdown','playing'].includes(room.phase)){
        if(activeRound!==room.round){activeRound=room.round;resultRound=-1;target=null;countPlayed=-1;}
        show($('menu'),false);show($('result'),false);$('pauseBtn').disabled=true;
        $('modeLabel').textContent='SPECTATE';$('roundLabel').textContent=`ROUND ${room.round} · 3 MIN`;
        render();return;
      }
    }
    if(['countdown','playing'].includes(room.phase)){
      if(activeRound!==room.round || !engine){
        activeRound=room.round;resultRound=-1;completionSent=false;paused=false;clearInputs();
        countPlayed = -1;
        const resume=room.ownEngine||(saved?.round===room.round?Engine.restore(saved.engine):null);
        const hasAlreadyPlayed=room.players.get(room.self)?.seq>0;
        engine=resume||new Engine({seed:room.seedForRound,mode:'battle'});
        if(!resume&&hasAlreadyPlayed){engine.finish('restore-missing');room.forfeit();toast('本局存檔無法恢復，已轉為觀戰');}
        if(resume && Array.isArray(saved?.received))room.received=new Set(saved.received.filter(k=>typeof k==='string').slice(-20000));
        room.stateSeq=Math.max(room.stateSeq,saved?.round===room.round?saved.stateSeq||0:0);
        room.attackSeq=Math.max(room.attackSeq,saved?.round===room.round?saved.attackSeq||0:0);
        saved=null;musicStep=0;lastFrame=performance.now();
      }
      if(room.ownEngine){const before=engine?.pendingGarbage||0;engine=room.local?room.ownEngine:room.predicted();if(engine.pendingGarbage>before){sound('incoming');vibrate('medium');}lastFrame=performance.now();}
      show($('menu'),false);show($('result'),false);$('pauseBtn').disabled=true;
      $('modeLabel').textContent='BATTLE';$('roundLabel').textContent=`ROUND ${room.round} · 3 MIN`;
      const self=room.players.get(room.self);
      if (room.phase==='playing' && countPlayed!==0) { countPlayed=0;sound('go');feedback('GO!'); }
      if(self && !self.alive && engine.status==='playing')engine.finish('eliminated');
    } else if(room.phase==='results'){
      roomResult();
      if (!$('menu').hidden) updateLobby();
    }
    else if(['interrupted','ended'].includes(room.phase)){
      clearInputs();show($('menu'),true);show($('result'),false);show($('modeOptions'),false);show($('lobbyPlayers'),false);show($('miniRules'),false);
      $('menuTitle').textContent=room.phase==='ended'?'對局已結束':'對局同步中斷';$('menuIntro').textContent=room.settlement?.reason||'這場攻防已中斷，請返回房間重新開局。';$('startBtn').disabled=true;$('startBtn').textContent='本局無法繼續';$('menuNote').textContent='可使用右上方返回按鈕離開';
    }else updateLobby();
    render();
  }
  function renderRivals() {
    if(!room){show($('rivalsTile'),false);return;}
    show($('rivalsTile'),true);
    const opponents=[...room.players.values()].filter(p=>p.id!==room.self),ids=opponents.map(p=>p.id).join(',');
    if(ids!==builtRivals){
      $('rivals').replaceChildren();builtRivals=ids;
      for(const p of opponents){
        const button=document.createElement('button'),name=document.createElement('span'),canvas=document.createElement('canvas'),info=document.createElement('small'),label=document.createElement('span');
        button.className='rival';button.dataset.player=p.id;button.title='攻擊 '+p.name;button.setAttribute('aria-label','選擇攻擊對手 '+p.name);
        canvas.width=60;canvas.height=120;name.textContent=p.name;label.className='target-label';button.append(name,canvas,info,label);
        button.addEventListener('click',()=>{if(!room.players.get(p.id)?.alive)return;target=p.id;if(canPlay())room.selectTarget?.(target);vibrate('selection');render();});$('rivals').append(button);
      }
    }
    if(!room.players.get(target)?.alive||target===room.self)target=opponents.find(p=>p.alive)?.id||opponents.find(p=>p.view)?.id||null;
    for(const button of $('rivals').children){const p=room.players.get(button.dataset.player),selected=target===p.id;button.title=(isWatching()?'觀看 ':'攻擊 ')+p.name;button.setAttribute('aria-label',(isWatching()?'觀戰玩家 ':'選擇攻擊對手 ')+p.name);button.classList.toggle('target',selected);button.classList.toggle('out',!p.alive);button.setAttribute('aria-pressed',String(selected));button.querySelector('small').textContent=!p.connected?'同步中':!p.alive?'已淘汰':`${p.view?.lines||0} 行`;button.querySelector('.target-label').textContent=selected?(isWatching()?'◎ 正在觀看':'◎ 攻擊目標'):'';const canvas=button.querySelector('canvas');if(canvas.clientWidth)drawBoard(canvas,p.view);}
    $('aliveCount').textContent=`${[...room.players.values()].filter(p=>p.alive).length} 人存活`;
    $('targetHint').textContent=target?(isWatching()?'觀看 · ':'目標 · ')+room.players.get(target).name:'等待玩家開局';
  }
  const isWatching=()=>!!room&&(room.spectator||['countdown','playing'].includes(room.phase)&&!room.players.get(room.self)?.alive);
  let viewCache=null;
  function render() {
    if(disposed)return;
    renderRivals();
    const observing=isWatching(),watched=observing?room.players.get(target)?.view:null;
    document.body.classList.toggle('spectator-mode',observing);
    if(engine||watched){
      // Main rendering uses the current board directly; snapshots copy only when sent.
      const confirmed=room?.verified?room.ownEngine:null;
      const view=observing?room.players.get(target)?.view:{board:confirmed?.board||engine.board,active:engine.active,status:engine.status};
      const stats=observing?{...watched,queue:watched?.next||[],pendingGarbage:watched?.pending||0}:engine;
      const confirmedStats=confirmed||stats;
      drawBoard($('board'),view,!observing,confirmed?engine.board:null);
      if (room) $('playerName').textContent=observing?'觀戰 · '+(room.players.get(target)?.name||'等待對手'):room.players.get(room.self)?.name||'你';
      $('score').textContent=decimal(confirmedStats.score||0);$('lines').textContent=room?confirmedStats.lines||0:`${stats.lines} / ${mode==='sprint'?40:150}`;
      $('level').textContent=String(confirmedStats.level||1).padStart(2,'0');$('elapsed').textContent=room?formatTime(room.endAt-clock()):formatTime(engine.elapsed);$('attack').textContent=String(confirmedStats.attack||0);
      $('garbageFill').style.height=Math.min(100,confirmedStats.pendingGarbage/20*100)+'%';$('garbageCount').textContent=String(confirmedStats.pendingGarbage);
      document.querySelector('.hold-tile').classList.toggle('used',!observing&&!engine.canHold);
      const previewKey=stats.hold+'|'+stats.queue.slice(0,5).join();if(previewKey!==viewCache){viewCache=previewKey;preview($('holdCanvas'),[stats.hold],true);preview($('nextCanvas'),stats.queue.slice(0,5));}
    }else{drawBoard($('board'),null);preview($('holdCanvas'),[],true);preview($('nextCanvas'),observing?[]:['T','I','S','O','L']);if(observing){$('playerName').textContent='觀戰 · 等待玩家開局';for(const id of ['score','lines','attack','garbageCount'])$(id).textContent='0';$('garbageFill').style.height='0%';}}
    if(room?.recovering&&['countdown','playing'].includes(room.phase)){showBoardOverlay('','');$('liveStatus').textContent='連線恢復中 · 暫停輸入';}
    else if(room?.phase==='countdown'){const n=Math.max(1,Math.ceil((room.startAt-clock())/1000));if(countPlayed!==n){countPlayed=n;sound('count');vibrate('light');}showBoardOverlay(String(n),'全員同一方塊序列 · 準備攻防');$('liveStatus').textContent='倒數開始';}
    else if(room?.phase==='playing'&&observing){showBoardOverlay('觀戰中','點選玩家，切換觀戰棋盤。');$('liveStatus').textContent=room.spectator?'免費觀戰':'已淘汰 · 觀戰';}
    else if(session&&sdk.status!=='PLAYING'){showBoardOverlay('對局結束','請返回房間重新開始。');$('liveStatus').textContent='對局已結束';}
    else if(paused){showBoardOverlay('暫停','調整呼吸，接著挑戰。',true);$('liveStatus').textContent='已暫停';}
    else{showBoardOverlay('','');$('liveStatus').textContent=canPlay()?(room?'攻防進行中':'挑戰進行中'):'準備好就開始';}
    if(!room?.recovering&&room?.correctionUntil>performance.now())$('liveStatus').textContent='已依伺服器狀態校準';
    else if(!room?.recovering&&room?.verified&&room.pending?.length)$('liveStatus').textContent='本機操作預測中 · 等伺服器確認';
    for(const b of document.querySelectorAll('[data-action]'))b.disabled=!canPlay();
    $('boardOverlay').classList.toggle('spectating',!!room&&room.phase==='playing'&&observing&&!room.recovering);
  }
  function pause(value) {
    if(room||!engine||engine.status!=='playing'){if(room)toast('多人攻防無法暫停');return;}
    paused=value;clearInputs();lastFrame=performance.now();$('pauseBtn').setAttribute('aria-label',paused?'繼續':'暫停');render();persist();
  }
  function returnMenu() {
    stopResultReturnCountdown();engine=null;paused=false;clearInputs();show($('result'),false);show($('menu'),true);$('pauseBtn').disabled=true;
    $('menuTitle').textContent='每一塊，都能翻盤。';$('menuIntro').textContent='堆疊你的節奏，消除你的極限。';$('startBtn').textContent='開始挑戰 →';$('startBtn').disabled=false;render();
  }
  function leave() {
    stopResultReturnCountdown();
    if(embedded){
      if(!sdk?.isReady){toast('尚未連上房間，請用 APP 返回按鈕離開');return;}
      room?.forfeit();persist();exiting=true;clearInputs();
      if(!sdk.leaveGame()){exiting=false;toast('返回失敗，請用 APP 返回按鈕重試');if(room?.phase==='results')$('returnCountdown').textContent='返回未確認，請按「立即返回房間」重試';}
      else toast('正在返回房間…');
    }else{persist();room?.dispose();room=null;builtRivals='';returnMenu();show($('modeOptions'),true);show($('lobbyPlayers'),false);show($('miniRules'),true);setupControls();}
  }
  function newGame() {
    unlockAudio();
    if(room?.verified){const humans=[...room.players.values()].filter(p=>!p.bot);if(humans.length===1){room.start();return;}if(window.BoomRoomWagerUI?.open)window.BoomRoomWagerUI.open();else toast('共用加碼介面載入中，請稍候。');return;}
    if(room){if(room.isHost&&(room.allReady??[...room.players.values()].filter(p=>p.connected).every(p=>room.ready.has(p.id))))room.start();else room.setReady();updateLobby();}
    else if(mode==='ai'){room=new window.TetrisAuthority.PracticeRoom(aiSelection(),{changed:roomChanged,notice:toast});$('sessionTag').textContent='AI 本機練習';room.setReady();room.start();show($('modeOptions'),false);show($('lobbyPlayers'),true);}
    else startSolo();
  }
  async function initializeOnline() {
    const epoch=++bootEpoch;
    show($('modeOptions'),false);show($('miniRules'),false);$('menuTitle').textContent='正在進入競技場';$('menuIntro').textContent='等候 BoomRoom 對局與參賽者資料…';$('startBtn').disabled=true;$('startBtn').textContent='載入對局中';$('menuNote').textContent='';show($('syncBtn'),true);
    try {
      session=await sdk.whenReady({timeoutMs:15000});if(disposed||epoch!==bootEpoch)return;
      selfId = sdk.getUser().id;
      if(session.status!=='PLAYING'){
        $('menuTitle').textContent='對局已結束';$('menuIntro').textContent='請返回房間重新開始。';$('startBtn').textContent='本局無法繼續';return;
      }
      saved=read(storageKey());if(saved?.version!==1||Date.now()-saved.savedAt>86400000)saved=null;
      $('playerName').textContent=sdk.getUser().username||'你';$('sessionTag').textContent='房間 '+sdk.roomId;
      cleanups.push(sdk.onError(error=>toast('SDK：'+({TRANSPORT_UNAVAILABLE:'連線無法送出',SESSION_UNAVAILABLE:'對局已停止'}[error.code]||error.code))));
      if(session.engine==='TETRIS'||session.players.length>=2){
        room=session.engine==='TETRIS'?new window.TetrisAuthority.AuthorityRoom(sdk,{changed:roomChanged,notice:toast}):new window.TetrisBattleRoom.Room(sdk,{changed:roomChanged,notice:toast,garbage:(lines,hole)=>{engine?.receiveGarbage(lines,hole);processEvents();persist();render();}});
        if(saved?.room)room.restore(saved.room);
        $('modeLabel').textContent='BATTLE';$('menuEyebrow').textContent='STACK. CLEAR. ATTACK.';$('menuTitle').textContent='把消行，變成攻擊。';$('menuIntro').textContent='1–10 位真人與可選 AI 方塊攻防。單人直接開始；多人由真人提案確認。';
        show($('lobbyPlayers'),true);$('miniRules').textContent='每局 3 分鐘 · 點選對手指定攻擊 · 淘汰後觀戰';show($('miniRules'),true);
        roomChanged();if(!room.spectator)room.sync();
      }else{
        show($('modeOptions'),true);show($('miniRules'),true);$('menuTitle').textContent='一個人，也能突破。';$('menuIntro').textContent='選擇單人挑戰，鍛鍊下一場攻防的節奏。';$('startBtn').textContent='開始挑戰 →';$('startBtn').disabled=false;$('menuNote').textContent='房間單人挑戰 · 本局可自由再玩';
        const restore=saved?.engine?Engine.restore(saved.engine):null;
        if(restore?.status==='playing'){startSolo(restore);pause(true);toast('已恢復你的單人挑戰');}
        cleanups.push(sdk.onSessionEnd(()=>{pause(true);toast('房間對局已結束，請返回房間');}));
        show($('syncBtn'),false);
      }
    }catch(error){
      if(epoch!==bootEpoch||disposed)return;
      $('menuTitle').textContent='對局載入逾時';$('menuIntro').textContent='請重試同步，或使用 APP 返回房間重新開始。';$('startBtn').textContent='等待有效對局';$('menuNote').textContent=error.code||error.message;show($('syncBtn'),true);
    }
  }
  function advance(time) {
    room?.pump?.();
    const delta=Math.max(0,time-lastFrame);lastFrame=time;
    if(canPlay()){const soft=[...inputs.values()].some(input=>input.kind==='soft'),y=engine.active?.y;engine.advance(delta,soft);if(soft&&engine.active?.y!==y&&time-lastSoftSound>=110){lastSoftSound=time;sound('move');}repeat(time);processEvents();music(time);}
    if(room&&engine&&time-lastPublish>=300&&room.phase==='playing'&&!room.recovering)publish();
    if(time-lastSave>=1000){lastSave=time;persist();}
  }
  function frame(time) { if(disposed)return;advance(time);render();raf=requestAnimationFrame(frame); }
  const keymap={ArrowLeft:'left',ArrowRight:'right',ArrowDown:'soft',ArrowUp:'cw',KeyX:'cw',KeyZ:'ccw',KeyC:'hold',ShiftLeft:'hold',ShiftRight:'hold',Space:'hard'};
  on(window,'keydown',event=>{
    if(event.target.matches?.('input,textarea,select')||event.ctrlKey||event.metaKey||event.altKey)return;
    unlockAudio();
    if(event.code==='KeyP'||event.code==='Escape'){
      if(!$('help').hidden){show($('help'),false);if(helpPaused)pause(false);helpPaused=false;}
      else if(!event.repeat)pause(!paused);return;
    }
    const kind=keymap[event.code];if(!kind||!canPlay())return;event.preventDefault();if(event.repeat)return;press(kind,event.code);
  });
  on(window,'keyup',event=>releaseInput(event.code));
  on(window,'blur',()=>{clearInputs();if(!room&&canPlay())pause(true);});
  on(document,'visibilitychange',()=>{clearInputs();if(document.hidden){if(!room&&canPlay())pause(true);persist();}else{room?.sync();lastFrame=performance.now();}});
  on(document,'pointerdown',unlockAudio,{passive:true});
  for(const button of document.querySelectorAll('[data-action]')){
    on(button,'pointerdown',event=>{if(button.disabled)return;event.preventDefault();button.setPointerCapture(event.pointerId);button.classList.add('pressed');press(button.dataset.action,'pointer:'+event.pointerId);});
    const release=event=>{releaseInput('pointer:'+event.pointerId);button.classList.remove('pressed');};
    on(button,'pointerup',release);on(button,'pointercancel',release);on(button,'lostpointercapture',release);
    on(button,'click',event=>{if(event.detail===0)action(button.dataset.action);});
  }
  on($('board'),'pointerdown',event=>{if(!canPlay())return;event.preventDefault();$('board').setPointerCapture(event.pointerId);gesture={id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,moved:false};});
  on($('board'),'pointermove',event=>{if(!gesture||gesture.id!==event.pointerId||!canPlay())return;const unit=$('board').clientWidth/10;const dx=event.clientX-gesture.lastX;if(Math.abs(dx)>=unit){const steps=Math.min(10,Math.floor(Math.abs(dx)/unit));for(let i=0;i<steps;i++)action(dx>0?'right':'left');gesture.lastX+=Math.sign(dx)*steps*unit;gesture.moved=true;}});
  on($('board'),'pointerup',event=>{if(!gesture||gesture.id!==event.pointerId)return;const dy=event.clientY-gesture.y;if(dy>=70)action('hard');else if(dy>=20)action('soft');else if(!gesture.moved&&Math.hypot(event.clientX-gesture.x,dy)<15)action('cw');gesture=null;});
  on($('board'),'pointercancel',()=>gesture=null);
  on($('startBtn'),'click',newGame);
  on($('soloBtn'),'click',()=>{room?.dispose();room=null;engine=null;mode='marathon';builtRivals='';returnMenu();show($('modeOptions'),true);show($('lobbyPlayers'),false);$('menuIntro').textContent='單人挑戰或本機 AI 練習，不建立加碼獎池。';setupControls();});
  on($('aiCount'),'change',()=>{const old=aiSelection(),levels=Array.from({length:Number($('aiCount').value)},(_,i)=>old[i]||5);aiRows(levels);room?.configure?.(levels);});
  on($('stakeRange'),'input',()=>{$('stakeAmount').value=$('stakeRange').value;});
  on($('stakeAmount'),'input',()=>{$('stakeRange').value=$('stakeAmount').value;});
  on($('voteBtn'),'click',()=>{const amount=Number($('stakeAmount').value);if(!Number.isSafeInteger(amount)||amount<0||amount>room.limit){toast('請輸入全員可負擔的整數金額');return;}room.vote(amount);});
  on($('replayBtn'),'click',()=>{if(room){if(!room.verified&&!room.local)room.setReady();show($('result'),false);show($('menu'),true);$('menuTitle').textContent='再來一場，繼續練習。';updateLobby();}else startSolo();});
  on($('exitBtn'),'click',leave);on($('resultExit'),'click',leave);on($('syncBtn'),'click',()=>{if(room)room.sync();else if(embedded)initializeOnline();});
  on($('pauseBtn'),'click',()=>pause(!paused));on($('resumeBtn'),'click',()=>pause(false));
  on($('reconnectBtn'),'click',()=>room?.sync());
  on($('helpBtn'),'click',()=>{helpPaused=!room&&canPlay();if(helpPaused)pause(true);show($('help'),true);$('closeHelp').focus();});
  on($('closeHelp'),'click',()=>{show($('help'),false);if(helpPaused)pause(false);helpPaused=false;});
  for(const key of ['sound','music','haptic'])on($(key+'Btn'),'click',()=>togglePreference(key));
  sdk?.configureGameUi({help:()=>{helpPaused=!room&&canPlay();if(helpPaused)pause(true);show($('help'),true);$('closeHelp').focus();},settings:['sound','music','haptic'].map(key=>({label:{sound:'遊戲音效',music:'遊戲音樂',haptic:'遊戲震動'}[key],get:()=>preferences[key],set:value=>{preferences[key]=value;write('tb36:preferences',preferences);preferenceUI();}}))});
  for(const button of document.querySelectorAll('[data-mode]'))on(button,'click',()=>{mode=button.dataset.mode;for(const item of document.querySelectorAll('[data-mode]')){item.classList.toggle('selected',item===button);item.setAttribute('aria-pressed',String(item===button));}setupControls();});
  on(document,'keydown',event=>{
    if(event.key!=='Tab')return;
    const modal=[$('help'),$('result'),$('menu')].find(el=>!el.hidden);if(!modal)return;
    const focusable=[...modal.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')].filter(el=>el.getClientRects().length);
    if(!focusable.length)return;const first=focusable[0],last=focusable.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  });
  on(window,'resize',()=>{viewCache=null;render();});
  on(window,'pagehide',event=>{
    persist();clearInputs();if(event.persisted){if(!room&&canPlay())pause(true);audio?.suspend().catch(()=>{});return;}
    disposed=true;++bootEpoch;cancelAnimationFrame(raf);clearInterval(heartbeat);clearTimeout(toastTimer);clearTimeout(feedbackTimer);stopResultReturnCountdown();
    room?.dispose();for(const off of cleanups)off();audio?.close().catch(()=>{});
  });
  on(window,'pageshow',event=>{if(event.persisted){lastFrame=performance.now();room?.sync();render();}});
  preferenceUI();show($('rivalsTile'),false);render();
  if(embedded)initializeOnline();
  else{saved=read(storageKey());const restored=saved?.version===1&&Date.now()-saved.savedAt<86400000?Engine.restore(saved.engine):null;if(restored?.status==='playing'){mode=restored.mode;startSolo(restored);pause(true);toast('已恢復上次的單人挑戰');}}
  heartbeat=setInterval(()=>{if(disposed)return;if(document.hidden&&room)advance(performance.now());room?.tick();},200);
  raf=requestAnimationFrame(frame);
})();
