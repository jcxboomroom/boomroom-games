(() => {
  'use strict';
  const state=s=>s?.engineState||s;
  function point(canvas,e){const r=canvas.getBoundingClientRect(),k=Math.min(r.width/480,r.height/600);return {x:(e.clientX-r.left-(r.width-480*k)/2)/k,y:(e.clientY-r.top-(r.height-600*k)/2)/k};}
  window.BoomRoomOfficialClientAdapters ||= {};
  window.BoomRoomOfficialClientAdapters[14]={
    draw(canvas,session,id,now){const s=state(session),m=s?.members?.find(m=>m.id===id);if(!m)return;const v=m.view,c=canvas.getContext('2d'),k=Math.min(canvas.width/480,canvas.height/600);c.setTransform(1,0,0,1,0,0);c.fillStyle='#080e21';c.fillRect(0,0,canvas.width,canvas.height);c.setTransform(k,0,0,k,(canvas.width-480*k)/2,(canvas.height-600*k)/2);c.textAlign='center';c.fillStyle='#eef5ff';c.font='20px system-ui';c.fillText(`${v.target?.label||'準備開始'} · ${m.name}`,240,36);c.font='40px system-ui';c.fillStyle=v.target?.color||'#fff';c.fillText(v.target?.symbol||'🎯',240,94);c.font='16px system-ui';c.fillStyle='#9aacce';c.fillText(`剩餘 ${Math.max(0,(v.personalEnd-now)/1000).toFixed(1)}s · COMBO ${v.combo} · ${m.score} 分`,240,134);
      for(let i=0;i<(v.tiles||[]).length;i++){const o=v.tiles[i],x=22+i%3*152,y=160+Math.floor(i/3)*98;c.fillStyle='#13223c';c.fillRect(x,y,132,82);c.strokeStyle='#34486d';c.strokeRect(x,y,132,82);c.fillStyle=o.color;c.font='38px system-ui';c.fillText(o.symbol,x+66,y+54);c.font='10px system-ui';c.fillStyle='#8193b3';c.fillText(String(i+1),x+118,y+16);}
      c.font='16px system-ui';c.fillStyle=now<v.feverUntil?'#ffe073':'#dde8fa';c.fillText(m.alive?`${now<v.feverUntil?'🔥 FEVER · ':''}${v.feedback||'依規則點唯一答案'}`:'已完成，切換玩家繼續觀戰',240,581);
    },controls(){return [];},
    pointer(canvas,e,session,uid){if(e.type!=='pointerdown')return null;const s=state(session),m=s?.members?.find(m=>m.id===String(uid));if(!m?.alive||s.phase!=='playing')return null;const p=point(canvas,e),col=Math.floor((p.x-22)/152),row=Math.floor((p.y-160)/98);if(col<0||col>2||row<0||row>3||p.x-22-col*152>132||p.y-160-row*98>82)return null;return {kind:'TILE',index:row*3+col,boardVersion:m.view.boardVersion};},
    key(e,session,uid){if(e.type!=='keydown'||e.repeat)return null;const m=state(session)?.members?.find(m=>m.id===String(uid)),keys=['Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','Digit9','Digit0','Minus','Equal'],index=keys.indexOf(e.code);return m?.alive&&index>=0?{kind:'TILE',index,boardVersion:m.view.boardVersion}:null;}
  };
})();
