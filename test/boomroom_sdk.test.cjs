const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const source = readFileSync(join(__dirname,'../shared/boomroom-sdk.js'),'utf8');
const sessionId='01234567-89ab-cdef-0123-456789abcdef';
const init={action:'initSDK',roomId:'8',gameSessionId:sessionId,isHost:true,
  user:{id:7,username:'actual user'},roomPlayers:[{id:7},{id:9}],
  session:{sessionId,roomId:'8',players:[{userId:7},{userId:9}],serverTime:10000,startTime:13500,seed:19,status:'PLAYING',version:1}};

// Controlled window/message/time transport. These tests do not prove browser
// WindowProxy isolation, real OAuth, real multiplayer or server settlement.
function browser(previous) {
  let time=100;
  const callbacks=new Map(),timers=new Map(),tasks=[],sent=[];
  const parent={postMessage:(data,origin)=>sent.push({data:JSON.parse(data),origin})};
  const w={document:{referrer:'https://app.example/room'},performance:{now:()=>time},
    console:{error:()=>{}},queueMicrotask:task=>tasks.push(task),
    setTimeout:task=>{const id=Symbol();timers.set(id,task);return id;},clearTimeout:id=>timers.delete(id),
    addEventListener:(name,callback)=>{if(!callbacks.has(name)) callbacks.set(name,new Set());callbacks.get(name).add(callback);},
    removeEventListener:(name,callback)=>callbacks.get(name)?.delete(callback),
    BoomRoomSDK:previous};
  w.parent=previous?w:parent;
  vm.runInNewContext(source,{window:w,URL,Date,Number,Map,Set,JSON});
  const fire=(name,event)=>{for(const callback of [...(callbacks.get(name)||[])]) callback(event);};
  return {w,sdk:w.BoomRoomSDK,sent,timers,callbacks,
    deliver:(data,extra={})=>fire('message',{source:parent,origin:'https://app.example',data:JSON.stringify(data),...extra}),
    pagehide:persisted=>fire('pagehide',{persisted}),advance:delta=>time+=delta,
    flush:()=>{while(tasks.length) tasks.shift()();}};
}

test('standalone SDK waits for real initialization and never invents a user or purchase',()=>{
  const b=browser(), successes=[];
  b.sdk.onPurchaseSuccess(item=>successes.push(item));
  assert.equal(b.sdk.isReady,false); assert.equal(b.sdk.getUser(),null);
  assert.equal(b.sdk.getServerTime(),null); assert.deepEqual(b.sdk.getRoomPlayers(),[]);
  assert.equal(b.sdk.requestPurchase('shield',100),false);
  assert.equal(b.sdk.gameOver(999),false);
  assert.equal(b.sent.length,0); assert.equal(b.timers.size,0); assert.equal(successes.length,0);
});

test('a trusted parent initializes one canonical session and monotonic server clock',()=>{
  const b=browser(); let ready=0;
  b.w.onBoomRoomSDKReady=()=>ready++;
  b.deliver(init);
  assert.equal(ready,1); assert.equal(b.sdk.isReady,true); assert.equal(b.sdk.sessionId,sessionId);
  assert.equal(b.sdk.getSession().seed,19); b.advance(3500);
  assert.equal(b.sdk.getServerTime(),13500);
  const snapshot=b.sdk.getRoomPlayers();snapshot[0].id=999;
  assert.equal(b.sdk.getRoomPlayers()[0].id,7);
  b.deliver(init); assert.equal(ready,1);
});

test('reserved server game state refreshes session and clock without accepting peer or stale snapshots',()=>{
  const b=browser();b.deliver(init);
  const current={...init.session,engine:'GOMOKU',version:3,serverTime:14000,engineState:{round:2}};
  const packet={action:'gameEventReceived',roomId:'8',gameSessionId:sessionId,eventName:'GOMOKU_STATE',
    userId:9,payload:{session:current}};
  b.deliver(packet);assert.equal(b.sdk.getSession().version,1);
  b.deliver({...packet,userId:'SYSTEM'});
  assert.equal(b.sdk.getSession().version,3);assert.equal(b.sdk.getSession().engineState.round,2);
  b.advance(500);assert.equal(b.sdk.getServerTime(),14500);
  b.deliver({...packet,userId:'SYSTEM',payload:{session:init.session}});
  assert.equal(b.sdk.getSession().version,3);
  b.deliver({...packet,userId:'SYSTEM',payload:{session:{...current,sessionId:'11234567-89ab-cdef-0123-456789abcdef'}}});
  assert.equal(b.sdk.sessionId,sessionId);assert.equal(b.sdk.getSession().version,3);
});

