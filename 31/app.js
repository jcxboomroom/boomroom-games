/* BoomRoom 爆爆貪吃蛇：派對大亂鬥 v2
 * Multiplayer architecture:
 * - Authority/Host owns the canonical world.
 * - Every client sends INPUT to authority only.
 * - Authority broadcasts compact SNAPSHOT packets.
 * - Authority announces itself and heartbeat/election handles disconnect.
 * - Web iframe transport ALWAYS stringifies postMessage payloads.
 * - SDK transport is preferred when available.
 */
const GAME = Object.freeze({
  GRID: 24,
  ROUND_SECONDS: 50,
  TICK_MS: 160,
  SNAPSHOT_MS: 150,
  HEARTBEAT_MS: 900,
  PLAYER_TIMEOUT_MS: 3200,
  COUNTDOWN_MS: 3200,
  MAX_PLAYERS: 10,
  INITIAL_LENGTH: 4,
  MAX_FOOD: 9,
  START_HP: 3,
  BOOST_MAX: 100,
  BOOST_COST: 28,
  BOOST_GAIN: 18
});

const COLORS = ['#43e7ff','#ff4fa3','#ffd45c','#58e38c','#a98cff','#ff9a58','#71a8ff','#ff77dc','#b8e96a','#ffb0c8'];
const DIRS = {UP:{x:0,y:-1},DOWN:{x:0,y:1},LEFT:{x:-1,y:0},RIGHT:{x:1,y:0}};
const OPP = {UP:'DOWN',DOWN:'UP',LEFT:'RIGHT',RIGHT:'LEFT'};
const FOOD_SCORE = {apple:10,gold:28,bomb:-8};
const FOOD_GROW = {apple:1,gold:2,bomb:-2};

const $ = id => document.getElementById(id);
const canvas = $('snakeCanvas');
const ctx = canvas.getContext('2d', {alpha:false});

let sdk = window.BoomRoomSDK || null;
let state = 'LOADING';
let me = {id:`local-${Math.random().toString(36).slice(2,9)}`, username:'你', avatar:''};
let roomId = '';
let sdkSaysHost = false;
let players = new Map();
let lastSeen = new Map();
let authorityId = '';
let announcedAuthorityAt = 0;
let roundId = '';
let roundSeed = 0;
let roundStartAt = 0;
let roundEndAt = 0;
let countdownStart = 0;
let snakes = new Map();
let foods = [];
let fx = [];
let particles = [];
let inputDir = 'RIGHT';
let pendingDir = 'RIGHT';
let boostHeld = false;
let muted = false;
let audioCtx = null;
let gameOverCalled = false;
let resultShown = false;
let resultTimer = null;
let lastSnapshotAt = 0;
let lastSimAt = 0;
let lastFrame = performance.now();
let accumulator = 0;
let inputSeq = 0;
let authorityHeartbeatAt = 0;
let lastRenderSnapshot = null;
let lastRoundPacketAt = 0;
let localNoticeUntil = 0;
let localNoticeText = '';
let initialized = false;
let messageBound = false;
let heartbeatTimer = null;
let authorityTimer = null;
let rosterTimer = null;
let autoStartTimer = null;
let lastHUDAt = 0;
let lastRosterSignature = '';
let lastCanvasW = 0, lastCanvasH = 0, lastDpr = 0;
let backgroundCanvas = null;
let backgroundCtx = null;
let lastDrawW = 0, lastDrawH = 0;

const localStorageKey = 'boomroom_snake_muted';

function safeJSON(value){
  try { return JSON.parse(value); } catch(_) { return null; }
}
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function now(){ return performance.now(); }
function randSeed(){
  return (Date.now() ^ ((Math.random()*0xffffffff)>>>0)) >>> 0;
}
function seeded(seed){
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function toast(text, ms=1800){
  localNoticeText = text;
  localNoticeUntil = now()+ms;
}
function vibrate(pattern){
  try { if(navigator.vibrate) navigator.vibrate(pattern); } catch(_){}
}

/* ---------------- Audio ---------------- */
function ensureAudio(){
  if(muted) return;
  try{
    if(!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state==='suspended') audioCtx.resume();
  }catch(_){}
}
function tone(freq=440,duration=.08,type='sine',volume=.08){
  if(muted) return;
  try{
    ensureAudio(); if(!audioCtx) return;
    const t=audioCtx.currentTime;
    const o=audioCtx.createOscillator(), g=audioCtx.createGain();
    o.type=type; o.frequency.setValueAtTime(freq,t);
    g.gain.setValueAtTime(volume,t);
    g.gain.exponentialRampToValueAtTime(.001,t+duration);
    o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t+duration);
  }catch(_){}
}
function sfx(kind){
  if(kind==='eat'){tone(620,.06,'sine',.07);setTimeout(()=>tone(880,.07,'sine',.05),35);}
  else if(kind==='gold'){tone(740,.07,'triangle',.08);setTimeout(()=>tone(1100,.12,'triangle',.06),50);}
  else if(kind==='bomb'){tone(150,.16,'sawtooth',.10);setTimeout(()=>tone(70,.22,'sawtooth',.07),60);vibrate([25,35,25]);}
  else if(kind==='hit'){tone(100,.18,'square',.08);vibrate(35);}
  else if(kind==='count'){tone(420,.09,'square',.06);}
  else if(kind==='go'){tone(660,.08,'triangle',.08);setTimeout(()=>tone(990,.14,'triangle',.07),70);}
  else if(kind==='win'){[523,659,784,1047].forEach((f,i)=>setTimeout(()=>tone(f,.18,'triangle',.07),i*90));vibrate([30,30,60]);}
}

/* ---------------- Transport ---------------- */
function sendGameEvent(eventName,payload={}){
  const packet = {action:'sendGameEvent', eventName, payload};
  try{
    if(window.BoomRoomSDK && typeof window.BoomRoomSDK.sendGameEvent==='function'){
      window.BoomRoomSDK.sendGameEvent(eventName,payload);
      return true;
    }
  }catch(_){}
  try{
    if(window.parent && window.parent!==window){
      window.parent.postMessage(JSON.stringify(packet),'*');
      return true;
    }
  }catch(_){}
  return false;
}

