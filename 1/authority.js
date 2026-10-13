/* Official server-driven gold round. Standalone practice keeps the original game. */
(async function(){
  'use strict';
  const sdk=window.BoomRoomSDK;let session=await sdk.whenReady(),disposed=false,raf=0,deadline=0,returnTimer=0;
  const sceneScript=document.createElement('script');sceneScript.src=new URL('../shared/public-scene.js?v=1',location.href).href;
  await new Promise((resolve,reject)=>{sceneScript.onload=resolve;sceneScript.onerror=reject;document.head.append(sceneScript);});
  for(const child of document.body.children)if(!['SCRIPT','BOOMROOM-GAME-TOOLS','BOOMROOM-WAGER'].includes(child.tagName)){child.hidden=true;child.style.setProperty('display','none','important');}
  const host=document.createElement('div');host.id='gold-authority';const shadow=host.attachShadow({mode:'open'});
  shadow.innerHTML=`<style>:host{position:fixed;inset:0;background:#080f1e;color:#f5f8ff;font:14px system-ui;z-index:1}*{box-sizing:border-box}.app{height:100dvh;display:flex;flex-direction:column;padding:max(12px,env(safe-area-inset-top)) 12px max(10px,env(safe-area-inset-bottom));gap:8px}.heading{min-height:45px;padding-right:150px}h1{font-size:21px;margin:0;color:#ffdf7a}.stats{display:flex;gap:12px;justify-content:space-between}.stats b{color:#5ce3ef}.stage{position:relative;flex:1;min-height:180px;border:1px solid #324962;border-radius:15px;overflow:hidden}canvas{width:100%;height:100%;display:block;touch-action:none}#notice{position:absolute;inset:0;display:grid;place-content:center;text-align:center;background:#081021c0;font-size:23px;pointer-events:none;white-space:pre-line}[hidden]{display:none!important}.scores{display:flex;gap:8px;overflow:auto;padding:5px}.player{white-space:nowrap;border:1px solid #344760;border-radius:9px;padding:8px;font-size:12px}.self{border-color:#ffdf7a}#message{font-size:12px;color:#b9cada;min-height:20px}#result{background:#111e33;padding:12px;border-radius:12px;font-size:14px;white-space:pre-line;max-height:38dvh;overflow:auto}button{font:inherit;padding:11px;background:#54ddec;color:#082133;border:0;border-radius:10px;min-height:44px;cursor:pointer}@media(max-height:480px){.app{padding:6px;gap:4px}.heading{min-height:30px}h1{font-size:16px}.stage{min-height:90px}button,select{min-height:36px;padding:6px}}</style><main class="app"><header class="heading"><h1>爆爆搶金</h1><small>搶金、累積連擊，避開炸彈</small></header><div class="stats"><span>你的分數 <b id="score">0</b></span><span>連擊 <b id="combo">0</b></span><span id="timer">等待開局</span></div><section class="stage"><canvas id="canvas" aria-label="搶金遊戲場"></canvas><div id="notice"></div></section><div id="scores" class="scores"></div><div id="result" hidden></div><div id="message">點選金幣與鑽石；炸彈扣 250 分並中斷連擊。</div><button id="return" hidden>返回房間</button></main>`;
  document.body.append(host);const get=id=>shadow.getElementById(id),canvas=get('canvas'),scene=window.BoomRoomPublicScene;
  const update=()=>{
    session=sdk.getSession();const s=session.engineState;if(!s)return;
    const me=s.members.find(p=>p.id===String(sdk.getUser().id));get('score').textContent=(me?.score||0).toLocaleString('zh-TW');get('combo').textContent=me?.combo||0;
    get('scores').replaceChildren();for(const p of s.members){const el=document.createElement('span');el.className='player'+(p.id===String(sdk.getUser().id)?' self':'');el.textContent=`${p.name} · ${p.score.toLocaleString('zh-TW')}`;get('scores').append(el);}
    if(s.phase==='results'){
      get('result').hidden=false;get('return').hidden=false;get('result').textContent='本局排名\n'+s.rankings.map(r=>`${r.rank}. ${s.members.find(p=>p.id===r.id)?.name||'玩家'} · ${r.score} 分`).join('\n');
      const settled=session.wager?.settlement;get('message').textContent=settled?settled.status==='PAID'?'伺服器已確認派彩，可由選單查看獎池收據。':settled.status==='REFUNDED'?'本局加碼已退款。':'本局 0 加碼，不發放獎池。':'正在等候伺服器結算收據…';
      if(settled&&!deadline){deadline=performance.now()+10_000;returnTimer=setTimeout(()=>sdk.requestGameUi('LEAVE'),10_000);}
    }
  };
  const off=sdk.onSessionUpdate(update);update();
  canvas.addEventListener('pointerdown',event=>{
    const s=session.engineState;if(!['playing','draining'].includes(s.phase)||sdk.isSpectator||!s.members.find(p=>p.id===String(sdk.getUser().id))?.alive)return;
    const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width,y=(event.clientY-rect.top)/rect.height,now=sdk.getServerTime();
    const closest=s.items.filter(it=>now>=it.spawnAt).map(it=>({it,pos:scene.goldPosition(it,now)})).sort((a,b)=>Math.hypot(a.pos.x-x,a.pos.y-y)-Math.hypot(b.pos.x-x,b.pos.y-y))[0];
    if(!closest||Math.hypot(closest.pos.x-x,closest.pos.y-y)>.16)return;
    sdk.sendCommand('BOOMGOLD_COMMAND','CLAIM',{round:s.round,itemId:closest.it.id,x,y});sdk.haptic('selection');
  });
  get('return').addEventListener('click',()=>sdk.requestGameUi('LEAVE'));
  const errors=sdk.onGameEvent((name,payload,sender)=>{if(sender==='SYSTEM'&&name==='GAME_ACTION_ERROR')get('message').textContent=payload?.message||'操作未確認，請同步。';});
  function frame(){if(disposed)return;const s=session.engineState,now=sdk.getServerTime();scene.draw(canvas,session,String(sdk.getUser().id),now);get('timer').textContent=s.phase==='results'?'已結束':`${Math.max(0,Math.ceil((s.endAt-now)/1000))} 秒`;get('notice').hidden=!['lobby','countdown'].includes(s.phase);get('notice').textContent=s.phase==='countdown'?`${Math.max(1,Math.ceil((s.startAt-now)/1000))}\n準備搶金`:'等待全員確認';raf=requestAnimationFrame(frame);}
  raf=requestAnimationFrame(frame);window.addEventListener('pagehide',()=>{disposed=true;cancelAnimationFrame(raf);clearTimeout(returnTimer);off();errors();},{once:true});
})();