test('sibling, wrong-origin, malformed and cross-session packets cannot initialize or deliver',()=>{
  const b=browser(),events=[]; b.sdk.onGameEvent((...args)=>events.push(args));
  b.deliver(init,{source:{}}); b.deliver(init,{origin:'https://evil.example'});
  b.deliver({...init,gameSessionId:'bad'}); assert.equal(b.sdk.isReady,false);
  b.deliver(init);
  const frame={action:'gameEventReceived',roomId:'8',gameSessionId:sessionId,eventName:'MOVE',payload:{x:1},userId:9};
  b.deliver(frame,{source:{}}); b.deliver(frame,{origin:'https://evil.example'});
  b.deliver({...frame,gameSessionId:'11234567-89ab-cdef-0123-456789abcdef'});
  b.deliver({...frame,roomId:'9'}); b.deliver({...frame,gameSessionId:undefined});
  assert.equal(events.length,0); b.deliver(frame);
  assert.equal(events.length,1); assert.deepEqual(events[0],['MOVE',{x:1},9]);
  b.deliver({...init,gameSessionId:'11234567-89ab-cdef-0123-456789abcdef'});
  assert.equal(b.sdk.sessionId,sessionId);
});

test('transport keeps legacy intent signatures and binds outbound messages to the session',()=>{
  const b=browser();b.deliver(init);
  assert.equal(b.sdk.sendGameEvent('MOVE',{x:5}),true);
  assert.equal(b.sdk.requestPurchase('entry',100),true);
  assert.equal(b.sdk.gameOver(50,8),true);
  assert.deepEqual(b.sent.map(value=>value.data.action),['sendGameEvent','requestPurchase','game_over']);
  for(const packet of b.sent) {
    assert.equal(packet.origin,'https://app.example');
    assert.equal(packet.data.gameSessionId,sessionId);assert.equal(packet.data.roomId,'8');
  }
});

test('purchases require a pending request, ignore duplicates and time out without success',()=>{
  const b=browser(),success=[],fail=[];b.deliver(init);
  b.sdk.onPurchaseSuccess(item=>success.push(item));b.sdk.onPurchaseFailed(item=>fail.push(item));
  b.deliver({action:'purchaseSuccess',itemId:'entry'});assert.equal(success.length,0);
  b.sdk.requestPurchase('entry',100);assert.equal(b.sdk.requestPurchase('entry',100),false);
  const firstRequest=b.sent.at(-1).data.requestId;
  b.deliver({action:'purchaseSuccess',itemId:'entry',requestId:firstRequest});
  b.deliver({action:'purchaseSuccess',itemId:'entry',requestId:firstRequest});
  assert.deepEqual(success,['entry']);assert.equal(b.timers.size,0);
  b.sdk.requestPurchase('late',100);
  const oldRequest=b.sent.at(-1).data.requestId;
  for(const timeout of [...b.timers.values()]) timeout();b.timers.clear();
  assert.deepEqual(fail,['late']);b.deliver({action:'purchaseSuccess',itemId:'late'});
  assert.deepEqual(success,['entry']);assert.equal(b.sdk.requestPurchase('late',100),true);
  b.deliver({action:'purchaseSuccess',itemId:'late',requestId:oldRequest});
  assert.deepEqual(success,['entry']);assert.equal(b.timers.size,1);
  b.sdk.dispose();assert.equal(b.timers.size,0);
});

test('roster replacement reports joins/leaves once and invalid duplicates do not replace it',()=>{
  const b=browser(),joined=[],left=[];b.deliver(init);
  b.sdk.onPlayerJoin(player=>joined.push(player.id));b.sdk.onPlayerLeave(player=>left.push(player.id));
  const packet={action:'roomPlayersUpdated',roomPlayers:[{id:7},{id:10}]};
  b.deliver(packet);b.deliver(packet);
  assert.deepEqual(joined,[10]);assert.deepEqual(left,[9]);
  b.deliver({...packet,roomPlayers:[{id:7},{id:7}]});assert.deepEqual(b.sdk.getRoomPlayers(),packet.roomPlayers);
});