function bindTransport(){
  if(messageBound) return;
  messageBound=true;
  if(sdk?.onGameEvent){
    sdk.onGameEvent((name,payload,sender)=>receiveEvent(name,payload||{},String(sender||'')));
    return;
  }
  window.addEventListener('message', e=>{
    let data=e.data;
    if(typeof data==='string') data=safeJSON(data);
    if(!data || typeof data!=='object') return;
    if(data.action==='initSDK' || data.action==='boomroomInit'){
      setupSDK(data);
      return;
    }
    if(data.action==='gameEventReceived'){
      receiveEvent(data.eventName || data.name, data.payload || {}, data.userId || data.senderId || '');
      return;
    }
    if(data.action==='sendGameEvent' && data.eventName){
      receiveEvent(data.eventName,data.payload||{},data.userId||data.senderId||'');
    }
  });
  window.addEventListener('gameEventReceived',e=>{
    const d=e.detail||{};
    receiveEvent(d.eventName||d.name,d.payload||{},d.senderId||d.userId||'');
  });
}

function receiveEvent(eventName,payload,senderId){
  if(!eventName) return;
  const sender = String(senderId || payload?.userId || '');
  const session=sdk?.getSession?.();
  if(session){
    if(!session.players.some(p=>String(p.userId)===sender)) return;
    if(['AUTHORITY_ANNOUNCE','ROUND_START','SNAPSHOT','ROUND_RESULT'].includes(eventName) && sender!==String(session.hostId)) return;
    if(payload.userId && String(payload.userId)!==sender) return;
    if(eventName==='PLAYER_HELLO' && String(payload.user?.id)!==sender) return;
  }
  if(sender) touchPlayer(sender);
  if(eventName==='PLAYER_HELLO') onHello(payload,sender);
  else if(eventName==='PLAYER_HEARTBEAT') onHeartbeat(payload,sender);
  else if(eventName==='AUTHORITY_ANNOUNCE') onAuthorityAnnounce(payload,sender);
  else if(eventName==='ROUND_START') onRoundStart(payload,sender);
  else if(eventName==='INPUT') onInput(payload,sender);
  else if(eventName==='SNAPSHOT') onSnapshot(payload,sender);
  else if(eventName==='ROUND_RESULT') onRoundResult(payload,sender);
  else if(eventName==='PLAYER_LEAVE') onPlayerLeave(payload,sender);
}

/* ---------------- SDK / room ---------------- */
function normalizePlayer(p,i=0){
  const id=String(p?.id ?? p?.userId ?? `player-${i+1}`);
  return {id,username:String(p?.username||p?.name||`玩家${i+1}`).slice(0,14),avatar:String(p?.avatar||'')};
}
function setupSDK(data={}){
  if(data.user){
    const u=data.user;
    me={id:String(u.id||me.id),username:String(u.username||u.name||'你').slice(0,14),avatar:String(u.avatar||'')};
  }
  sdkSaysHost=!!data.isHost;
  roomId=String(data.roomId||roomId||'local-room');
  players.set(me.id,me);
  touchPlayer(me.id);
  if(Array.isArray(data.roomPlayers)){
    for(let i=0;i<Math.min(GAME.MAX_PLAYERS,data.roomPlayers.length);i++){
      const p=normalizePlayer(data.roomPlayers[i],i);
      players.set(p.id,p); touchPlayer(p.id);
    }
  }
  if(players.size===0) players.set(me.id,me);
  initialized=true;
  if(state==='LOADING') state='AUTO_START';
  $('devBadge').textContent = sdk ? '房間對戰' : '單人挑戰';
  $('devBadge').classList.toggle('online',!!sdk);
  updateRosterUI();
  bindTransport();
  electAuthority(true);
  sendHello();
  scheduleAutoStart();
}

function bootstrap(){
  muted=localStorage.getItem(localStorageKey)==='1';
  updateMuteUI();
  if(window.BoomRoomSDK && typeof window.BoomRoomSDK.getUser==='function'){
    sdk=window.BoomRoomSDK;
    setupSDK({
      user:sdk.getUser()||{},
      isHost:!!sdk.isHost,
      roomId:sdk.roomId||'local-room',
      roomPlayers:Array.isArray(sdk.roomPlayers)?sdk.roomPlayers:[]
    });
  }else{
    const mock=[
      me,
    ];
    players.set(me.id,me);
    touchPlayer(me.id);
    setupSDK({user:me,isHost:true,roomId:'mock-room',roomPlayers:mock});
  }
  startRenderLoop();
}
window.initBoomRoomSDK = data=>setupSDK(data);
window.onBoomRoomSDKReady = ()=>{
  if(window.BoomRoomSDK){
    sdk=window.BoomRoomSDK;
    setupSDK({
      user:typeof sdk.getUser==='function'?sdk.getUser():{},
      isHost:!!sdk.isHost,
      roomId:sdk.roomId||'local-room',
      roomPlayers:Array.isArray(sdk.roomPlayers)?sdk.roomPlayers:[]
    });
  }
};

