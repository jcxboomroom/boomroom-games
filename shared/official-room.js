/* Official rule adapters share transport, tools, targets and settlement presentation. */
(async function(){
 'use strict';
 const source=document.currentScript.src,sdk=window.BoomRoomSDK;
 let session=await sdk.whenReady(),target=String(sdk.getUser().id),disposed=false,raf=0,lastSent=0;const holds=new Set();
 const number=Number(session.engine?.replace('OFFICIAL_',''));
 const load=url=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=url;s.onload=resolve;s.onerror=reject;document.head.append(s);});
 await load(new URL(`../${number}/authority-adapter.js?v=1`,source).href);
 const adapter=window.BoomRoomOfficialClientAdapters?.[number];
 if(!adapter)throw new Error('遊戲規則介面尚未載入');
 for(const c of document.body.children)if(!['SCRIPT','BOOMROOM-GAME-TOOLS','BOOMROOM-WAGER'].includes(c.tagName)){c.hidden=true;c.style.setProperty('display','none','important');}
 const host=document.createElement('div');const shadow=host.attachShadow({mode:'open'});
 shadow.innerHTML=`<style>:host{position:fixed;inset:0;background:#080f1e;color:#edf5ff;font:14px system-ui;z-index:1}*{box-sizing:border-box}[hidden]{display:none!important}.app{height:100dvh;display:flex;flex-direction:column;gap:8px;padding:max(12px,env(safe-area-inset-top)) 12px max(12px,env(safe-area-inset-bottom))}header{padding-right:145px;min-height:44px}h1{font-size:20px;margin:0}.stats{display:flex;gap:12px;justify-content:space-between;flex-wrap:wrap}.stage{flex:1;min-height:150px;position:relative;overflow:hidden;border:1px solid #334c69;border-radius:12px}canvas{width:100%;height:100%;display:block;touch-action:none}button,select,input{font:inherit;color:#edf5ff;background:#192b43;border:1px solid #4c6a81;border-radius:9px;padding:10px;min-height:44px}button{cursor:pointer;touch-action:none}button:disabled{opacity:.4}.controls{display:flex;gap:6px;flex-wrap:wrap;max-height:27dvh;overflow:auto}.controls button{flex:1;min-width:66px}.controls input{min-width:120px;flex:1}.message{font-size:12px;min-height:18px;color:#ebd68c}.result{white-space:pre-line;max-height:22dvh;overflow:auto;background:#162641;padding:10px;border-radius:8px}@media(max-height:480px){.app{padding:6px;gap:4px}header{min-height:28px}h1{font-size:16px}.stage{min-height:80px}button,select,input{min-height:36px;padding:6px}.controls{max-height:24dvh}}</style><main class="app"><header><h1 id="title"></h1></header><div class="stats"><span id="score"></span><span id="clock"></span></div><select id="target" aria-label="選擇觀戰玩家" hidden></select><section class="stage"><canvas id="canvas" aria-label="遊戲場景"></canvas></section><div class="controls" id="controls"></div><div id="message" class="message" role="status"></div><div id="result" class="result" hidden></div><button id="leave">返回房間</button></main>`;
 const landscape=document.createElement('style');landscape.textContent='@media(max-height:480px) and (min-width:600px){.app{display:grid;grid-template-columns:minmax(0,1fr) minmax(180px,28vw);grid-template-rows:28px 22px minmax(0,1fr) auto auto 36px;gap:4px}header{grid-column:1;grid-row:1;padding-right:0}.stats{grid-column:1;grid-row:2}#target{grid-column:2;grid-row:1;min-height:28px;padding:3px;font-size:12px}.stage{grid-column:1;grid-row:3/7;min-height:0}#controls{grid-column:2;grid-row:2/4;max-height:none;min-height:0;align-content:flex-start}#result{grid-column:2;grid-row:4;max-height:24dvh}#message{grid-column:2;grid-row:5}#leave{grid-column:2;grid-row:6}}';shadow.append(landscape);
 document.body.append(host);const get=id=>shadow.getElementById(id),me=String(sdk.getUser().id);let controlKey='',inputs=new Map();
 const state=()=>session.engineState||{},members=()=>state().members||[];
 function canInput(){const self=members().find(p=>String(p.id)===me);return !sdk.isSpectator&&session.status==='PLAYING'&&self?.alive!==false&&!self?.left&&!['results','interrupted'].includes(state().phase);}
 function send(intent,force=false){if(!intent||!canInput()||typeof intent.kind!=='string')return;if(adapter.local?.(intent,sdk,session,me)===true)return;const now=Date.now();if(!force&&!['STOP','UP','CASHOUT','EXIT'].includes(intent.kind)&&now-lastSent<20)return;lastSent=now;const {kind,...fields}=intent;sdk.sendCommand('ARENA_COMMAND',kind,{...fields,round:state().round});}
 function renderControls(){
  let controls=canInput()?adapter.controls?.(session,me)||[]:[];
  const key=JSON.stringify(controls.map(c=>[c.label,c.kind,c.disabled,c.input,c.field,typeof c.fields==='function'?'dynamic':c.fields]));
  if(key===controlKey)return;controlKey=key;for(const id of holds)clearInterval(id);holds.clear();get('controls').replaceChildren();inputs=new Map();
  for(const item of controls){let input;
   if(item.input){input=document.createElement('input');input.type=item.input==='number'?'number':'text';input.placeholder=item.placeholder||item.label;input.setAttribute('aria-label',item.placeholder||item.label);input.maxLength=120;get('controls').append(input);inputs.set(item.kind,input);}
   const button=document.createElement('button');button.textContent=item.label;button.disabled=Boolean(item.disabled);button.addEventListener('pointerdown',e=>e.preventDefault());
   const press=()=>{let fields=typeof item.fields==='function'?item.fields(session,me):item.fields||{};if(fields===null)return;if(input)fields={...fields,[item.field||'text']:input.value};send({kind:item.kind,...fields});};
   if(item.release){let timer,pressed=false;button.addEventListener('pointerdown',e=>{if(button.disabled||pressed)return;pressed=true;button.setPointerCapture?.(e.pointerId);press();if(item.hold===true){timer=setInterval(press,300);holds.add(timer);}});const release=()=>{if(!pressed)return;pressed=false;clearInterval(timer);holds.delete(timer);const r=typeof item.release==='function'?item.release(session,me):item.release;send(r,true);};button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);}else button.addEventListener('click',press);get('controls').append(button);
  }
 }
 function accept(){
  session=sdk.getSession();const s=state(),list=members(),self=list.find(p=>String(p.id)===me),watching=sdk.isSpectator||self?.alive===false||self?.left||s.phase==='results';
  if(!watching)target=me;else if(!list.some(p=>String(p.id)===target&&p.alive!==false&&!p.left))target=String((list.find(p=>p.alive!==false&&!p.left)||list[0])?.id||'');
  get('title').textContent=session.gameName+(watching?' · 觀戰':'');get('target').hidden=!watching;
  const options=list.map(p=>({id:String(p.id),text:p.name+(p.alive===false||p.left?' · 已出局':'')}));
  if(JSON.stringify(options)!==get('target').dataset.options){get('target').replaceChildren(...options.map(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.text;return o;}));get('target').dataset.options=JSON.stringify(options);}get('target').value=target;
  const chosen=list.find(p=>String(p.id)===target);get('score').textContent=`${watching?'觀看 '+(chosen?.name||'玩家'):'你'} · ${chosen?.score||0} 分`;
  if(watching)get('message').textContent='可切換其他玩家的公開場景，出局後仍可留在對局。';
  else if(session.wager?.phase==='PROPOSAL')get('message').textContent='先設定本款玩法，再由全員投票與同意加碼；選單可開啟加碼介面。';
  if(s.phase==='results'){
   const receipt=session.wager?.settlement;get('result').hidden=false;
   get('result').textContent='伺服器確認排名\n'+(s.rankings||[]).map(r=>`${r.rank}. ${list.find(p=>String(p.id)===String(r.id))?.name||r.name||'玩家'} · ${r.score||0} 分`).join('\n');
   get('message').textContent=receipt?.status==='PAID'?'加碼已派彩，可從選單查看收據。':receipt?.status==='REFUNDED'?'本局加碼已退款。':receipt?.status==='FREE'?'本局沒有額外加碼。':'等候伺服器結算…';
  }renderControls();
 }
 const canvas=get('canvas');for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])canvas.addEventListener(type,e=>{if(!canInput())return;if(type==='pointerdown')canvas.setPointerCapture?.(e.pointerId);const intent=adapter.pointer?.(canvas,e,session,me,sdk.getServerTime());if(intent)e.preventDefault();send(intent,type==='pointerup'||type==='pointercancel');renderControls();});
 function key(e){if(e.composedPath().some(el=>el?.matches?.('input,select,textarea')))return;const intent=adapter.key?.(e,session,me,sdk.getServerTime());if(intent){e.preventDefault();send(intent,e.type==='keyup');}renderControls();}window.addEventListener('keydown',key);window.addEventListener('keyup',key);
 get('target').addEventListener('change',e=>{target=e.target.value;accept();});get('leave').addEventListener('click',()=>sdk.requestGameUi('LEAVE'));
 const off=sdk.onSessionUpdate(accept),errors=sdk.onGameEvent((name,payload,sender)=>{if(name==='GAME_ACTION_ERROR'&&sender==='SYSTEM')get('message').textContent=payload?.message||'請重新同步';});accept();
 const disposeAdapter=adapter.attach?.(sdk,{send,showMessage:message=>get('message').textContent=message});
 function frame(){if(disposed)return;const s=state(),now=sdk.getServerTime();const w=Math.max(1,Math.round(canvas.clientWidth)),h=Math.max(1,Math.round(canvas.clientHeight));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}adapter.draw(canvas,session,target,now);get('clock').textContent=s.phase==='countdown'?`倒數 ${Math.max(1,Math.ceil((s.startAt-now)/1000))}`:s.phase==='playing'?`${Math.max(0,Math.ceil((s.endAt-now)/1000))} 秒`:s.phase==='results'?'已結束':'準備中';raf=requestAnimationFrame(frame);}raf=requestAnimationFrame(frame);
 window.addEventListener('pagehide',()=>{disposed=true;cancelAnimationFrame(raf);for(const id of holds)clearInterval(id);disposeAdapter?.();off();errors();window.removeEventListener('keydown',key);window.removeEventListener('keyup',key);},{once:true});
})().catch(error=>{console.error(error);const panel=document.createElement('section');panel.setAttribute('role','alert');panel.style.cssText='position:fixed;inset:0;z-index:1000;display:grid;place-content:center;gap:16px;text-align:center;padding:24px;background:#0c1628;color:#fff;font:16px system-ui';const message=document.createElement('p');message.textContent='遊戲資源未完整載入，請返回房間後重新進入。';const leave=document.createElement('button');leave.textContent='返回房間';leave.style.cssText='padding:14px;font:inherit';leave.onclick=()=>window.BoomRoomSDK?.requestGameUi('LEAVE');panel.append(message,leave);document.body.append(panel);});