test('lifecycle subscriptions unsubscribe and ended sessions cannot purchase or send',()=>{
  const b=browser(),starts=[],ends=[];b.deliver(init);
  const remove=b.sdk.onSessionStart(value=>starts.push(value));remove();b.flush();assert.equal(starts.length,0);
  b.sdk.onSessionStart(value=>starts.push(value));b.flush();assert.equal(starts.length,1);
  b.sdk.onSessionEnd(value=>ends.push(value));
  const packet={action:'sessionEnd',session:{...init.session,status:'ENDED',version:2}};
  b.deliver(packet);b.deliver(packet);assert.equal(ends.length,1);
  assert.equal(b.sdk.requestPurchase('entry',100),false);assert.equal(b.sdk.sendGameEvent('MOVE',{}),false);
  assert.equal(b.timers.size,0);b.sdk.dispose();
  assert.equal(b.callbacks.get('message').size,0);assert.equal(b.callbacks.get('pagehide').size,0);
});

test('unsupported score/settlement surfaces an explicit failure and does not imply an award',()=>{
  const b=browser(),errors=[];b.deliver(init);b.sdk.onError(value=>errors.push(value.code));
  assert.equal(b.sdk.submitScore(99999),false);assert.equal(b.sdk.requestSettlement(),false);
  assert.deepEqual(errors,['SCORE_SUBMISSION_UNSUPPORTED','SETTLEMENT_REQUEST_UNSUPPORTED']);assert.equal(b.sent.length,0);
});

test('native adapters preserve existing methods and restored browser pages retain subscriptions',()=>{
  const calls=[];
  const previous={getUser:()=>init.user,getSession:()=>init.session,roomId:'8',gameSessionId:sessionId,
    isHost:true,roomPlayers:init.roomPlayers,
    sendGameEvent:(...args)=>calls.push(['event',...args]),gameOver:(...args)=>calls.push(['end',...args]),
    requestPurchase:(...args)=>calls.push(['purchase',...args])};
  const b=browser(previous);assert.equal(b.sdk.isReady,true);
  b.sdk.sendGameEvent('MOVE',{x:3});b.sdk.requestPurchase('entry',100);b.sdk.gameOver(0,7);
  assert.deepEqual(calls.map(call=>call[0]),['event','purchase','end']);
  b.pagehide(true);assert.equal(b.sdk.isReady,true);
  b.pagehide(false);assert.equal(b.sdk.isReady,false);assert.equal(b.timers.size,0);
});

test('late native initialization uses the platform bridge and survives host reinjection',()=>{
  const b=browser();b.w.parent=b.w;
  const sent=[];b.w.BoomRoomJS={postMessage:value=>sent.push(JSON.parse(value))};
  assert.equal(b.w.__BoomRoomSDKInitializeHost(init),true);
  const original=b.sdk;
  assert.equal(b.w.__BoomRoomSDKInitializeHost(init),true);
  assert.equal(b.w.BoomRoomSDK,original);
  b.sdk.sendGameEvent('MOVE',{x:2});
  assert.equal(sent.length,1);assert.equal(sent[0].gameSessionId,sessionId);
  const events=[];b.sdk.onGameEvent((...args)=>events.push(args));
  b.deliver({action:'gameEventReceived',gameSessionId:sessionId,eventName:'MOVE',payload:{x:2},userId:9},{source:null,origin:''});
  assert.equal(events.length,1);
  b.sdk.dispose();assert.equal(b.w.__BoomRoomSDKInitializeHost,undefined);
});

test('invalid or absent initial participants cannot create a formal SDK session',()=>{
  for(const participants of [undefined,[],[{userId:9}],[{userId:7},{userId:7}]]) {
    const b=browser();b.deliver({...init,session:{...init.session,players:participants}});
    assert.equal(b.sdk.isReady,false);assert.equal(b.sdk.getUser(),null);
  }
});

test('an already queued old purchase timeout cannot delete a new request',()=>{
  const b=browser();b.deliver(init);
  b.sdk.requestPurchase('entry',100);const oldTimeout=[...b.timers.values()][0];
  b.deliver({action:'purchaseSuccess',itemId:'entry',requestId:b.sent.at(-1).data.requestId});
  b.sdk.requestPurchase('entry',100);oldTimeout();
  assert.equal(b.sdk.requestPurchase('entry',100),false);assert.equal(b.timers.size,1);
  b.sdk.dispose();
});