function touchPlayer(id){
  if(!id) return;
  lastSeen.set(String(id),Date.now());
}
function sendHello(){
  sendGameEvent('PLAYER_HELLO',{user:me,roomId,clientTime:Date.now()});
}
function sendHeartbeat(){
  touchPlayer(me.id);
  sendGameEvent('PLAYER_HEARTBEAT',{userId:me.id,roomId,authorityId,ts:Date.now()});
}
function onHello(payload,sender){
  const p=normalizePlayer(payload?.user||payload,sender?0:players.size);
  if(p.id) {players.set(p.id,p);touchPlayer(p.id);}
  updateRosterUI();
  if(isAuthority()) sendGameEvent('PLAYER_HEARTBEAT',{userId:me.id,roomId,authorityId,ts:Date.now()});
}
function onHeartbeat(payload,sender){
  const id=String(payload?.userId||sender||'');
  if(id) touchPlayer(id);
  if(payload?.authorityId && !authorityId){
    authorityId=String(payload.authorityId);
    authorityHeartbeatAt=Date.now();
  }
}
function onAuthorityAnnounce(payload,sender){
  const id=String(payload?.authorityId||sender||'');
  if(!id) return;
  const ts=Number(payload?.ts||Date.now());
  if(ts>=announcedAuthorityAt){
    authorityId=id; announcedAuthorityAt=ts; authorityHeartbeatAt=Date.now();
    updateAuthorityUI();
  }
}
function activeIds(){
  const cutoff=Date.now()-GAME.PLAYER_TIMEOUT_MS;
  return [...players.keys()].filter(id=>lastSeen.get(id)>=cutoff || id===me.id);
}
function electAuthority(force=false){
  const host=sdk?.getSession?.()?.hostId;
  if(host){
    authorityId=String(host);
    authorityHeartbeatAt=Date.now();
    updateAuthorityUI();
    return;
  }
  const active=activeIds();
  if(!active.length) return;
  const old=authorityId;
  // If the platform tells this client it is the host, it gets first authority claim.
  // The announcement then becomes the shared authority id for all clients.
  if((force || !authorityId || !active.includes(authorityId) || Date.now()-authorityHeartbeatAt>GAME.PLAYER_TIMEOUT_MS)){
    if(sdkSaysHost) authorityId=me.id;
    else authorityId=active.slice().sort()[0];
    authorityHeartbeatAt=Date.now();
    announcedAuthorityAt=Date.now();
    sendGameEvent('AUTHORITY_ANNOUNCE',{authorityId,ts:announcedAuthorityAt,roomId});
    if(old!==authorityId){
      toast(authorityId===me.id?'你已接管本局':'房主已切換');
      if(state==='PLAYING' && authorityId===me.id && !snakes.size){
        // Wait for a fresh ROUND_START only if there is no state.
        startNewRoundAsAuthority(true);
      }
    }
  }
}
function isAuthority(){ return String(authorityId)===String(me.id); }

function scheduleAutoStart(){
  clearTimeout(autoStartTimer);
  autoStartTimer=setTimeout(()=>{
    if(state==='RESULT' || state==='EXIT') return;
    if(state==='LOADING') state='AUTO_START';
    if(isAuthority() && !roundId) startNewRoundAsAuthority(false);
  },900);
}
function onPlayerLeave(payload,sender){
  const id=String(payload?.userId||sender||'');
  if(!id || id===me.id) return;
  lastSeen.set(id,0);
  players.delete(id);
  const s=snakes.get(id); if(s) s.disconnected=true;
  updateRosterUI();
  electAuthority(false);
}

/* ---------------- Round ---------------- */
function startNewRoundAsAuthority(takeover=false){
  if(!isAuthority()) return;
  if(state==='PLAYING' && !takeover) return;
  roundId=`${roomId||'room'}-${Date.now().toString(36)}-${Math.floor(Math.random()*9999)}`;
  roundSeed=randSeed();
  roundStartAt=Date.now()+GAME.COUNTDOWN_MS;
  roundEndAt=roundStartAt+GAME.ROUND_SECONDS*1000;
  const packet={roundId,seed:roundSeed,startAt:roundStartAt,endAt:roundEndAt,players:activeIds().slice(0,GAME.MAX_PLAYERS)};
  sendGameEvent('ROUND_START',packet);
  applyRoundStart(packet,true);
}
function onRoundStart(payload,sender){
  if(!payload?.roundId) return;
  if(sender && authorityId && String(sender)!==String(authorityId)) return;
  if(lastRoundPacketAt && payload.roundId===roundId) return;
  lastRoundPacketAt=Date.now();
  applyRoundStart(payload,false);
}
function applyRoundStart(packet,localAuthority){
  $('resultOverlay').classList.add('hidden');
  roundId=String(packet.roundId);
  roundSeed=Number(packet.seed)>>>0;
  roundStartAt=Number(packet.startAt);
  roundEndAt=Number(packet.endAt);
  countdownStart=Date.now();
  state='COUNTDOWN';
  gameOverCalled=false;
  resultShown=false;
  snakes.clear(); foods=[]; fx=[]; particles=[];
  accumulator=0; lastSimAt=Date.now();
  const ids=Array.isArray(packet.players)&&packet.players.length?packet.players.slice(0,GAME.MAX_PLAYERS):[me.id];
  ids.forEach((id,idx)=>{
    const p=players.get(String(id))||{id:String(id),username:`玩家${idx+1}`,avatar:''};
    players.set(p.id,p); touchPlayer(p.id);
    snakes.set(p.id,makeSnake(p,idx,false));
  });
  // Solo or single real player: add 3 AI opponents
  const realUsers = ids.filter(id => !id.startsWith('bot-'));
  if(realUsers.length <= 1){
    snakes.set('bot-a',makeBot('bot-a','🤖 AI 小閃',1));
    snakes.set('bot-b',makeBot('bot-b','🤖 AI 阿爆',2));
    snakes.set('bot-c',makeBot('bot-c','🤖 AI 狂蛇',3));
  }
  spawnInitialFood();
  toast('3 秒後開始，吃金蘋果、躲炸彈！',2600);
  updateHUD();
}

function makeSnake(p,idx,isBot=false){
  const spots=[
    [2,2,'RIGHT'],[21,21,'LEFT'],[21,2,'DOWN'],[2,21,'UP'],
    [7,7,'RIGHT'],[16,16,'LEFT'],[16,7,'DOWN'],[7,16,'UP'],
    [11,2,'DOWN'],[12,21,'UP']
  ];
  const [x,y,d]=spots[idx%spots.length];
  const body=[];
  const v=DIRS[d];
  for(let i=0;i<GAME.INITIAL_LENGTH;i++) body.push({x:wrap(x-v.x*i),y:wrap(y-v.y*i)});
  return {id:p.id,username:p.username,body,dir:d,nextDir:d,score:0,hp:GAME.START_HP,boost:65,alive:true,respawnAt:0,isBot};
}
function makeBot(id,name,idx){
  return makeSnake({id,username:name},idx,true);
}
function wrap(v){ return (v+GAME.GRID)%GAME.GRID; }

