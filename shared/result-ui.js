(function(root){
 'use strict';
 root.BoomRoomResultUI={attach(sdk){
  if(root.document.querySelector('boomroom-result'))return;
  const host=root.document.createElement('boomroom-result'),shadow=host.attachShadow({mode:'open'});
  shadow.innerHTML='<style>:host{position:fixed;inset:0;z-index:2000;background:#071222ed;color:#f5f8ff;font:14px system-ui;display:grid;place-items:center;padding:16px}:host([hidden]){display:none}.panel{width:min(760px,100%);max-height:90dvh;overflow:auto;background:#11253b;border:1px solid #527087;border-radius:16px;padding:20px}h2{color:#ffdf7a;margin:0 0 12px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid #344c61}p{line-height:1.6}button{min-height:44px;background:#5ce3ef;border:0;border-radius:8px;padding:10px;cursor:pointer}small{color:#a8bfd1}</style><section class="panel"><h2 id="title"></h2><p id="status"></p><div id="ranking"></div><p id="money"></p><p id="clock"></p><small id="board"></small></section>';
  host.hidden=true;root.document.body.append(host);const el=id=>shadow.getElementById(id);let disposed=false,timer;
  function update(){
   const s=sdk.getSession(),c=s?.completion;if(!c){host.hidden=true;return;}
   const free=s.economicMode==='PRACTICE';
   host.hidden=false;el('title').textContent=`${c.gameName} · 本局結算`;
   el('status').textContent=free?'免費練習結果已由伺服器驗證，不登正式榜、不發銀幣。':c.leaderboardStatus==='RECORDED'?'伺服器已驗證並登錄分數。':c.leaderboardStatus==='NOT_ELIGIBLE'?'沒有有效可登錄成績，返回時間不受影響。':'排行榜待處理，伺服器將重試；返回時間不受影響。';
   el('ranking').replaceChildren();const table=root.document.createElement('table'),header=root.document.createElement('tr');
   for(const name of ['名次／玩家','遊戲分數','結果','最佳／榜名']){const cell=root.document.createElement('th');cell.textContent=name;header.append(cell);}table.append(header);
   for(const r of c.rankings){const line=root.document.createElement('tr');
    const texts=[`${r.rank||'—'}. ${r.name}${r.bot?' · AI':''}${r.effectiveRank&&r.effectiveRank!==r.rank?` · 有效第 ${r.effectiveRank} 名`:''}`,String(r.gameScore??0),r.forfeited?'退出':r.outcome==='NO_RESULT'?'無有效結果':r.outcome==='DRAW'?'平手':r.outcome==='WIN'?'勝利':'失敗',free?'免費局不登榜':r.bot?'不列入真人榜':r.forfeited||r.outcome==='NO_RESULT'?'不登錄':r.personalBest===null?'待處理':`${r.personalBest}／${r.leaderboardRank}${r.recordBroken?' 🏆破紀錄':''}`];
    for(const text of texts){const cell=root.document.createElement('td');cell.textContent=text;line.append(cell);}table.append(line);
   }el('ranking').append(table);
   const receipt=s.wager?.settlement,self=String(sdk.getUser().id),award=receipt?.awards?.find(a=>String(a.id)===self),amount=s.wager?.amount||0;
   el('money').textContent=free?'本局入場、加碼、派彩皆為 0 銀幣；可回原房再玩或邀請朋友。':`本局賭金 ${amount} 銀幣 · 獎池 ${receipt?.pot||0} · ${receipt?.status||'等待金流確認'}${sdk.isSpectator?'':` · 獎金 ${award?.payout||0} · 賭金餘額變動 ${(award?.payout||0)-amount} · 可用銀幣 ${s.wager?.balance??'同步中'}`}`;
   el('board').textContent=`排行榜條件：${c.modeLabel||c.mode} · ${c.scoreRule}；遊戲分數與銀幣分開計算。`;
  }
  function clock(){if(disposed)return;const c=sdk.getSession()?.completion;if(c)el('clock').textContent=`${Math.max(0,Math.ceil((c.returnAt-sdk.getServerTime())/1000))} 秒後返回原房間${sdk.getServerTime()>=c.returnAt?' · 等待伺服器確認':''}`;}
  const off=sdk.onSessionUpdate(update);update();clock();timer=setInterval(clock,200);
  root.addEventListener('pagehide',()=>{disposed=true;clearInterval(timer);off();},{once:true});
 }};
})(window);
