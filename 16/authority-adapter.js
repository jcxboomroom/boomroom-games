(() => {
  'use strict';
  const state=s=>s?.engineState||s;
  const chartPosition=t=>Math.min(Math.max(0,t),10)*1.25+Math.max(0,Math.min(t,25)-10)*1.8+Math.max(0,t-25)*2.4;
  const laneKeys={KeyA:0,KeyS:1,KeyD:2,KeyF:3,Digit1:0,Digit2:1,Digit3:2,Digit4:3};
  const pointerLanes=new Map();
  const input=(kind,lane)=>({kind,lane,at:window.BoomRoomSDK?.getServerTime()||Date.now()});
  function lane(canvas,e){const r=canvas.getBoundingClientRect(),k=Math.min(r.width/400,r.height/600),x=(e.clientX-r.left-(r.width-400*k)/2)/k;return x<0||x>=400?null:Math.floor(x/100);}
  window.BoomRoomOfficialClientAdapters ||= {};
  window.BoomRoomOfficialClientAdapters[16]={
    draw(canvas,session,id,now){const s=state(session),m=s?.members?.find(m=>m.id===id);if(!m)return;const v=m.view,c=canvas.getContext('2d'),k=Math.min(canvas.width/400,canvas.height/600);c.setTransform(1,0,0,1,0,0);c.fillStyle='#080e21';c.fillRect(0,0,canvas.width,canvas.height);c.setTransform(k,0,0,k,(canvas.width-400*k)/2,(canvas.height-600*k)/2);const elapsed=m.alive?Math.max(0,(now-s.startAt)/1000):v.deadAt/1000,pos=chartPosition(elapsed),hitY=490,px=160;
      for(let i=0;i<4;i++){c.fillStyle=i%2?'#e7ebf3':'#fafbff';c.fillRect(i*100,70,100,490);}c.fillStyle='#20c4e9';c.fillRect(0,hitY-3,400,6);
      for(const n of s.chart||[]){const y=hitY-(n.pos-pos)*px,height=n.type==='hold'?n.len*px:56,top=y-height;if(y<55||top>560)continue;const dead=v.hit.includes(n.i)||v.missed.includes(n.i);c.fillStyle=dead?'#aeb8ca':n.special==='gold'?'#edbd42':n.special==='fever'?'#ff4aab':n.special==='bomb'?'#ea4e56':n.type==='hold'?'#42bcbe':'#14213b';c.fillRect(n.lane*100+8,top,84,height);if(n.special){c.font='21px system-ui';c.textAlign='center';c.fillStyle='#fff';c.fillText(n.special==='gold'?'🪙':n.special==='fever'?'🔥':'💣',n.lane*100+50,y-19);}if(v.holding===n.i){c.strokeStyle='#0eb97d';c.lineWidth=4;c.strokeRect(n.lane*100+8,top,84,height);}}
      c.textAlign='center';c.fillStyle='#eef5ff';c.font='18px system-ui';c.fillText(`${m.name} · ${m.score} 分 · 連擊 ${v.combo}`,200,29);c.font='12px system-ui';c.fillStyle='#91aaca';c.fillText(m.alive?'只點黑／金／火焰，避開紅炸彈；長塊按住':'已出局，可切換玩家繼續觀戰',200,53);c.fillStyle='#fff';['A / 1','S / 2','D / 3','F / 4'].forEach((x,i)=>c.fillText(x,i*100+50,587));
    },
    controls(session,uid){const s=state(session),m=s?.members?.find(m=>m.id===String(uid));return m?.alive?[0,1,2,3].map(lane=>({label:['A','S','D','F'][lane],kind:'PRESS',fields:()=>({lane,at:window.BoomRoomSDK.getServerTime()}),release:()=>input('RELEASE',lane),disabled:s.phase!=='playing'})):[];},
    pointer(canvas,e,session,uid,now){const s=state(session),m=s?.members?.find(m=>m.id===String(uid));if(!m?.alive||s.phase!=='playing')return null;if(e.type==='pointerup'||e.type==='pointercancel'){const l=pointerLanes.get(e.pointerId);pointerLanes.delete(e.pointerId);return l===undefined?null:{kind:'RELEASE',lane:l,at:now};}const l=lane(canvas,e);if(l===null)return null;if(e.type==='pointerdown'){pointerLanes.set(e.pointerId,l);return {kind:'PRESS',lane:l,at:now};}return null;},
    key(e,session,uid,now){const l=laneKeys[e.code],m=state(session)?.members?.find(m=>m.id===String(uid));if(l===undefined||!m?.alive||e.repeat)return null;return {kind:e.type==='keyup'?'RELEASE':'PRESS',lane:l,at:now};}
  };
})();