function spawnInitialFood(){
  foods=[];
  const rng=seeded(roundSeed^0xA55A5AA5);
  for(let i=0;i<GAME.MAX_FOOD;i++) spawnFood(rng);
}
function spawnFood(rng=Math.random){
  let tries=0;
  while(tries++<30){
    const f={
      x:Math.floor(rng()*GAME.GRID),
      y:Math.floor(rng()*GAME.GRID),
      type:rng()<.16?'gold':(rng()<.28?'bomb':'apple'),
      pulse:rng()*Math.PI*2
    };
    if(!isOccupied(f.x,f.y)){foods.push(f);return;}
  }
}
function isOccupied(x,y){
  for(const s of snakes.values()) for(const b of s.body) if(b.x===x&&b.y===y) return true;
  return false;
}

/* ---------------- Input / simulation ---------------- */
function requestDirection(dir){
  if(!DIRS[dir] || state!=='PLAYING') return;
  const s=snakes.get(me.id);
  if(!s || !s.alive) return;
  if(s.dir===OPP[dir]) return;
  pendingDir=dir;
  ensureAudio();
  sendGameEvent('INPUT',{roundId,userId:me.id,dir,boost:boostHeld,seq:++inputSeq,ts:Date.now()});
  if(isAuthority()) applyInput({roundId,userId:me.id,dir,boost:boostHeld,seq:inputSeq});
}
function applyInput(p){
  if(!isAuthority() || !p || p.roundId!==roundId) return;
  const s=snakes.get(String(p.userId));
  if(!s || !s.alive) return;
  const dir=String(p.dir||'');
  if(DIRS[dir] && s.dir!==OPP[dir]) s.nextDir=dir;
  s.boostHeld=!!p.boost;
}
function onInput(payload,sender){
  if(!isAuthority() || !payload || payload.roundId!==roundId) return;
  const uid=String(payload.userId||sender||'');
  if(uid!==sender && sender) return;
  applyInput(payload);
}

function moveSnakeStep(s){
    const d=DIRS[s.dir];
    const head=s.body[0];
    const next={x:wrap(head.x+d.x),y:wrap(head.y+d.y)};
    s.body.unshift(next);

    let ate=false;
    for(let i=foods.length-1;i>=0;i--){
      const f=foods[i];
      if(f.x===next.x&&f.y===next.y){
        foods.splice(i,1); ate=true;
        const delta=FOOD_SCORE[f.type];
        if(f.type==='bomb'){
          s.hp--;
          s.score=Math.max(0,s.score+delta);
          s.body.splice(Math.max(2,s.body.length-2),2);
          spawnFx(next.x,next.y,'bomb');
          if(s.id===me.id){sfx('bomb');}
          else {}
          if(s.hp<=0) eliminateSnake(s,'bomb');
        }else{
          s.score+=delta;
          const grow=Math.max(0,FOOD_GROW[f.type]);
          // Keep tail for grow amount.
          s.grow=(s.grow||0)+grow;
          if(s.id===me.id) sfx(f.type==='gold'?'gold':'eat');
          spawnFx(next.x,next.y,f.type);
        }
        break;
      }
    }
    if(!ate || s.grow>0){
      if(s.grow>0) s.grow--;
      else s.body.pop();
    }else s.body.pop();

    if(!s.alive) return false;

    // Snake collision: head into any other body.
    const victim=collisionTarget(s,next);
    if(victim){
      s.hp--;
      s.score=Math.max(0,s.score-12);
      spawnFx(next.x,next.y,'hit');
      if(s.id===me.id) sfx('hit');
      if(s.hp<=0) eliminateSnake(s,'crash');
      else respawnSnake(s,true);
      return false;
    }
    return true;
}
function simulationTick(){
  if(!isAuthority() || state!=='PLAYING') return;
  const nowMs=Date.now();
  if(nowMs>=roundEndAt){finishAsAuthority();return;}
  for(const s of snakes.values()){
    if(!s.alive){
      if(s.respawnAt && nowMs>=s.respawnAt) respawnSnake(s);
      continue;
    }
    if(s.isBot) updateBot(s);
    s.dir=s.nextDir;
    const boosting = s.boostHeld && s.boost>=GAME.BOOST_COST;
    if(boosting) s.boost-=GAME.BOOST_COST;
    else s.boost=Math.min(GAME.BOOST_MAX,s.boost+GAME.BOOST_GAIN*.15);
    // Both cells are simulated, so a burst cannot tunnel through food or bodies.
    for(let step=0;step<(boosting?2:1);step++){
      if(!moveSnakeStep(s)) break;
    }
  }
  for(let refill=0;refill<GAME.MAX_FOOD&&foods.length<GAME.MAX_FOOD;refill++)spawnFood();
  const humans=[...snakes.values()].filter(s=>!s.isBot);
  if(humans.length===1&&!humans[0].alive){finishAsAuthority();return;}
  updateAuthorityFX();
  if(nowMs-lastSnapshotAt>=GAME.SNAPSHOT_MS){
    lastSnapshotAt=nowMs;
    broadcastSnapshot();
  }
}
function collisionTarget(s,head){
  for(const other of snakes.values()){
    if(!other.alive || other.id===s.id) continue;
    for(let i=0;i<other.body.length;i++){
      const b=other.body[i];
      if(b.x===head.x&&b.y===head.y) return other;
    }
  }
  return null;
}
function eliminateSnake(s,reason){
  s.alive=false; s.respawnAt=0; s.boostHeld=false;
  if(s.id===me.id)toast('本局已淘汰；可在結果頁再挑戰',3000);
  spawnFx(s.body[0]?.x||0,s.body[0]?.y||0,'eliminate');
}
function respawnSnake(s,instant=false){
  const idx=[...snakes.keys()].indexOf(s.id);
  const spot=[2+((idx*7)%18),2+((idx*11)%18)];
  const d=idx%2?'LEFT':'RIGHT';
  s.body=[]; for(let i=0;i<GAME.INITIAL_LENGTH;i++) s.body.push({x:wrap(spot[0]+(d==='LEFT'?i:-i)),y:spot[1]});
  s.dir=d;s.nextDir=d;s.alive=true;s.respawnAt=0;
  if(s.hp<1) s.hp=1;
  s.boost=Math.max(s.boost||0,35);
}
function updateBot(s){
  if(!s.alive) return;
  const safe=foods.filter(f=>f.type!=='bomb');
  const target=safe.sort((a,b)=>manhattan(s.body[0],a)-manhattan(s.body[0],b))[0];
  if(!target) return;
  const choices=[];
  if(s.body[0].x!==target.x && s.dir!=='LEFT') choices.push('RIGHT');
  if(s.body[0].x!==target.x && s.dir!=='RIGHT') choices.push('LEFT');
  if(s.body[0].y!==target.y && s.dir!=='UP') choices.push('DOWN');
  if(s.body[0].y!==target.y && s.dir!=='DOWN') choices.push('UP');
  if(choices.length && Math.random()<.86) s.nextDir=choices[Math.floor(Math.random()*choices.length)];
}
function manhattan(a,b){
  const dx=Math.min(Math.abs(a.x-b.x),GAME.GRID-Math.abs(a.x-b.x));
  const dy=Math.min(Math.abs(a.y-b.y),GAME.GRID-Math.abs(a.y-b.y));
  return dx+dy;
}

