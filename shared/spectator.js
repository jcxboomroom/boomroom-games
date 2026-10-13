(async function(){
  'use strict';
  const sdk=window.BoomRoomSDK,scene=window.BoomRoomPublicScene,get=id=>document.getElementById(id);
  let session=await sdk.whenReady(),target=null,raf=0,disposed=false;
  if(session.engine?.startsWith('OFFICIAL_')) {
    const number=Number(session.engine.replace('OFFICIAL_',''));
    const script=document.createElement('script');script.src=`../${number}/authority-adapter.js?v=1`;
    await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=reject;document.head.append(script);});
  }
  if(!sdk.isSpectator){get('state').textContent='請從房間的觀戰入口進入。';return;}
  function accept(){
    session=sdk.getSession();const members=scene.members(session),live=members.filter(p=>p.alive!==false);
    if(!members.some(p=>p.id===target))target=(live[0]||members[0])?.id||null;
    get('title').textContent=session.gameName+' · 觀戰';const select=get('target');select.replaceChildren();
    for(const p of members){const option=document.createElement('option');option.value=p.id;option.textContent=p.name+(p.alive===false?' · 已淘汰':'');select.append(option);}select.value=target||'';
    const p=members.find(p=>p.id===target);get('stats').textContent=p?`觀看 ${p.name} · ${session.engine==='BLUFF'?'剩餘手牌數':'分數'} ${p.score||0}`:'等候玩家狀態';
    const phase=session.engineState?.phase||session.engineState?.public?.phase;
    get('state').textContent=['results','RESULT','MATCH_RESULT'].includes(phase)?'本局已結束，保留排名供檢視。':phase==='lobby'||session.wager?.phase==='PROPOSAL'?'等候參賽者確認與開局。':'觀戰中 · 隱藏未公開的手牌與內容';
  }
  get('target').addEventListener('change',e=>{target=e.target.value;accept();});
  const off=sdk.onSessionUpdate(accept),ended=sdk.onSessionEnd(()=>get('state').textContent='對局已結束，返回房間。');accept();
  function frame(){if(disposed)return;scene.draw(get('canvas'),session,target,sdk.getServerTime());raf=requestAnimationFrame(frame);}raf=requestAnimationFrame(frame);
  window.addEventListener('pagehide',()=>{disposed=true;cancelAnimationFrame(raf);off();ended();},{once:true});
})();
