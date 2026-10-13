(() => {
  'use strict';
  const state = s => s?.engineState || s;
  const me = (s,id) => state(s)?.members?.find(m=>m.id===String(id));
  function view(canvas,w=600,h=620){const c=canvas.getContext('2d'),scale=Math.min(canvas.width/w,canvas.height/h),ox=(canvas.width-w*scale)/2,oy=(canvas.height-h*scale)/2;c.setTransform(1,0,0,1,0,0);c.fillStyle='#080e21';c.fillRect(0,0,canvas.width,canvas.height);c.setTransform(scale,0,0,scale,ox,oy);return c;}
  function point(canvas,e,w=600,h=620){const r=canvas.getBoundingClientRect(),k=Math.min(r.width/w,r.height/h);return {x:(e.clientX-r.left-(r.width-w*k)/2)/k,y:(e.clientY-r.top-(r.height-h*k)/2)/k};}
  const move = direction => ({kind:'MOVE',direction});
  window.BoomRoomOfficialClientAdapters ||= {};
  window.BoomRoomOfficialClientAdapters[13]={
    draw(canvas,session,selectedId,now){const s=state(session);if(!s)return;const c=view(canvas);c.textAlign='center';c.font='bold 20px system-ui';
      ['穩定號 A · 慢成長','狂暴號 B · 快成長'].forEach((text,i)=>{c.fillStyle=i?'#ff65c8':'#44e4ff';c.fillText(text,150+i*300,34);c.fillStyle='#101c37';c.fillRect(i*300+20,50,260,490);c.strokeStyle='#263a60';c.strokeRect(i*300+20,50,260,490);});
      const delta=Math.max(0,Math.min(.2,(now-s.at)/1000));for(const o of s.items||[]){const center=o.rocket==='B'?450:150;c.font=o.type==='meteor'?'27px system-ui':'22px system-ui';c.fillText(o.type==='meteor'?'☄️':'⚡',center+o.x*130,50+(o.y+o.speed*delta)*490);}
      for(const m of s.members||[]){const v=m.view,center=v.rocket==='B'?450:150;c.globalAlpha=m.alive?1:.4;c.font=m.id===selectedId?'34px system-ui':'25px system-ui';c.fillText(v.status==='crashed'?'💥':'🚀',center+v.x*130,50+.8*490);c.font='11px system-ui';c.fillStyle='#fff';c.fillText(m.name.slice(0,10),center+v.x*130,470);if(m.id===selectedId){c.strokeStyle='#ffe477';c.strokeRect(center+v.x*130-26,414,52,48);}c.globalAlpha=1;}
      const m=me(session,selectedId);if(m){c.fillStyle='#fff';c.font='18px system-ui';c.fillText(`${m.name} · ${'❤️'.repeat(Math.max(0,m.view.health))} · ${Number(m.view.multiplier||0).toFixed(2)}×`,300,575);c.fillStyle='#8db1d7';c.font='15px system-ui';c.fillText(m.alive?(now<s.cashoutAfter?`保護期：${Math.ceil((s.cashoutAfter-now)/1000)} 秒後可彈射`:'避開隕石，選擇彈射時機'):m.view.status==='cashed'?`已彈射 · ${m.score} 分`:'已出局，可以切換玩家觀戰',300,601);}
    },
    controls(session,userId){const s=state(session),m=me(session,userId);if(!m)return [];const choosing=s.phase==='lobby'||s.phase==='countdown';return [{label:'穩定號 A',kind:'SELECT',fields:{rocket:'A'},disabled:!choosing},{label:'狂暴號 B',kind:'SELECT',fields:{rocket:'B'},disabled:!choosing},{label:'◀ 左移',kind:'MOVE',fields:{direction:-1},release:move(0),hold:true,disabled:!m.alive||s.phase!=='playing'},{label:'右移 ▶',kind:'MOVE',fields:{direction:1},release:move(0),hold:true,disabled:!m.alive||s.phase!=='playing'},{label:'彈射！',kind:'CASHOUT',disabled:!m.alive||s.phase!=='playing'}];},
    pointer(canvas,e,session,userId){const s=state(session),m=me(session,userId);if(!m?.alive||s.phase!=='playing')return null;if(e.type==='pointerup'||e.type==='pointercancel')return move(0);if(e.type==='pointerdown'||e.type==='pointermove'&&e.buttons){const p=point(canvas,e),center=m.view.rocket==='B'?450:150;return move(p.x<center?-1:1);}return null;},
    key(e,session,userId){const m=me(session,userId);if(!m?.alive)return null;if(['ArrowLeft','KeyA','ArrowRight','KeyD'].includes(e.code))return move(e.type==='keyup'?0:['ArrowLeft','KeyA'].includes(e.code)?-1:1);if(e.type==='keydown'&&!e.repeat&&e.code==='Space')return {kind:'CASHOUT'};return null;}
  };
})();