function broadcastSnapshot(){
  if(!isAuthority()) return;
  const packet={
    roundId, authorityId, serverNow:Date.now(), endAt:roundEndAt,
    snakes:[...snakes.values()].map(s=>({
      id:s.id, body:s.body.slice(0,55).map(b=>[b.x,b.y]), dir:s.dir, score:s.score,
      hp:s.hp,boost:Math.round(s.boost),alive:s.alive,respawnAt:s.respawnAt||0,isBot:!!s.isBot
    })),
    foods:foods.map(f=>[f.x,f.y,f.type]),
    fx:fx.splice(0,20)
  };
  sendGameEvent('SNAPSHOT',packet);
  applySnapshot(packet,true);
}
function onSnapshot(payload,sender){
  if(!payload?.roundId) return;
  if(String(payload.authorityId)!==String(authorityId)) return;
  if(String(sender) && String(sender)!==String(authorityId)) return;
  applySnapshot(payload,false);
}
function applySnapshot(p,localAuthority){
  if(p.roundId!==roundId) return;
  if(!localAuthority && p.authorityId!==authorityId) return;
  lastRenderSnapshot=p;
  if(!localAuthority){
    (p.snakes||[]).forEach(raw=>{
      let s = snakes.get(raw.id);
      if(!s){
        s = {id: raw.id, username: players.get(raw.id)?.username || raw.id};
        snakes.set(s.id, s);
      }
      s.body=(raw.body||[]).map(v=>({x:v[0],y:v[1]}));
      s.dir=raw.dir;s.score=raw.score;s.hp=raw.hp;s.boost=raw.boost;s.alive=raw.alive;s.respawnAt=raw.respawnAt;s.isBot=!!raw.isBot;
    });
    foods=(p.foods||[]).map(v=>({x:v[0],y:v[1],type:v[2],pulse:0}));
    (p.fx||[]).forEach(f=>spawnParticleFromFx(f));
    roundEndAt=Number(p.endAt||roundEndAt);
    if(state==='COUNTDOWN' && Date.now()>=roundStartAt) state='PLAYING';
  }
  updateHUD(false);
}
function finishAsAuthority(){
  if(state!=='PLAYING' || !isAuthority()) return;
  state='RESULT';
  const solo=[...snakes.values()].filter(s=>!s.isBot).length===1;
  const standings=[...snakes.values()].filter(s=>solo||!s.isBot).sort((a,b)=>b.score-a.score||b.hp-a.hp);
  const result={roundId,standings:standings.map((s,i)=>({id:s.id,username:s.username,score:s.score,hp:s.hp,rank:i+1})),finishedAt:Date.now()};
  sendGameEvent('ROUND_RESULT',result);
  applyResult(result);
}
function onRoundResult(payload,sender){
  if(!payload?.roundId || payload.roundId!==roundId) return;
  if(String(payload.authorityId||authorityId)!==String(authorityId) && sender && String(sender)!==String(authorityId)) return;
  applyResult(payload);
}
function applyResult(result){
  if(resultShown) return;
  resultShown=true; state='RESULT';
  const mine=(result.standings||[]).find(x=>x.id===me.id);
  const rank=mine?.rank||((result.standings||[]).length||1);
  const score=mine?.score||0;
  const winner=result.standings?.[0];
  const won=winner?.id===me.id;
  for(const row of result.standings||[]){
    const snake=snakes.get(row.id);
    if(snake){snake.score=row.score;snake.hp=row.hp;}
  }
  updateHUD(true);
  $('resultTitle').textContent=won?'🏆 你是蛇王！':`第 ${rank} 名`;
  $('resultSubtitle').textContent=`本局 ${score} 分 · 第一名 ${winner?.score||0} 分`;
  $('resultReward').textContent=`挑戰成績 ${score} 分`;
  $('resultReplay').disabled=!isAuthority();
  $('resultReplay').textContent=isAuthority()?'再挑戰一次':'等待房主再開一局';
  $('resultExit').hidden=!sdk && window.parent===window;
  $('resultOverlay').classList.remove('hidden');
  if(won) sfx('win'); else tone(220,.16,'triangle',.05);
  if(!gameOverCalled){
    gameOverCalled=true;
    const reward=0;
    try{
      if(window.BoomRoomSDK && typeof window.BoomRoomSDK.completeRound==='function') {
        window.BoomRoomSDK.completeRound(score);
      } else if (window.parent && window.parent !== window) {
        window.parent.postMessage(JSON.stringify({action:'game_over', winAmount:reward, score:score}), '*');
      }
    }catch(_){}
  }
  clearTimeout(resultTimer);
}
function replayRound(){
  if(state!=='RESULT'||!isAuthority()) return;
  $('resultOverlay').classList.add('hidden');
  roundId='';
  startNewRoundAsAuthority(false);
}
function returnToRoom(){
  if(state==='EXIT') return;
  state='EXIT';
  if(sdk?.leaveGame){sdk.leaveGame();return;}
  try{
    if(window.parent && window.parent!==window){
      window.parent.postMessage(JSON.stringify({action:'leaveGame'}),'*');
      setTimeout(()=>window.parent.postMessage({action:'leaveGame'},'*'),120);
    }else if(window.location.pathname.endsWith('index.html')){
      // Browser test: don't navigate away and become blank. Keep result visible.
      $('autoCloseHint').textContent='測試模式：本局已結束';
    }
  }catch(_){}
}

