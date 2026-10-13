/* Common presentation for individually implemented authoritative party rules. */
(async function(){
  'use strict';
  const sourceUrl=document.currentScript?.src;
  const sdk=window.BoomRoomSDK;let session=await sdk.whenReady(),target=String(sdk.getUser().id),disposed=false,raf=0,lastDrop=0,returnTimer=0;
  const script=document.createElement('script');script.src=new URL('./public-scene.js?v=1',sourceUrl).href;
  await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=reject;document.head.append(script);});
  for(const child of document.body.children)if(!['SCRIPT','BOOMROOM-GAME-TOOLS','BOOMROOM-WAGER'].includes(child.tagName)){child.hidden=true;child.style.setProperty('display','none','important');}
  const host=document.createElement('div');host.id='party-authority';const shadow=host.attachShadow({mode:'open'});
  shadow.innerHTML=`<style>:host{position:fixed;inset:0;background:#080f1e;color:#edf5ff;font:14px system-ui;z-index:1}*{box-sizing:border-box}[hidden]{display:none!important}.app{height:100dvh;display:flex;flex-direction:column;padding:max(12px,env(safe-area-inset-top)) 12px max(12px,env(safe-area-inset-bottom));gap:8px}.heading{min-height:42px;padding-right:145px}h1{font-size:21px;margin:0}.stats{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}.stage{flex:1;min-height:180px;position:relative;border:1px solid #3b516b;border-radius:12px;overflow:hidden}canvas{width:100%;height:100%;display:block;touch-action:manipulation}#notice{position:absolute;inset:0;display:grid;place-content:center;text-align:center;font-size:23px;background:#0a1429c9;white-space:pre-line;pointer-events:none}button,select{font:inherit;border-radius:10px;min-height:44px;padding:10px;background:#192b43;color:white;border:1px solid #4c6a81}button{cursor:pointer}button.primary{background:#5ce3ef;color:#0b2634;font-weight:700}button:disabled{opacity:.4}#message{font-size:12px;color:#d9c987;min-height:18px}#result{white-space:pre-line;background:#152641;border-radius:10px;padding:12px;max-height:30dvh;overflow:auto}@media(max-height:480px){.app{padding:6px;gap:4px}.heading{min-height:30px}h1{font-size:16px}.stage{min-height:90px}button,select{min-height:36px;padding:6px}}</style><main class="app"><header class="heading"><h1 id="title"></h1></header><div class="stats"><span id="score"></span><span id="timer"></span></div><select id="target" aria-label="選擇觀戰玩家" hidden></select><section class="stage"><canvas id="canvas" aria-label="遊戲場"></canvas><div id="notice"></div></section><div id="message">按空白鍵或點擊畫面放下方塊，與塔身重疊越多越好。</div><button id="drop" class="primary">放下方塊</button><div id="result" hidden></div><button id="return" hidden>返回房間</button></main>`;
  document.body.append(host);const get=id=>shadow.getElementById(id),me=String(sdk.getUser().id),scene=window.BoomRoomPublicScene;
  function accept(){
    session=sdk.getSession();const s=session.engineState,self=s.members.find(p=>p.id===me),watching=!self?.alive;
    if(watching&&!s.members.some(p=>p.id===target&&p.alive))target=s.members.find(p=>p.alive)?.id||s.members[0]?.id;
    if(!watching)target=me;
    get('title').textContent=session.gameName;get('target').hidden=!watching;
    get('target').replaceChildren();for(const p of s.members){const option=document.createElement('option');option.value=p.id;option.textContent=p.name+(p.alive?'':' · 已出局');get('target').append(option);}get('target').value=target;
    const selected=s.members.find(p=>p.id===target);get('score').textContent=`${watching?'觀戰 '+(selected?.name||'玩家'):'你'} · ${selected?.layers||0} 層 · ${selected?.score||0} 分`;
    get('drop').disabled=watching||s.phase!=='playing';get('drop').hidden=watching;
    if(watching&&s.phase==='playing')get('message').textContent='已出局 · 保留對局，可切換其他玩家的塔身。';
    if(s.phase==='results'){
      get('result').hidden=false;get('return').hidden=false;get('result').textContent='本局排名\n'+s.rankings.map(r=>`${r.rank}. ${s.members.find(p=>p.id===r.id)?.name||'玩家'} · ${r.layers} 層 · ${r.score} 分`).join('\n');
      const receipt=session.wager?.settlement;get('message').textContent=receipt?receipt.status==='PAID'?'伺服器已派彩，可從選單查看獎池收據。':receipt.status==='REFUNDED'?'本局加碼已退款。':'本局 0 加碼。':'等候伺服器確認排名與派彩…';
      if(receipt&&!returnTimer)returnTimer=setTimeout(()=>sdk.requestGameUi('LEAVE'),10000);
    }
  }
  function drop(){
    const s=session.engineState,p=s.members.find(p=>p.id===me);if(s.phase!=='playing'||!p?.alive||Date.now()-lastDrop<170)return;
    lastDrop=Date.now();sdk.sendCommand('STACK_COMMAND','DROP',{round:s.round,layers:p.layers,at:sdk.getServerTime()});sdk.haptic('selection');
  }
  get('drop').addEventListener('click',drop);get('canvas').addEventListener('pointerdown',drop);
  function key(e){if(e.code==='Space'&&!e.repeat&&!e.target.matches?.('input,select,button')){e.preventDefault();drop();}}
  window.addEventListener('keydown',key);get('target').addEventListener('change',e=>{target=e.target.value;accept();});get('return').addEventListener('click',()=>sdk.requestGameUi('LEAVE'));
  const off=sdk.onSessionUpdate(accept),errors=sdk.onGameEvent((name,payload,sender)=>{if(name==='GAME_ACTION_ERROR'&&sender==='SYSTEM')get('message').textContent=payload.message;});accept();
  function frame(){if(disposed)return;const s=session.engineState,now=sdk.getServerTime();scene.draw(get('canvas'),session,target,now);get('timer').textContent=s.phase==='results'?'已結束':`${Math.max(0,Math.ceil((s.endAt-now)/1000))} 秒`;get('notice').hidden=s.phase!=='countdown';get('notice').textContent=`${Math.max(1,Math.ceil((s.startAt-now)/1000))}\n準備疊塔`;raf=requestAnimationFrame(frame);}raf=requestAnimationFrame(frame);
  window.addEventListener('pagehide',()=>{disposed=true;cancelAnimationFrame(raf);clearTimeout(returnTimer);off();errors();window.removeEventListener('keydown',key);},{once:true});
})();
