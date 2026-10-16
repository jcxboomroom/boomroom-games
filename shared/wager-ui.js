/* All games use one consent flow; availability and coin values come from the server. */
(function(root){
  'use strict';
  if(root.BoomRoomWagerUI)return;
  let sdk,host,shadow,off,ended,uiOff,errorOff,selected=0,busyUntil=0,timer,disposed=false,setupSignature='';
  const value=n=>Number(n||0).toLocaleString('zh-TW');
  function command(kind){
    if(Date.now()<busyUntil)return;
    const state=sdk.getWagerState();
    if(sdk.getSession()?.economicMode==='PRACTICE')selected=0;
    if(kind==='VOTE'&&(!Number.isSafeInteger(selected)||selected<0||selected>state.limit)){shadow.getElementById('message').textContent='請輸入上限內的整數。';return;}
    busyUntil=Date.now()+700;
    const fields=kind==='CONFIGURE'?{deckCount:Number(shadow.getElementById('deckCount').value),challengeMode:shadow.getElementById('challengeMode').value}:selected;
    if(!sdk.requestWager(kind,fields))shadow.getElementById('message').textContent='操作未送出，請重新同步。';
    else shadow.getElementById('message').textContent='正在等候伺服器確認…';
    render();
  }
  function amount(input){selected=Number(input.value);const state=sdk.getWagerState();shadow.getElementById(input.id==='amount'?'range':'amount').value=Number.isFinite(selected)?Math.min(state.limit,Math.max(0,selected)):0;}
  function render(){
    if(disposed||!sdk?.isReady)return;
    const session=sdk.getSession(),state=sdk.getWagerState();if(!state)return;
    const humanCount=(session.players||[]).length;
    if((state.aiPractice&&humanCount===1)||(session.engine==='TETRIS'&&humanCount<2)){if(host){host.hidden=true;delete host.dataset.open;}return;}
    const free=session.economicMode==='PRACTICE';if(free)selected=0;
    if(!host)mount();
    const proposal=state.supported&&state.phase==='PROPOSAL'&&!sdk.isSpectator;
    const proposalKey=session.sessionId+':'+state.epoch;
    host.hidden=!(proposal&&host.dataset.dismissed!==proposalKey)&&!host.dataset.open;
    if(host.hidden)return;
    shadow.getElementById('heading').textContent=free?'免費練習 · 全員確認後開始':proposal?'本局加碼 · 全員同意後開始':'加碼與獎池';
    shadow.getElementById('fee').textContent=sdk.isSpectator?'免費觀戰':free?'免費練習 · 入場 0 銀幣，不加碼、不派彩、不登正式榜。':`固定入場費 ${value(state.entryFee)} 銀幣（已另行收取）`;
    shadow.getElementById('funds').textContent=free?'本局不扣款。遊戲成績與正式排行榜分開。':`目前錢包 ${value(state.balance??sdk.getUser()?.silverCoins)} · 可加碼 0–${value(state.limit)} 銀幣`;
    shadow.getElementById('rules').textContent=free?`${state.rankingRule}\n免費練習不計銀幣或正式榜；提案、歌曲或規則變更仍需全員重新確認。`:state.supported?`${state.rankingRule}\n${state.distribution}\n提案或規則變更會撤銷全員同意；中斷、未完成對局退還加碼，入場費另計。`:state.reason;
    shadow.getElementById('candidate').textContent=free?'請先完成玩法設定，再逐位送出 0 與確認。':`候選每人 ${value(state.amount)} · 預估獎池 ${value(Number(state.amount||0)*(session.players?.length||0))} 銀幣`;
    shadow.getElementById('ai').textContent=free?'真人仍需各自確認；房間 AI 身分與難度由房間設定。':session.aiSeats?.length?'只計真人票數與真人獎池；AI 不投票、不出資、不領獎。':'每位真人可提案任意整數；票最多者為候選，同票取低額。';
    const controls=shadow.getElementById('controls');controls.hidden=!proposal;
    const setup=shadow.getElementById('setup');setup.hidden=session.engine!=='BLUFF'||!proposal;
    if(!setup.hidden){
      const settings=session.engineState?.public?.settings||{},signature=settings.deckCount+'|'+settings.challengeMode;
      if(signature!==setupSignature){setupSignature=signature;shadow.getElementById('deckCount').value=settings.deckCount||1;shadow.getElementById('challengeMode').value=settings.challengeMode||'SEQUENTIAL';}
      for(const id of ['deckCount','challengeMode','configure'])shadow.getElementById(id).disabled=!sdk.isHost||Date.now()<busyUntil;
    }
    for(const id of ['amount','range']){const input=shadow.getElementById(id);input.max=state.limit||0;input.disabled=free||!proposal||Date.now()<busyUntil;if(free)input.value=0;}
    const me=String(sdk.getUser().id),players=session.players||[],allVoted=players.every(p=>Object.hasOwn(state.proposals||{},String(p.userId??p.id)));
    shadow.getElementById('confirm').disabled=!proposal||!allVoted||!!state.consents?.[me]||Date.now()<busyUntil;
    shadow.getElementById('confirm').textContent=state.consents?.[me]?'已確認，等待其他玩家':free?'確認免費練習':`確認每人 ${value(state.amount)} 銀幣`;
    shadow.getElementById('start').hidden=!sdk.isHost;
    shadow.getElementById('start').disabled=!proposal||!allVoted||!players.every(p=>state.consents?.[String(p.userId??p.id)])||Date.now()<busyUntil;
    const list=shadow.getElementById('players');list.replaceChildren();
    for(const p of players){const id=String(p.userId??p.id),row=document.createElement('div');row.className='player';row.textContent=`${p.username||'玩家'}${id===me?' · 你':''} — ${Object.hasOwn(state.proposals||{},id)?'提案 '+value(state.proposals[id]):'尚未投票'}${state.consents?.[id]?' · 已確認':''}`;list.append(row);}
    const receipt=state.settlement;shadow.getElementById('receipt').textContent=receipt?receipt.status==='PAID'?`伺服器已派彩 · 獎池 ${value(receipt.pot)} 銀幣`:receipt.status==='REFUNDED'?`已退款：${receipt.reason||'對局取消'}`:'本局 0 加碼 · 無獎池扣款':'';
    shadow.getElementById('close').hidden=false;
    shadow.getElementById('close').textContent=proposal?'先設定玩法／稍後確認':'關閉';
    if(proposal&&session.engine==='TETRIS'){document.getElementById('wagerSettings')?.setAttribute('hidden','');}
  }
  function mount(){
    host=document.createElement('boomroom-wager');host.id='boomroom-wager';shadow=host.attachShadow({mode:'open'});
    shadow.innerHTML=`<style>:host{position:fixed;inset:0;z-index:2147482800;display:grid;place-items:center;background:#070d18dc;padding:max(12px,env(safe-area-inset-top)) 12px max(12px,env(safe-area-inset-bottom));color:#edf5ff;font:14px system-ui;color-scheme:dark}:host([hidden]){display:none}*{box-sizing:border-box}[hidden]{display:none!important}.card{width:min(480px,100%);max-height:100%;overflow:auto;background:#111c30;border:1px solid #3c536c;border-radius:18px;padding:18px;overscroll-behavior:contain}h2{margin:0 0 14px;font-size:21px}p{font-size:12px;line-height:1.6;color:#afc4da;white-space:pre-line}.candidate{font-size:16px;color:#f5dd77}.player{padding:9px 0;border-top:1px solid #ffffff14;font-size:12px}button,input{font:inherit}button{min-height:44px;background:#223951;border:1px solid #456477;color:#edf5ff;border-radius:10px;padding:10px;margin:5px 0;cursor:pointer;width:100%}button:disabled{opacity:.4;cursor:default}input[type=number]{width:100%;padding:12px;border-radius:10px;border:1px solid #567387;background:#0a1526;color:white}input[type=range]{width:100%;min-height:40px;accent-color:#5ce3ef}.primary{background:#5ce3ef;color:#082133;font-weight:700}.split{display:grid;grid-template-columns:1fr 1fr;gap:8px}#message,#receipt{color:#f5dd77}button:focus-visible,input:focus-visible{outline:2px solid #f5dd77;outline-offset:2px}</style><section class="card" role="dialog" aria-modal="true" aria-labelledby="heading"><h2 id="heading"></h2><p id="fee"></p><p id="funds"></p><p id="rules"></p><p id="ai"></p><p id="candidate" class="candidate"></p><div id="controls"><label>你的提案金額<input id="amount" type="number" min="0" step="1" value="0" inputmode="numeric"></label><input id="range" type="range" min="0" step="1" value="0" aria-label="提案金額"><button id="vote">送出提案（可選 0）</button><div class="split"><button id="confirm" class="primary">確認金額</button><button id="decline">撤回確認</button></div><button id="start" class="primary">全員確認，開始遊戲</button></div><div id="players"></div><p id="receipt"></p><p id="message" role="status" aria-live="polite"></p><button id="sync">重新同步</button><button id="close">關閉</button></section>`;
    document.body.append(host);
    const setup=document.createElement('section');setup.id='setup';setup.hidden=true;
    setup.innerHTML='<p>吹牛規則 · 變更後需重新確認加碼</p><label>牌組 <select id="deckCount"><option value="1">54 張</option><option value="2">108 張</option></select></label><label>質疑方式 <select id="challengeMode"><option value="SEQUENTIAL">依座位順序</option><option value="VOTE_FIRST">全員表態</option></select></label><button id="configure">套用規則並撤回舊確認</button>';
    shadow.getElementById('candidate').before(setup);shadow.getElementById('configure').addEventListener('click',()=>command('CONFIGURE'));
    const extraStyle=document.createElement('style');extraStyle.textContent='.card{max-height:calc(100dvh - 32px)}select{font:inherit;background:#192b43;color:white;min-height:40px;padding:8px;border:1px solid #54748e;border-radius:8px;margin:4px}#setup label{display:block}';shadow.append(extraStyle);
    for(const [id,kind] of Object.entries({vote:'VOTE',confirm:'CONFIRM',decline:'DECLINE',start:'START'}))shadow.getElementById(id).addEventListener('click',()=>command(kind));
    for(const id of ['amount','range'])shadow.getElementById(id).addEventListener('input',event=>amount(event.target));
    shadow.getElementById('sync').addEventListener('click',()=>sdk.requestGameUi('SYNC'));
    shadow.getElementById('close').addEventListener('click',()=>{delete host.dataset.open;host.dataset.dismissed=sdk.getSession().sessionId+':'+sdk.getWagerState().epoch;render();});
    for(const event of ['pointerdown','pointerup','click','keydown','keyup'])host.addEventListener(event,e=>e.stopPropagation());
    timer=setInterval(()=>render(),1000);
  }
  root.BoomRoomWagerUI={attach(next){if(sdk||disposed)return;sdk=next;off=sdk.onSessionUpdate(()=>{render();if(host&&!host.hidden)shadow.getElementById('message').textContent='伺服器已更新提案與確認狀態。';});ended=sdk.onSessionEnd(()=>{if(host)host.hidden=true;});uiOff=sdk.onHostUiChange(state=>{if(host&&state.message)shadow.getElementById('message').textContent=state.message;});errorOff=sdk.onGameEvent((name,payload,sender)=>{if(host&&sender==='SYSTEM'&&['TETRIS_ERROR','GAME_ACTION_ERROR'].includes(name))shadow.getElementById('message').textContent=payload?.message||'操作未確認，請同步。';});sdk.onReady(render);render();},open(){if(!host)mount();host.dataset.open='true';render();},dispose(){disposed=true;off?.();ended?.();uiOff?.();errorOff?.();clearInterval(timer);host?.remove();}};
})(window);
