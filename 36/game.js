(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const rules = window.TetrisBattleEngine, { Engine } = rules;
  const sdk = window.BoomRoomSDK;
  const embedded = window.parent !== window || new URL(location.href).searchParams.get('boomroomHost') === '1';
  const colors = ['','#55dbea','#f0d56a','#b394f5','#7bdb9e','#ee718a','#669ff4','#eda776','#7d8b9e'];
  const inputs = new Map(), cleanups = [];
  let engine = null, room = null, session = null, mode = 'marathon', paused = false, helpPaused = false;
  let lastFrame = performance.now(), lastPublish = 0, lastSave = 0, builtRivals = '', target = null;
  let activeRound = 0, resultRound = -1, completionSent = false, exiting = false, disposed = false;
  let toastTimer = 0, feedbackTimer = 0, clearFlash = null, bootEpoch = 0, saved = null;
  let selfId = null;
  let countPlayed = -1;
  let soundBus = null, musicBus = null;
  let raf = 0, heartbeat = 0, audio = null, musicStep = 0, lastMusic = 0, gesture = null;
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
  function drawBoard(canvas,view,local=false) {
    const width=canvas.clientWidth||300,height=width*2,unit=width/10,ctx=canvasSize(canvas,width,height);
    ctx.fillStyle='#080f1e';ctx.fillRect(0,0,width,height);
    ctx.strokeStyle='#26365155';ctx.lineWidth=.5;
    for(let x=1;x<10;x++){ctx.beginPath();ctx.moveTo(x*unit,0);ctx.lineTo(x*unit,height);ctx.stroke();}
    for(let y=1;y<20;y++){ctx.beginPath();ctx.moveTo(0,y*unit);ctx.lineTo(width,y*unit);ctx.stroke();}
    if(!view)return;
    view.board.slice(2).forEach((row,y)=>row.forEach((value,x)=>{if(value)block(ctx,x*unit,y*unit,unit,colors[value]);}));
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
    show($('reconnectBtn'),title==='同步中');
  }
  function canPlay() {
    return !!engine && engine.status==='playing' && !paused && !exiting && !disposed &&
      (!session || sdk.status==='PLAYING') &&
      (!room || room.phase==='playing' && !room.recovering && room.players.get(room.self)?.alive);
  }
  function clearInputs() { inputs.clear();for(const b of document.querySelectorAll('[data-action]'))b.classList.remove('pressed'); }
  function action(kind) {
    if(!canPlay())return;
    let success=false;
    if(kind==='left'||kind==='right'){success=engine.move(kind==='left'?-1:1);if(success)sound('move');}
    else if(kind==='cw'||kind==='ccw')success=engine.rotate(kind==='cw'?1:-1);
    else if(kind==='hold')success=engine.swapHold();
    else if(kind==='hard')success=engine.hardDrop();
    else if(kind==='soft')success=engine.drop(true);
    if(success)vibrate(kind==='hard'?'medium':'selection');
    processEvents();if(room && success && kind!=='soft' && kind!=='left' && kind!=='right')publish();
    render();
  }
  function press(kind,source) {
    if(inputs.has(source))return;
    action(kind);inputs.set(source,{kind,start:performance.now(),last:performance.now()});
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
    if(!engine && !room)return;
    write(storageKey(),{ version:1,savedAt:Date.now(),round:activeRound,engine:engine?.save()||null,
      room:room?.snapshot()||null,received:room?[...room.received]:[],stateSeq:room?.stateSeq||0,attackSeq:room?.attackSeq||0 });
  }
  function completeRound() {
    if(completionSent)return;completionSent=true;
    if(session && sdk.status==='PLAYING')sdk.completeRound(engine?.score||0);
  }
  function stat(parent,label,value) {
    const tile=document.createElement('div'),b=document.createElement('b'),span=document.createElement('span');
    tile.className='result-stat';b.textContent=value;span.textContent=label;tile.append(b,span);parent.append(tile);
  }
  function soloResult() {
    if(!engine)return;
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
    $('replayBtn').textContent='再挑戰一次 →';$('replayBtn').disabled=false;$('resultExit').textContent=session?'返回房間':'返回選單';
    show($('result'),true);$('replayBtn').focus();$('pauseBtn').disabled=true;persist();
  }
  function roomResult() {
    if(!room||resultRound===room.round)return;resultRound=room.round;completeRound();
    const self=room.results.find(r=>r.id===room.self),winners=room.results.filter(r=>r.rank===1),win=self?.rank===1;
    $('resultEyebrow').textContent=`BATTLE · ROUND ${room.round}`;$('resultMark').textContent=win?'✦':'↻';
    $('resultTitle').textContent=win?(winners.length>1?'勢均力敵，並列第一！':'最後一塊，由你決勝。'):'下一局，換你翻盤。';
    $('resultIntro').textContent=self?`本局第 ${self.rank} 名 · ${room.results.length} 人攻防`:'本局觀戰結束';
    $('resultStats').replaceChildren();stat($('resultStats'),'分數',decimal(self?.score||0));stat($('resultStats'),'消行',self?.lines||0);stat($('resultStats'),'送出攻擊',self?.attack||0);
    $('rankings').replaceChildren();
    for(const r of room.results){const row=document.createElement('div'),rank=document.createElement('b'),name=document.createElement('span'),summary=document.createElement('small');row.className='ranking'+(r.id===room.self?' self':'');rank.textContent=String(r.rank).padStart(2,'0');name.textContent=room.players.get(r.id).name+(r.id===room.self?' · 你':'');summary.textContent=`${r.attack} 攻擊 / ${decimal(r.score)} 分`;row.append(rank,name,summary);$('rankings').append(row);}
    $('bestResult').textContent='房間娛樂對戰 · 成績未經規則伺服器驗證';$('replayBtn').textContent='準備再戰 →';$('replayBtn').disabled=false;$('resultExit').textContent='返回房間';
    show($('result'),true);show($('menu'),false);clearInputs();sound(win?'win':'over');vibrate('heavy');$('replayBtn').focus();persist();
  }
  function updateLobby() {
    if(!room)return;
    $('lobbyPlayers').replaceChildren();
    for(const p of room.players.values()){
      const row=document.createElement('div'),name=document.createElement('span'),state=document.createElement('b');
      row.className='lobby-player'+(room.ready.has(p.id)?' ready':'');name.textContent=p.name+(p.id===room.self?' · 你':'')+(p.id===room.host?' · 房主':'');state.textContent=!p.connected?'等待連線':room.ready.has(p.id)?'✓ 已準備':'尚未準備';row.append(name,state);$('lobbyPlayers').append(row);
    }
    const available=[...room.players.values()].filter(p=>p.connected),allReady=available.length>=2&&available.every(p=>room.ready.has(p.id));
    $('startBtn').textContent=room.isHost&&allReady?'開始攻防 →':room.ready.has(room.self)?'已準備，等待其他玩家':'我準備好了 →';
    $('startBtn').disabled=room.recovering||(room.ready.has(room.self)&&!(room.isHost&&allReady));
    $('menuNote').textContent=room.recovering?'正在等待房主同步；可按重試同步':`${available.length}/${room.players.size} 位參賽者 · 全員準備後由房主開始`;
  }
  function roomChanged() {
    if(!room)return;
    if(['countdown','playing'].includes(room.phase)){
      if(activeRound!==room.round || !engine){
        activeRound=room.round;resultRound=-1;completionSent=false;paused=false;clearInputs();
        countPlayed = -1;
        const resume=saved?.round===room.round?Engine.restore(saved.engine):null;
        const hasAlreadyPlayed=room.players.get(room.self)?.seq>0;
        engine=resume||new Engine({seed:room.seedForRound,mode:'battle'});
        if(!resume&&hasAlreadyPlayed){engine.finish('restore-missing');room.forfeit();toast('本局存檔無法恢復，已轉為觀戰');}
        if(resume && Array.isArray(saved.received))room.received=new Set(saved.received.filter(k=>typeof k==='string').slice(-20000));
        room.stateSeq=Math.max(room.stateSeq,saved?.round===room.round?saved.stateSeq||0:0);
        room.attackSeq=Math.max(room.attackSeq,saved?.round===room.round?saved.attackSeq||0:0);
        saved=null;musicStep=0;lastFrame=performance.now();
      }
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
      $('menuTitle').textContent=room.phase==='ended'?'對局已結束':'房主已離開對局';$('menuIntro').textContent='這場攻防已中斷，請返回房間重新開局。';$('startBtn').disabled=true;$('startBtn').textContent='本局無法繼續';$('menuNote').textContent='可使用右上方返回按鈕離開';
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
        button.addEventListener('click',()=>{if(!p.alive)return;target=p.id;vibrate('selection');renderRivals();});$('rivals').append(button);
      }
    }
    if(!room.players.get(target)?.alive||target===room.self)target=opponents.find(p=>p.alive)?.id||null;
    for(const button of $('rivals').children){const p=room.players.get(button.dataset.player),selected=target===p.id;button.classList.toggle('target',selected);button.classList.toggle('out',!p.alive);button.setAttribute('aria-pressed',String(selected));button.querySelector('small').textContent=!p.connected?'同步中':!p.alive?'已淘汰':`${p.view?.lines||0} 行`;button.querySelector('.target-label').textContent=selected?'◎ 攻擊目標':'';const canvas=button.querySelector('canvas');if(canvas.clientWidth)drawBoard(canvas,p.view);}
    $('aliveCount').textContent=`${[...room.players.values()].filter(p=>p.alive).length} 人存活`;
    $('targetHint').textContent=target?'目標 · '+room.players.get(target).name:'等待對手';
  }
  let viewCache=null;
  function render() {
    if(disposed)return;
    if(engine){
      // Main rendering uses the current board directly; snapshots copy only when sent.
      const observing=room?.phase==='playing'&&!room.players.get(room.self).alive;
      const view=observing?room.players.get(target)?.view:{board:engine.board,active:engine.active,status:engine.status};
      drawBoard($('board'),view,!observing);
      if (room) $('playerName').textContent=observing?'觀戰 · '+(room.players.get(target)?.name||'等待對手'):room.players.get(room.self).name;
      $('score').textContent=decimal(engine.score);$('lines').textContent=room?engine.lines:`${engine.lines} / ${mode==='sprint'?40:150}`;
      $('level').textContent=String(engine.level).padStart(2,'0');$('elapsed').textContent=room?formatTime(room.endAt-clock()):formatTime(engine.elapsed);$('attack').textContent=String(engine.attack);
      $('garbageFill').style.height=Math.min(100,engine.pendingGarbage/20*100)+'%';$('garbageCount').textContent=String(engine.pendingGarbage);
      document.querySelector('.hold-tile').classList.toggle('used',!engine.canHold);
      const previewKey=engine.hold+'|'+engine.queue.slice(0,5).join();if(previewKey!==viewCache){viewCache=previewKey;preview($('holdCanvas'),[engine.hold],true);preview($('nextCanvas'),engine.queue.slice(0,5));}
    }else{drawBoard($('board'),null);preview($('nextCanvas'),['T','I','S','O','L']);}
    if(room?.recovering&&['countdown','playing'].includes(room.phase)){showBoardOverlay('同步中','等待房主回應。對局暫停操作，請重試同步。');$('liveStatus').textContent='等待同步';}
    else if(room?.phase==='countdown'){const n=Math.max(1,Math.ceil((room.startAt-clock())/1000));if(countPlayed!==n){countPlayed=n;sound('count');vibrate('light');}showBoardOverlay(String(n),'全員同一方塊序列 · 準備攻防');$('liveStatus').textContent='倒數開始';}
    else if(room?.phase==='playing'&&!room.players.get(room.self).alive){showBoardOverlay('觀戰中','點選右側對手，切換觀戰棋盤。');$('liveStatus').textContent='已淘汰 · 觀戰';}
    else if(session&&sdk.status!=='PLAYING'){showBoardOverlay('對局結束','請返回房間重新開始。');$('liveStatus').textContent='對局已結束';}
    else if(paused){showBoardOverlay('暫停','調整呼吸，接著挑戰。',true);$('liveStatus').textContent='已暫停';}
    else{showBoardOverlay('','');$('liveStatus').textContent=canPlay()?(room?'攻防進行中':'挑戰進行中'):'準備好就開始';}
    renderRivals();for(const b of document.querySelectorAll('[data-action]'))b.disabled=!canPlay();
    $('boardOverlay').classList.toggle('spectating',!!room&&room.phase==='playing'&&!room.players.get(room.self).alive&&!room.recovering);
  }
  function pause(value) {
    if(room||!engine||engine.status!=='playing'){if(room)toast('多人攻防無法暫停');return;}
    paused=value;clearInputs();lastFrame=performance.now();$('pauseBtn').setAttribute('aria-label',paused?'繼續':'暫停');render();persist();
  }
  function returnMenu() {
    engine=null;paused=false;clearInputs();show($('result'),false);show($('menu'),true);$('pauseBtn').disabled=true;
    $('menuTitle').textContent='每一塊，都能翻盤。';$('menuIntro').textContent='堆疊你的節奏，消除你的極限。';$('startBtn').textContent='開始挑戰 →';$('startBtn').disabled=false;render();
  }
  function leave() {
    if(embedded){
      if(!sdk?.isReady){toast('尚未連上房間，請用 APP 返回按鈕離開');return;}
      room?.forfeit();persist();exiting=true;clearInputs();
      if(!sdk.leaveGame()){exiting=false;toast('返回失敗，請用 APP 返回按鈕重試');}
      else toast('正在返回房間…');
    }else{persist();returnMenu();}
  }
  function newGame() {
    unlockAudio();
    if(room){if(room.isHost&&[...room.players.values()].filter(p=>p.connected).every(p=>room.ready.has(p.id)))room.start();else room.setReady();updateLobby();}
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
      if(session.players.length>=2){
        room=new window.TetrisBattleRoom.Room(sdk,{changed:roomChanged,notice:toast,garbage:(lines,hole)=>{engine?.receiveGarbage(lines,hole);processEvents();persist();render();}});
        if(saved?.room)room.restore(saved.room);
        $('modeLabel').textContent='BATTLE';$('menuEyebrow').textContent='STACK. CLEAR. ATTACK.';$('menuTitle').textContent='把消行，變成攻擊。';$('menuIntro').textContent='2–10 人方塊攻防。先抵消垃圾，再擊破對手；最後存活者勝出。';
        show($('lobbyPlayers'),true);$('miniRules').textContent='每局 3 分鐘 · 點選對手指定攻擊 · 淘汰後觀戰';show($('miniRules'),true);
        roomChanged();room.sync();
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
    const delta=Math.max(0,time-lastFrame);lastFrame=time;
    if(canPlay()){engine.advance(delta,[...inputs.values()].some(input=>input.kind==='soft'));repeat(time);processEvents();music(time);}
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
  on(window,'keyup',event=>inputs.delete(event.code));
  on(window,'blur',()=>{clearInputs();if(!room&&canPlay())pause(true);});
  on(document,'visibilitychange',()=>{clearInputs();if(document.hidden){if(!room&&canPlay())pause(true);persist();}else{room?.sync();lastFrame=performance.now();}});
  on(document,'pointerdown',unlockAudio,{passive:true});
  for(const button of document.querySelectorAll('[data-action]')){
    on(button,'pointerdown',event=>{if(button.disabled)return;event.preventDefault();button.setPointerCapture(event.pointerId);button.classList.add('pressed');press(button.dataset.action,'pointer:'+event.pointerId);});
    const release=event=>{inputs.delete('pointer:'+event.pointerId);button.classList.remove('pressed');};
    on(button,'pointerup',release);on(button,'pointercancel',release);on(button,'lostpointercapture',release);
    on(button,'click',event=>{if(event.detail===0)action(button.dataset.action);});
  }
  on($('board'),'pointerdown',event=>{if(!canPlay())return;event.preventDefault();$('board').setPointerCapture(event.pointerId);gesture={id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,moved:false};});
  on($('board'),'pointermove',event=>{if(!gesture||gesture.id!==event.pointerId||!canPlay())return;const unit=$('board').clientWidth/10;const dx=event.clientX-gesture.lastX;if(Math.abs(dx)>=unit){const steps=Math.min(10,Math.floor(Math.abs(dx)/unit));for(let i=0;i<steps;i++)action(dx>0?'right':'left');gesture.lastX+=Math.sign(dx)*steps*unit;gesture.moved=true;}});
  on($('board'),'pointerup',event=>{if(!gesture||gesture.id!==event.pointerId)return;const dy=event.clientY-gesture.y;if(dy>=70)action('hard');else if(dy>=20)action('soft');else if(!gesture.moved&&Math.hypot(event.clientX-gesture.x,dy)<15)action('cw');gesture=null;});
  on($('board'),'pointercancel',()=>gesture=null);
  on($('startBtn'),'click',newGame);
  on($('replayBtn'),'click',()=>{if(room){room.setReady();show($('result'),false);show($('menu'),true);updateLobby();}else startSolo();});
  on($('exitBtn'),'click',leave);on($('resultExit'),'click',leave);on($('syncBtn'),'click',()=>{if(room)room.sync();else if(embedded)initializeOnline();});
  on($('pauseBtn'),'click',()=>pause(!paused));on($('resumeBtn'),'click',()=>pause(false));
  on($('reconnectBtn'),'click',()=>room?.sync());
  on($('helpBtn'),'click',()=>{helpPaused=!room&&canPlay();if(helpPaused)pause(true);show($('help'),true);$('closeHelp').focus();});
  on($('closeHelp'),'click',()=>{show($('help'),false);if(helpPaused)pause(false);helpPaused=false;});
  for(const key of ['sound','music','haptic'])on($(key+'Btn'),'click',()=>togglePreference(key));
  for(const button of document.querySelectorAll('[data-mode]'))on(button,'click',()=>{mode=button.dataset.mode;for(const item of document.querySelectorAll('[data-mode]')){item.classList.toggle('selected',item===button);item.setAttribute('aria-pressed',String(item===button));}});
  on(document,'keydown',event=>{
    if(event.key!=='Tab')return;
    const modal=[$('help'),$('result'),$('menu')].find(el=>!el.hidden);if(!modal)return;
    const focusable=[...modal.querySelectorAll('button:not(:disabled)')].filter(el=>!el.hidden);
    if(!focusable.length)return;const first=focusable[0],last=focusable.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  });
  on(window,'resize',()=>{viewCache=null;render();});
  on(window,'pagehide',event=>{
    persist();clearInputs();if(event.persisted){if(!room&&canPlay())pause(true);audio?.suspend().catch(()=>{});return;}
    disposed=true;++bootEpoch;cancelAnimationFrame(raf);clearInterval(heartbeat);clearTimeout(toastTimer);clearTimeout(feedbackTimer);
    room?.dispose();for(const off of cleanups)off();audio?.close().catch(()=>{});
  });
  on(window,'pageshow',event=>{if(event.persisted){lastFrame=performance.now();room?.sync();render();}});
  preferenceUI();show($('rivalsTile'),false);render();
  if(embedded)initializeOnline();
  else{saved=read(storageKey());const restored=saved?.version===1&&Date.now()-saved.savedAt<86400000?Engine.restore(saved.engine):null;if(restored?.status==='playing'){mode=restored.mode;startSolo(restored);pause(true);toast('已恢復上次的單人挑戰');}}
  heartbeat=setInterval(()=>{if(disposed)return;if(document.hidden&&room)advance(performance.now());room?.tick();},200);
  raf=requestAnimationFrame(frame);
})();
