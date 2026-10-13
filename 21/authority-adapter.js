(() => {
  'use strict';const state=s=>s?.engineState||s,move=direction=>({kind:'MOVE',direction});
  window.BoomRoomOfficialClientAdapters ||= {};
  window.BoomRoomOfficialClientAdapters[21]={
    draw(canvas,session,id,now){const s=state(session),m=s?.members?.find(m=>m.id===id);if(!m)return;const v=m.view,c=canvas.getContext('2d'),k=Math.min(canvas.width/360,canvas.height/480);c.setTransform(1,0,0,1,0,0);c.fillStyle='#080e21';c.fillRect(0,0,canvas.width,canvas.height);c.setTransform(k,0,0,k,(canvas.width-360*k)/2,(canvas.height-480*k)/2);c.save();c.translate(0,-v.cameraY);
      for(const p of v.platforms){c.fillStyle=p.type==='spring'?'#eec56a':'#49c399';c.fillRect(p.x,p.y,p.w,p.h);if(p.type==='spring'){c.fillStyle='#493718';c.fillRect(p.x+37,p.y-4,16,4);}}
      c.globalAlpha=m.alive?1:.5;c.fillStyle='#52ddf8';c.fillRect(v.x,v.y,26,34);c.fillStyle='#193049';c.fillRect(v.x+5,v.y+8,4,6);c.fillRect(v.x+16,v.y+8,4,6);c.globalAlpha=1;c.restore();c.fillStyle='rgba(8,14,33,.8)';c.fillRect(0,0,360,63);c.fillStyle='#fff';c.font='16px system-ui';c.textAlign='center';c.fillText(`${m.name} · 登頂 ${m.score} 層 · ${'♥'.repeat(Math.max(0,v.lives))}`,180,25);c.font='12px system-ui';c.fillStyle='#a3bed7';c.fillText(m.alive?'落地自動跳，左右找平台，彈簧跳更高':'已出局，可以切換其他玩家觀戰',180,47);
    },
    controls(session,uid){const s=state(session),m=s?.members?.find(m=>m.id===String(uid));return m?.alive?[{label:'◀ 左',kind:'MOVE',fields:{direction:-1},release:move(0),hold:true},{label:'右 ▶',kind:'MOVE',fields:{direction:1},release:move(0),hold:true}].map(x=>({...x,disabled:s.phase!=='playing'})):[];},
    pointer(canvas,e,session,uid){const s=state(session),m=s?.members?.find(m=>m.id===String(uid));if(!m?.alive||s.phase!=='playing')return null;if(e.type==='pointerup'||e.type==='pointercancel')return move(0);if(e.type==='pointerdown'||e.type==='pointermove'&&e.buttons){const r=canvas.getBoundingClientRect();return move(e.clientX-r.left<r.width/2?-1:1);}return null;},
    key(e,session,uid){const m=state(session)?.members?.find(m=>m.id===String(uid));if(!m?.alive||!['ArrowLeft','KeyA','ArrowRight','KeyD'].includes(e.code))return null;return move(e.type==='keyup'?0:['ArrowLeft','KeyA'].includes(e.code)?-1:1);}
  };
})();
