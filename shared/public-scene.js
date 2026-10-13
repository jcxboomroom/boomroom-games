(function(root){
  'use strict';
  const colors={coin:'#ffe68a',gold:'#ffbb35',gem:'#55f6ff',bomb:'#ff405d'};
  function goldPosition(it,now){const p=Math.min(1,Math.max(0,(now-it.spawnAt)/4600)),e=p*p*(3-2*p);return {x:Math.min(96,Math.max(4,it.x+it.drift*p+it.curve*Math.sin(p*Math.PI)+Math.sin(it.wobble+p*Math.PI*1.7)*(2.5+p*3.5)))/100,y:(it.startY+138*e)/100};}
  function draw(canvas,session,selected,now){
    const number=Number(session?.engine?.replace('OFFICIAL_',''));
    if(window.BoomRoomOfficialClientAdapters?.[number]){const w=Math.max(1,Math.round(canvas.clientWidth)),h=Math.max(1,Math.round(canvas.clientHeight));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}return window.BoomRoomOfficialClientAdapters[number].draw(canvas,session,selected,now);}
    const w=canvas.clientWidth||600,h=canvas.clientHeight||600,ratio=Math.min(devicePixelRatio||1,2);
    if(canvas.width!==Math.round(w*ratio)||canvas.height!==Math.round(h*ratio)){canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);}
    const c=canvas.getContext('2d');c.setTransform(ratio,0,0,ratio,0,0);c.fillStyle='#080f1e';c.fillRect(0,0,w,h);
    let s=session?.engineState;if(!s)return;
    if(session.engine==='GOMOKU'&&s.tournament)s=s.tournament.tables.find(t=>t.id===selected)?.state||s;
    if(session.engine==='BOOMGOLD'){
      for(const item of s.items||[]){if(now<item.spawnAt)continue;const pos=goldPosition(item,now),size=Math.max(14,Math.min(w,h)*.045)*item.size,x=pos.x*w,y=pos.y*h;
        c.save();c.translate(x,y);c.fillStyle=colors[item.type];c.shadowColor=colors[item.type];c.shadowBlur=14;
        if(item.type==='gem'){c.beginPath();c.moveTo(0,-size);c.lineTo(size,0);c.lineTo(0,size);c.lineTo(-size,0);c.closePath();c.fill();}
        else{c.beginPath();c.arc(0,0,size,0,Math.PI*2);c.fill();c.fillStyle='#071221';c.font=`bold ${size}px system-ui`;c.textAlign='center';c.textBaseline='middle';c.fillText(item.type==='bomb'?'×':item.type==='gold'?'G':'◈',0,0);}
        c.restore();
      }
    }else if(session.engine==='STACK'){
      const member=s.members.find(p=>p.id===selected),view=member?.view;if(!view)return;
      const scale=w/400,blockHeight=Math.max(20,Math.min(42,h/11)),shown=view.blocks.slice(-9),base=h-30;
      shown.forEach((block,i)=>{c.fillStyle=`hsl(${190+block[2]*17},100%,65%)`;c.shadowColor=c.fillStyle;c.shadowBlur=8;c.fillRect(block[0]*scale,base-(i+1)*blockHeight,block[1]*scale,blockHeight-3);});c.shadowBlur=0;
      if(member.alive&&['playing','countdown'].includes(s.phase)){
        const width=view.width,left=Math.max(12,200-160-width/2),right=Math.min(388-width,200+160-width/2),range=right-left,
          speed=Math.min(860,260+Math.pow(view.layers,1.16)*9.5),cycle=Math.max(0,now-view.movingSince)/1000*speed%(2*range),p=cycle<=range?cycle:2*range-cycle,
          x=view.direction===1?left+p:right-p;
        c.fillStyle='#ffdf75';c.fillRect(x*scale,base-(shown.length+1)*blockHeight,width*scale,blockHeight-3);
      }
    }else if(session.engine==='GOMOKU'){
      const n=15,size=Math.min(w,h)*.91,unit=size/n,x=(w-size)/2+unit/2,y=(h-size)/2+unit/2;
      c.strokeStyle='#54728d';c.lineWidth=1;
      for(let i=0;i<n;i++){c.beginPath();c.moveTo(x+i*unit,y);c.lineTo(x+i*unit,y+unit*(n-1));c.moveTo(x,y+i*unit);c.lineTo(x+unit*(n-1),y+i*unit);c.stroke();}
      for(let r=0;r<n;r++)for(let col=0;col<n;col++)if(s.board?.[r]?.[col]){c.fillStyle=s.board[r][col]===1?'#101010':'#f1f5fa';c.strokeStyle='#92a7bc';c.beginPath();c.arc(x+col*unit,y+r*unit,unit*.4,0,Math.PI*2);c.fill();c.stroke();}
    }else if(session.engine==='TETRIS'){
      const member=s.members?.find(m=>m.id===selected),v=member?.view;if(!v)return;
      const board=s.boardEncoding==='digits-v1'?v.board.map(row=>[...row].map(Number)):v.board;
      const size=Math.min(w/10,h/20),x=(w-size*10)/2,y=(h-size*20)/2,palette=['','#55dbea','#f0d56a','#b394f5','#7bdb9e','#ee718a','#669ff4','#eda776','#7d8b9e'];
      for(let r=2;r<22;r++)for(let col=0;col<10;col++)if(board[r][col]){c.fillStyle=palette[board[r][col]];c.fillRect(x+col*size+1,y+(r-2)*size+1,size-2,size-2);}
      const shapes={T:[[0,1,0],[1,1,1],[0,0,0]],I:[[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],O:[[1,1],[1,1]],S:[[0,1,1],[1,1,0],[0,0,0]],Z:[[1,1,0],[0,1,1],[0,0,0]],J:[[1,0,0],[1,1,1],[0,0,0]],L:[[0,0,1],[1,1,1],[0,0,0]]};
      if(v.active&&v.status==='playing'){let shape=shapes[v.active.type];if(shape){for(let i=0;i<v.active.rotation;i++)shape=shape[0].map((_,col)=>shape.map(row=>row[col]).reverse());c.fillStyle='#f4dd7d';shape.forEach((row,r)=>row.forEach((cell,col)=>{const yy=v.active.y+r-2;if(cell&&yy>=0)c.fillRect(x+(v.active.x+col)*size+1,y+yy*size+1,size-2,size-2);}));}}
    }else if(session.engine==='BLUFF'){
      const pub=s.public||s,players=pub.players||[];c.textAlign='center';c.fillStyle='#e3edf6';c.font='bold 18px system-ui';
      c.fillText('公開牌桌',w/2,Math.max(35,h*.12));c.font='14px system-ui';
      c.fillText(`牌堆 ${pub.pileCount||0} 張 · 宣稱 ${pub.lastClaim?.count||0} 張 ${pub.lastClaim?.rank||'—'}`,w/2,h*.25);
      players.forEach((p,i)=>{const yy=h*.38+i*30;c.fillStyle=String(p.id)===selected?'#5ce3ef':'#b5c5d7';c.fillText(`${p.username} · 剩餘 ${p.cardCount} 張${p.id===pub.currentTurnId?' · 本回合':''}`,w/2,yy);});
      c.fillStyle='#91a6b9';c.fillText('觀戰不顯示未公開的手牌與牌面',w/2,h-25);
    }
  }
  function members(session){const s=session?.engineState;if(!s)return [];if(session.engine==='GOMOKU'&&s.tournament)return s.tournament.tables.map(t=>({id:t.id,name:`第 ${t.round} 輪 · ${session.players.find(p=>Number(p.userId??p.id)===t.blackId)?.username||t.blackId} vs ${session.players.find(p=>Number(p.userId??p.id)===t.whiteId)?.username||t.whiteId}`,score:0,alive:!t.scored}));if(session.engine==='GOMOKU')return (session.players||[]).map(p=>({id:String(p.userId??p.id),name:p.username,score:s.scores?.[p.userId??p.id]||0,alive:true}));if(session.engine==='BLUFF')return (s.public?.players||[]).map(p=>({id:p.id,name:p.username,score:p.cardCount,alive:true}));return s.members||[];}
  root.BoomRoomPublicScene={draw,goldPosition,members};
})(window);