/* ---------------- FX ---------------- */
function spawnFx(x,y,type){
  fx.push({x,y,type,t:Date.now()});
  for(let i=0;i<10;i++){
    const a=Math.random()*Math.PI*2, sp=20+Math.random()*65;
    if(particles.length>=90) break;
    particles.push({x:x+.5,y:y+.5,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:.45+Math.random()*.35,type});
  }
}
function updateAuthorityFX(){
  const t=Date.now();
  particles=particles.filter(p=>{
    p.x+=p.vx*.008;p.y+=p.vy*.008;p.life-=.025;return p.life>0;
  });
  fx=fx.filter(f=>t-f.t<900);
}
function spawnParticleFromFx(f){
  if(!f) return;
  for(let i=0;i<5;i++){
    const a=Math.random()*Math.PI*2;
    if(particles.length>=90) break;
    particles.push({x:f.x+.5,y:f.y+.5,vx:Math.cos(a)*30,vy:Math.sin(a)*30,life:.25+Math.random()*.2,type:f.type});
  }
}

/* ---------------- HUD / UI ---------------- */
function updateAuthorityUI(){
  $('authorityBadge').textContent=!sdk?'● 單人挑戰':isAuthority()?'● 房主同步':'● 已同步';
  $('authorityBadge').classList.toggle('host',isAuthority());
}
function updateRosterUI(){
  const humans=[...players.values()].slice(0,GAME.MAX_PLAYERS);
  const arr=[...humans,...[...snakes.values()].filter(s=>s.isBot).map(s=>({id:s.id,username:s.username}))];
  const sig=arr.map(p=>`${p.id}:${p.username}:${snakes.get(p.id)?.score??''}:${snakes.get(p.id)?.alive?'1':'0'}`).join('|');
  if(sig===lastRosterSignature) return;
  lastRosterSignature=sig;
  const list=$('rosterList'); list.innerHTML='';
  $('playerCounter').textContent=`${humans.length}/10 真人${arr.length>humans.length?` · ${arr.length-humans.length} AI`:''}`;
  arr.forEach((p,idx)=>{
    const ss=snakes.get(p.id);
    const el=document.createElement('div');
    el.className='roster-chip'+(p.id===me.id?' me':'');
    el.innerHTML=`<span class="dot" style="--c:${COLORS[idx%COLORS.length]}"></span><span>${escapeHtml(p.username)}</span>${ss?`<b>${ss.score}</b>`:''}`;
    list.appendChild(el);
  });
}
function updateHUD(force=false){
  const t=performance.now();
  if(!force && t-lastHUDAt<100) return;
  lastHUDAt=t;
  const s=snakes.get(me.id);
  $('scoreValue').textContent=s?.score??0;
  $('hpValue').textContent=s?.hp??GAME.START_HP;
  $('boostFill').style.width=`${clamp(s?.boost??0,0,100)}%`;
  const remain=Math.max(0,(roundEndAt-Date.now())/1000);
  $('timerValue').textContent=state==='COUNTDOWN'?Math.max(0,Math.ceil((roundStartAt-Date.now())/1000)):Math.ceil(remain);
  $('timerWrap').classList.toggle('danger',remain<=10&&state==='PLAYING');
  const solo=[...snakes.values()].filter(x=>!x.isBot).length===1;
  const sorted=[...snakes.values()].filter(x=>solo||!x.isBot).sort((a,b)=>b.score-a.score||b.hp-a.hp);
  const idx=sorted.findIndex(x=>x.id===me.id);
  $('rankValue').textContent=`#${idx<0?1:idx+1}`;
  updateRosterUI();
  updateAuthorityUI();
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function updateMuteUI(){
  $('muteBtn').textContent=muted?'🔇':'🔊';
  $('muteBtn').setAttribute('aria-label',muted?'開啟音效':'靜音');
}
function toggleMute(){
  muted=!muted; localStorage.setItem(localStorageKey,muted?'1':'0'); updateMuteUI();
  if(!muted) {ensureAudio();tone(660,.07);}
}
function showHelp(){
  $('helpOverlay').classList.remove('hidden');
}
function hideHelp(){
  $('helpOverlay').classList.add('hidden');
}

/* ---------------- Render ---------------- */
function resizeCanvas(){
  const r=canvas.getBoundingClientRect();
  const dpr=Math.min(devicePixelRatio||1,1.5);
  const w=Math.max(1,Math.floor(r.width*dpr));
  const h=Math.max(1,Math.floor(r.height*dpr));
  if(w===lastCanvasW && h===lastCanvasH && dpr===lastDpr) return;
  lastCanvasW=w; lastCanvasH=h; lastDpr=dpr;
  canvas.width=w; canvas.height=h;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  buildBackground(r.width, r.height, dpr);
}
function buildBackground(w,h,dpr){
  if(!backgroundCanvas) {
    backgroundCanvas=document.createElement('canvas');
    backgroundCtx=backgroundCanvas.getContext('2d',{alpha:false});
  }
  backgroundCanvas.width=Math.max(1,Math.floor(w*dpr));
  backgroundCanvas.height=Math.max(1,Math.floor(h*dpr));
  backgroundCtx.setTransform(dpr,0,0,dpr,0,0);
  backgroundCtx.fillStyle='#080c18';
  backgroundCtx.fillRect(0,0,w,h);
  const cell=Math.min(w,h)/GAME.GRID;
  const ox=(w-cell*GAME.GRID)/2, oy=(h-cell*GAME.GRID)/2;
  backgroundCtx.strokeStyle='rgba(100,220,255,.055)';
  backgroundCtx.lineWidth=1;
  backgroundCtx.beginPath();
  for(let i=0;i<=GAME.GRID;i++){
    const x=ox+i*cell, y=oy+i*cell;
    backgroundCtx.moveTo(x,oy);backgroundCtx.lineTo(x,oy+cell*GAME.GRID);
    backgroundCtx.moveTo(ox,y);backgroundCtx.lineTo(ox+cell*GAME.GRID,y);
  }
  backgroundCtx.stroke();
  lastDrawW=w; lastDrawH=h;
}
function roundRect(c,x,y,w,h,r){
  r=Math.min(r,w/2,h/2); c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();
}
function draw(){
  const w=canvas.clientWidth,h=canvas.clientHeight;
  if(!backgroundCanvas || w!==lastDrawW || h!==lastDrawH) buildBackground(w,h,lastDpr||1);
  ctx.clearRect(0,0,w,h);
  if(backgroundCanvas) ctx.drawImage(backgroundCanvas,0,0,backgroundCanvas.width,backgroundCanvas.height,0,0,w,h);
  const cell=Math.min(w,h)/GAME.GRID;
  const ox=(w-cell*GAME.GRID)/2, oy=(h-cell*GAME.GRID)/2;

  // food
  foods.forEach(f=>{
    const x=ox+(f.x+.5)*cell,y=oy+(f.y+.5)*cell;
    const pulse=1+Math.sin(performance.now()/180+(f.pulse||0))*.08;
    ctx.save();ctx.translate(x,y);ctx.scale(pulse,pulse);
    if(f.type==='bomb'){
      ctx.shadowBlur=0;ctx.fillStyle='#ff3d65';
      ctx.beginPath();ctx.arc(0,2,cell*.25,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#ffd45c';ctx.fillRect(-2,-cell*.35,4,cell*.12);
    }else if(f.type==='gold'){
      ctx.shadowBlur=0;ctx.fillStyle='#ffd45c';
      ctx.beginPath();ctx.arc(0,0,cell*.28,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#6d4b00';ctx.font=`900 ${cell*.22}px system-ui`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('★',0,1);
    }else{
      ctx.shadowBlur=0;ctx.fillStyle='#55e38a';
      ctx.beginPath();ctx.arc(0,1,cell*.25,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#eafff0';ctx.beginPath();ctx.arc(-cell*.07,-cell*.08,cell*.06,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
  });

  // snakes
  const list=[...snakes.values()].filter(s=>s.alive);
  list.forEach(s=>{
    const color=s.id===me.id?'#75ffc8':(COLORS[[...snakes.keys()].indexOf(s.id)%COLORS.length]||'#ffce68');
    s.body.forEach((b,i)=>{
      const x=ox+b.x*cell+cell*.5,y=oy+b.y*cell+cell*.5;
      const r=i===0?cell*.40:cell*.34*(1-i/(s.body.length*3));
      ctx.save();
      ctx.shadowBlur=0;
      ctx.fillStyle=color;
      roundRect(ctx,x-r,y-r,r*2,r*2,Math.max(3,r*.55));ctx.fill();
      if(i===0){
        ctx.fillStyle='#101428';
        const dx=s.dir==='LEFT'?-r*.2:s.dir==='RIGHT'?r*.2:0;
        const dy=s.dir==='UP'?-r*.2:s.dir==='DOWN'?r*.2:0;
        ctx.beginPath();ctx.arc(x+dx-r*.22,y+dy-r*.18,r*.07,0,Math.PI*2);ctx.fill();
        ctx.beginPath();ctx.arc(x+dx+r*.22,y+dy-r*.18,r*.07,0,Math.PI*2);ctx.fill();
      }
      ctx.restore();
    });
    // hp pips over head
    const head=s.body[0];
    if(head){
      const x=ox+(head.x+.5)*cell,y=oy+(head.y-.22)*cell;
      if(s.id===me.id){ctx.fillStyle='#fff';ctx.font='800 12px system-ui';ctx.textAlign='center';ctx.fillText('你',x,y<16?y+cell*1.7:y-4);}
      for(let i=0;i<GAME.START_HP;i++){
        ctx.fillStyle=i<s.hp?'#ff5b83':'rgba(255,255,255,.14)';
        roundRect(ctx,x-cell*.35+i*cell*.24,y-cell*.06,cell*.18,cell*.07,3);ctx.fill();
      }
    }
  });

  // particles
  particles.forEach(p=>{
    const x=ox+p.x*cell;
    const y=oy+p.y*cell;
    ctx.globalAlpha=clamp(p.life,0,1);
    ctx.fillStyle=p.type==='bomb'?'#ff456d':p.type==='gold'?'#ffd45c':'#68efff';
    ctx.beginPath();ctx.arc(x,y,Math.max(1,cell*.045),0,Math.PI*2);ctx.fill();
  });
  ctx.globalAlpha=1;

  if(state==='COUNTDOWN'){
    const n=Math.max(1,Math.ceil((roundStartAt-Date.now())/1000));
    ctx.fillStyle='rgba(0,0,0,.18)';ctx.fillRect(0,0,w,h);
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.shadowBlur=0;ctx.fillStyle='#fff';
    ctx.font=`1000 ${Math.min(w*.24,92)}px system-ui`;ctx.fillText(n>0?n:'GO!',w/2,h/2);
    ctx.shadowBlur=0;
  }
  if(state==='PLAYING' && !snakes.get(me.id)?.alive){
    ctx.fillStyle='rgba(5,7,15,.62)';ctx.fillRect(0,0,w,h);
    ctx.textAlign='center';ctx.fillStyle='#fff';ctx.font='900 24px system-ui';ctx.fillText('爆掉了！',w/2,h*.44);
    ctx.font='700 14px system-ui';ctx.fillStyle='#b9bfd8';ctx.fillText('已淘汰 · 正在觀看其他玩家',w/2,h*.51);
  }
  if(localNoticeUntil>performance.now()){
    ctx.fillStyle='rgba(5,7,15,.75)';
    const tw=Math.min(w-32,330), th=34, tx=(w-tw)/2,ty=10;
    roundRect(ctx,tx,ty,tw,th,17);ctx.fill();
    ctx.fillStyle='#eafcff';ctx.font='800 12px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(localNoticeText,w/2,ty+th/2);
  }
}

function startRenderLoop(){
  resizeCanvas();
  requestAnimationFrame(frame);
}
function frame(t){
  if(document.hidden){lastFrame=t;requestAnimationFrame(frame);return;}
  const dt=Math.min(0.033,(t-lastFrame)/1000); lastFrame=t;
  if(isAuthority() && state==='COUNTDOWN' && Date.now()>=roundStartAt){state='PLAYING';sendGameEvent('PLAYER_HEARTBEAT',{userId:me.id,authorityId,roundId,ts:Date.now()});sfx('go');}
  if(state==='COUNTDOWN' && Date.now()>=roundStartAt && !isAuthority()) state='PLAYING';
  if(isAuthority() && state==='PLAYING'){
    accumulator+=dt*1000;
    while(accumulator>=GAME.TICK_MS){accumulator-=GAME.TICK_MS;simulationTick();}
  }
  if(Date.now()-authorityHeartbeatAt>GAME.PLAYER_TIMEOUT_MS) electAuthority(false);
  if(state==='PLAYING' || state==='COUNTDOWN') updateHUD(false);
  draw();
  requestAnimationFrame(frame);
}

/* ---------------- Controls ---------------- */
function setBoost(on){
  boostHeld=!!on;
  const s=snakes.get(me.id);
  if(!s||!s.alive||state!=='PLAYING') return;
  sendGameEvent('INPUT',{roundId,userId:me.id,dir:pendingDir,boost:boostHeld,seq:++inputSeq,ts:Date.now()});
  if(isAuthority()) applyInput({roundId,userId:me.id,dir:pendingDir,boost:boostHeld,seq:inputSeq});
}
function bindButton(el,down,up){
  el.addEventListener('pointerdown',e=>{e.preventDefault();ensureAudio();down();},{passive:false});
  ['pointerup','pointercancel','pointerleave'].forEach(ev=>el.addEventListener(ev,e=>{e.preventDefault();up();},{passive:false}));
}
function bindControls(){
  const dirs={up:'UP',down:'DOWN',left:'LEFT',right:'RIGHT'};
  Object.entries(dirs).forEach(([id,d])=>{
    const el=$(`btn${id[0].toUpperCase()+id.slice(1)}`);
    el.addEventListener('pointerdown',e=>{e.preventDefault();requestDirection(d);},{passive:false});
  });
  bindButton($('boostBtn'),()=>setBoost(true),()=>setBoost(false));
  let sx=0,sy=0,st=0;
  canvas.addEventListener('pointerdown',e=>{sx=e.clientX;sy=e.clientY;st=performance.now();ensureAudio();},{passive:true});
  canvas.addEventListener('pointerup',e=>{
    const dx=e.clientX-sx,dy=e.clientY-sy;
    if(performance.now()-st<700 && Math.max(Math.abs(dx),Math.abs(dy))>28){
      if(Math.abs(dx)>Math.abs(dy)) requestDirection(dx>0?'RIGHT':'LEFT');
      else requestDirection(dy>0?'DOWN':'UP');
    }
  },{passive:true});
  window.addEventListener('keydown',e=>{
    if(['ArrowUp','w','W'].includes(e.key)) requestDirection('UP');
    else if(['ArrowDown','s','S'].includes(e.key)) requestDirection('DOWN');
    else if(['ArrowLeft','a','A'].includes(e.key)) requestDirection('LEFT');
    else if(['ArrowRight','d','D'].includes(e.key)) requestDirection('RIGHT');
    else if(e.code==='Space'){e.preventDefault();setBoost(true);}
  });
  window.addEventListener('keyup',e=>{if(e.code==='Space')setBoost(false);});
  $('muteBtn').addEventListener('click',toggleMute);
  $('helpBtn').addEventListener('click',showHelp);
  $('helpClose').addEventListener('click',hideHelp);
  $('helpOverlay').addEventListener('click',e=>{if(e.target.id==='helpOverlay')hideHelp();});
}

/* ---------------- Timers / maintenance ---------------- */
function maintenance(){
  if(!initialized) return;
  if(Date.now()-lastSeen.get(me.id)>500) touchPlayer(me.id);
  const cutoff=Date.now()-GAME.PLAYER_TIMEOUT_MS;
  for(const [id,t] of lastSeen){
    if(id!==me.id && t<cutoff){
      // Don't instantly delete the player during PLAYING; keep last visual snapshot.
    }
  }
  if(isAuthority()) sendHeartbeat();
  else if(Date.now()-authorityHeartbeatAt>GAME.PLAYER_TIMEOUT_MS) electAuthority(false);
  updateRosterUI();
}
function startTimers(){
  clearInterval(heartbeatTimer);clearInterval(authorityTimer);clearInterval(rosterTimer);
  heartbeatTimer=setInterval(sendHeartbeat,GAME.HEARTBEAT_MS);
  authorityTimer=setInterval(()=>electAuthority(false),1100);
  rosterTimer=setInterval(maintenance,1000);
}

/* ---------------- Help / init ---------------- */
$('helpBtn').addEventListener('click',showHelp);
$('helpClose').addEventListener('click',hideHelp);
bindControls();
$('resultReplay').addEventListener('click',replayRound);
$('resultExit').addEventListener('click',returnToRoom);
window.addEventListener('resize',resizeCanvas);
if(window.ResizeObserver){const canvasRO=new ResizeObserver(()=>resizeCanvas());canvasRO.observe(canvas);}
window.addEventListener('pagehide',()=>sendGameEvent('PLAYER_LEAVE',{userId:me.id,roundId}));
window.addEventListener('beforeunload',()=>sendGameEvent('PLAYER_LEAVE',{userId:me.id,roundId}));

bootstrap();
startTimers();
