/* Shared game-owned tools. The app remains the authenticated bridge, not the UI. */
(function (root) {
  'use strict';
  if (root.BoomRoomGameUI) return;
  let sdk, state, host, shadow, observer, resizeObserver, off, config = {}, disposed = false;
  const hidden = new Set(), audioContexts = new Set(), mediaChoices = new WeakMap(), mediaVolumes = new WeakMap(), media = new Set();
  let muted = false, volume = 1, lastFocus = null;
  const originalConnect = root.AudioNode?.prototype.connect;
  const constructors = new Map();
  const mediaPrototype = root.HTMLMediaElement?.prototype;
  const mediaDescriptor = mediaPrototype && Object.getOwnPropertyDescriptor(mediaPrototype, 'muted');
  const volumeDescriptor = mediaPrototype && Object.getOwnPropertyDescriptor(mediaPrototype, 'volume');
  const originalPlay = mediaPrototype?.play;
  const originalVibrate = root.navigator?.vibrate;
  if(originalVibrate)root.navigator.vibrate=function(pattern){
    if(state?.hapticEnabled===false)return false;
    return originalVibrate.call(this,pattern);
  };
  const audioGains = new WeakMap(), routedMedia = new WeakSet();
  const audioPrototype = root.AudioContext?.prototype;
  const originalMediaSource = audioPrototype?.createMediaElementSource;
  function trackAudio(context) {
    if (audioGains.has(context)) return audioGains.get(context);
    const gain = context.createGain();
    originalConnect.call(gain, context.destination);
    gain.gain.value = muted ? 0 : volume;
    audioContexts.add(context); audioGains.set(context, gain);
    return gain;
  }
  // Route all Web Audio output through one local master gain. Game settings
  // remain upstream and are restored unchanged when the master is unmuted.
  if (originalConnect) {
    root.AudioNode.prototype.connect = function (destination, ...args) {
      if (destination === this.context.destination) destination = trackAudio(this.context);
      return originalConnect.call(this, destination, ...args);
    };
    for (const name of ['AudioContext', 'webkitAudioContext']) {
      if (!root[name]) continue;
      const original = root[name]; constructors.set(name, original);
      root[name] = new Proxy(original, { construct(target, args) {
        const context = Reflect.construct(target, args); trackAudio(context); return context;
      } });
    }
  }
  if (mediaDescriptor?.set && mediaDescriptor.configurable) {
    Object.defineProperty(mediaPrototype, 'muted', { configurable: true, enumerable: mediaDescriptor.enumerable,
      get: mediaDescriptor.get, set(value) {
        media.add(this); mediaChoices.set(this, !!value); mediaDescriptor.set.call(this, muted || !!value);
      } });
  }
  function trackMedia(element) {
    media.add(element);
    if (!mediaChoices.has(element)) mediaChoices.set(element, mediaDescriptor.get.call(element));
    if (!mediaVolumes.has(element)) mediaVolumes.set(element, volumeDescriptor.get.call(element));
    mediaDescriptor.set.call(element, muted || mediaChoices.get(element));
    volumeDescriptor.set.call(element, (routedMedia.has(element) ? 1 : volume) * mediaVolumes.get(element));
  }
  if (volumeDescriptor?.set && volumeDescriptor.configurable) Object.defineProperty(mediaPrototype,'volume',{
    configurable:true,enumerable:volumeDescriptor.enumerable,get:volumeDescriptor.get,set(value){
      value=Number(value);
      if(!Number.isFinite(value)||value<0||value>1){volumeDescriptor.set.call(this,value);return;}
      media.add(this);mediaVolumes.set(this,value);volumeDescriptor.set.call(this,value*(routedMedia.has(this)?1:volume));
    },
  });
  if (originalPlay && mediaDescriptor?.set && volumeDescriptor?.set) mediaPrototype.play = function(...args){trackMedia(this);return originalPlay.apply(this,args);};
  if(originalMediaSource)audioPrototype.createMediaElementSource=function(element){
    const source=originalMediaSource.call(this,element);routedMedia.add(element);trackMedia(element);return source;
  };
  function setAudio(nextMuted, nextVolume) {
    muted = !!nextMuted; volume = Math.max(0, Math.min(1, Number(nextVolume) || 0));
    for (const context of audioContexts) if (context.state !== 'closed') audioGains.get(context).gain.value = muted ? 0 : volume;
    if (mediaDescriptor?.set && volumeDescriptor?.set) {
      for (const element of root.document.querySelectorAll('audio,video')) media.add(element);
      for (const element of media) trackMedia(element);
    }
  }
  const helpSelectors = '#helpBtn,#btn-help,#btnHelp,#rules';
  const oldTools = helpSelectors + ',#soundBtn,#muteBtn,#btn-mute,#musicBtn,#hapticBtn';
  function hideOldTools() {
    for (const element of root.document.querySelectorAll(oldTools)) {
      if (!element.matches('button,a,[role="button"]') || hidden.has(element)) continue;
      element.setAttribute('data-boomroom-tool', 'replaced'); hidden.add(element);
    }
    // These are known header exits, never gameplay "back" or result actions.
    const game = new URL(root.location.href).pathname.match(/\/(\d+)\//)?.[1];
    const exits = {4:'#btn-exit',17:'#leaveBtn',36:'#exitBtn'};
    if (exits[game]) for (const element of root.document.querySelectorAll(exits[game])) {
      element.setAttribute('data-boomroom-tool','replaced'); hidden.add(element);
    }
  }
  function button(label, callback, parent, attributes = {}) {
    const element = root.document.createElement('button'); element.type = 'button'; element.textContent = label;
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    element.addEventListener('click', callback); parent.append(element); return element;
  }
  function status(message) { shadow.getElementById('status').textContent = message || ''; }
  function request(kind, fields = {}) {
    if (!sdk.requestGameUi(kind, fields)) status('操作未送出，請重試。');
  }
  function close() { shadow.getElementById('panel').hidden = true; shadow.getElementById('scrim').hidden = true; shadow.getElementById('menu').setAttribute('aria-expanded','false'); lastFocus?.focus(); }
  function open() {
    for (const context of audioContexts) if (context.state === 'suspended') context.resume().catch(() => {});
    lastFocus = root.document.activeElement; renderSettings(); renderVoice(); status(state.message);
    shadow.getElementById('panel').hidden = false; shadow.getElementById('scrim').hidden = false;
    shadow.getElementById('menu').setAttribute('aria-expanded','true'); shadow.getElementById('close').focus();
  }
  function showHelp() {
    if (typeof config.help === 'function') { close(); config.help(); return; }
    const help = root.document.querySelector(helpSelectors);
    if (help) { close(); help.click(); return; }
    const content = shadow.getElementById('detail'); content.hidden = false;
    content.textContent = state.help || '本款遊戲尚未提供詳細操作說明。';
  }
  function leave() {
    const detail = shadow.getElementById('detail'); detail.hidden = false;
    detail.replaceChildren(); const text = root.document.createElement('p');
    text.textContent = sdk.isHost ? '結束這場遊戲並返回房間？這會同步停止所有玩家的對局。銀幣按伺服器規則處理。' : '返回房間？進行中的對局會依遊戲規則處理離場，銀幣以伺服器結果為準。';
    detail.append(text);
    button('取消', () => { detail.hidden = true; }, detail);
    button(sdk.isHost ? '結束並返回房間' : '確認返回房間', () => { request('LEAVE'); status('正在確認返回…'); }, detail, {id:'confirmLeave'});
  }
  function renderSettings() {
    const parent = shadow.getElementById('settings'); parent.replaceChildren();
    const settings = config.settings || [...root.document.querySelectorAll('#soundBtn,#muteBtn,#btn-mute,#musicBtn,#hapticBtn')].filter(el => el.matches('button')).map(element => ({
      label: element.id === 'musicBtn' ? '遊戲音樂' : element.id === 'hapticBtn' ? '遊戲震動' : '遊戲音效',
      get: () => element.getAttribute('aria-pressed') ? element.getAttribute('aria-pressed') === 'true' : !/🔇|關閉|靜音中/.test(element.textContent),
      set: () => element.click(),
    }));
    for (const setting of settings) {
      const row = root.document.createElement('label'); row.className = 'row';
      const label = root.document.createElement('span'); label.textContent = setting.label;
      const input = root.document.createElement('input'); input.type = 'checkbox'; input.checked = !!setting.get();
      input.addEventListener('change', () => { setting.set(input.checked); input.checked = !!setting.get(); });
      row.append(label,input); parent.append(row);
    }
  }
  function renderVoice() {
    const parent = shadow.getElementById('voice'); parent.replaceChildren();
    for (const player of state.players || []) {
      const row = root.document.createElement('div'); row.className = 'row';
      const name = root.document.createElement('span'); name.textContent = player.name + (player.micMuted ? ' · 關麥' : ' · 開麥'); row.append(name);
      if (String(player.id) !== String(sdk.getUser()?.id)) button(player.locallyMuted ? '開啟聲音' : '靜音', () => request('PEER_AUDIO',{userId:player.id,muted:!player.locallyMuted}), row);
      parent.append(row);
    }
  }
  function render(next) {
    if (disposed || !next || next.protocol !== 1) return;
    state = next; setAudio(next.muted, next.volume ?? 1);
    if (!host) mount();
    shadow.getElementById('coins').textContent = Number.isSafeInteger(next.silverCoins) ? next.silverCoins.toLocaleString('zh-TW') : '—';
    shadow.getElementById('title').textContent = next.gameName || '遊戲設定';
    shadow.getElementById('mute').checked = !!next.muted;
    shadow.getElementById('volume').value = Math.round((next.volume ?? 1) * 100);
    shadow.getElementById('haptic').checked = next.hapticEnabled !== false;
    shadow.getElementById('mic').textContent = next.micMuted ? '開啟麥克風' : '關閉麥克風';
    shadow.getElementById('mic').disabled = !!next.speechActive;
    shadow.getElementById('leave').textContent = sdk.isHost ? '結束並返回房間' : '返回房間';
    shadow.getElementById('leave').disabled = !!next.ending;
    const confirm = shadow.getElementById('confirmLeave'); if (confirm) confirm.disabled = !!next.ending;
    if (next.message) status(next.message); renderVoice(); hideOldTools();
  }
  function mount() {
    host = root.document.createElement('boomroom-game-tools'); host.id = 'boomroom-game-tools';
    shadow = host.attachShadow({mode:'open'});
    shadow.innerHTML = `<style>
      :host{position:fixed;top:max(8px,env(safe-area-inset-top));right:max(10px,env(safe-area-inset-right));z-index:2147483000;color:#edf5ff;font:13px system-ui,sans-serif;color-scheme:dark;pointer-events:none}
      *{box-sizing:border-box} [hidden]{display:none!important} button,input{font:inherit} button{cursor:pointer;color:inherit;border:1px solid #ffffff20;border-radius:10px;background:#172135;padding:10px 12px;min-height:44px;touch-action:manipulation} button:disabled{opacity:.5;cursor:default} button:focus-visible,input:focus-visible{outline:2px solid #5ce3ef;outline-offset:2px}
      .capsule{pointer-events:auto;display:flex;align-items:center;gap:8px;padding:4px 4px 4px 12px;border:1px solid #ffffff26;border-radius:14px;background:#101827ec;box-shadow:0 3px 15px #0003;backdrop-filter:blur(12px)} .balance{color:#f4df75;white-space:nowrap;font-variant-numeric:tabular-nums;font-size:12px} #menu{min-height:36px;width:38px;padding:0;font-size:21px;background:#ffffff08}
      #scrim{position:fixed;inset:0;background:#03081166;pointer-events:auto} #panel{pointer-events:auto;position:fixed;right:max(10px,env(safe-area-inset-right));top:max(10px,env(safe-area-inset-top));width:min(340px,calc(100vw - 20px));max-height:calc(100dvh - 20px - env(safe-area-inset-top) - env(safe-area-inset-bottom));overflow:auto;overscroll-behavior:contain;padding:16px;background:#101827f7;border:1px solid #415570;border-radius:18px;box-shadow:0 16px 64px #0007;backdrop-filter:blur(20px)}
      .heading,.row{display:flex;align-items:center;justify-content:space-between;gap:12px} .heading{margin-bottom:14px} #title{margin:0;font-size:16px;line-height:1.4} #close{padding:0;min-width:44px;font-size:22px} .row{padding:11px 0;border-bottom:1px solid #ffffff12} .row span{min-width:0;overflow-wrap:anywhere} .row input[type=checkbox]{width:20px;height:20px;accent-color:#5ce3ef} #volume{width:145px;max-width:48%;accent-color:#5ce3ef} .actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px} #leave{width:100%;margin-top:12px;color:#ffbcbd;border-color:#e2767850} #status{color:#f4df75;font-size:12px;line-height:1.6;margin:8px 0 0;white-space:pre-line} #detail{border-top:1px solid #ffffff20;margin-top:12px;padding-top:12px;white-space:pre-line;line-height:1.7} #detail button{margin:6px 6px 0 0} #voice{font-size:12px} #voice button{font-size:11px;min-height:36px;padding:6px 9px} summary{cursor:pointer;padding:12px 0;color:#a9bdd5}
    </style><div class="capsule"><span class="balance">◈ <span id="coins">—</span></span><button id="menu" aria-label="遊戲選單" aria-expanded="false">☰</button></div>
    <div id="scrim" hidden></div><section id="panel" role="dialog" aria-modal="true" aria-labelledby="title" hidden>
    <div class="heading"><h2 id="title">遊戲設定</h2><button id="close" aria-label="關閉遊戲選單">×</button></div>
    <label class="row"><span>遊戲總靜音</span><input id="mute" type="checkbox"></label><label class="row"><span>總音量</span><input id="volume" type="range" min="0" max="100" value="100"></label>
    <label class="row"><span>震動</span><input id="haptic" type="checkbox" checked></label><div id="settings"></div>
    <div class="actions"><button id="help">玩法說明</button><button id="sync">重新同步</button></div><button id="mic" style="width:100%;margin-top:8px">開啟麥克風</button>
    <details><summary>房間語音 · 個別音量</summary><div id="voice"></div></details><button id="leave">返回房間</button><p id="status" role="status" aria-live="polite"></p><div id="detail" hidden></div></section>`;
    root.document.body.append(host);
    const style = root.document.createElement('style'); style.id = 'boomroom-game-tools-style';
    const game = new URL(root.location.href).pathname.match(/\/(\d+)\//)?.[1];
    style.textContent = '[data-boomroom-tool="replaced"]{display:none!important}' +
      (game === '36' ? '.topbar .toolbar{padding-right:var(--boomroom-tools-width,140px)}' : '') +
      (['19','26'].includes(game) ? '.shell{padding-top:max(56px,calc(50px + env(safe-area-inset-top)))!important}' : '');
    root.document.head.append(style);
    const capsule = shadow.querySelector('.capsule');
    resizeObserver = new ResizeObserver(() => root.document.documentElement.style.setProperty('--boomroom-tools-width', `${capsule.getBoundingClientRect().width + 10}px`)); resizeObserver.observe(capsule);
    for (const [id, callback] of Object.entries({menu:open,close,scrim:close,help:showHelp,leave,sync:()=>request('SYNC'),mic:()=>request('MIC',{muted:!state.micMuted})})) shadow.getElementById(id).addEventListener('click',callback);
    shadow.getElementById('mute').addEventListener('change',event=>{setAudio(event.target.checked,volume);request('MUTE',{muted:event.target.checked});});
    shadow.getElementById('volume').addEventListener('input',event=>{setAudio(muted,event.target.value/100);request('VOLUME',{volume:event.target.value/100});});
    shadow.getElementById('haptic').addEventListener('change',event=>request('HAPTIC',{enabled:event.target.checked}));
    host.addEventListener('keydown',event=>{
      event.stopPropagation(); if (event.key==='Escape') { event.preventDefault(); close(); }
      if(event.key==='Tab'&&!shadow.getElementById('panel').hidden){const controls=[...shadow.querySelectorAll('#panel button,#panel input,#panel summary')].filter(el=>!el.disabled&&el.getClientRects().length);const i=controls.indexOf(shadow.activeElement),next=(i+(event.shiftKey?-1:1)+controls.length)%controls.length;event.preventDefault();controls[next]?.focus();}
    });
    host.addEventListener('pointerdown',event=>event.stopPropagation());
    observer = new MutationObserver(hideOldTools); observer.observe(root.document.body,{childList:true,subtree:true});
    hideOldTools(); request('READY');
  }
  root.BoomRoomGameUI = {
    attach(value) { sdk = value; off?.(); off = sdk.onHostUiChange(render); },
    configure(value) { config = value || {}; return true; },
    dispose() {
      if(disposed)return; disposed=true; off?.(); observer?.disconnect(); resizeObserver?.disconnect(); root.document.documentElement.style.removeProperty('--boomroom-tools-width'); host?.remove(); root.document.getElementById('boomroom-game-tools-style')?.remove();
      for(const element of hidden)element.removeAttribute('data-boomroom-tool'); setAudio(false,1);
      if(originalConnect)root.AudioNode.prototype.connect=originalConnect;
      for(const [name,original]of constructors)root[name]=original;
      if(mediaDescriptor?.configurable)Object.defineProperty(mediaPrototype,'muted',mediaDescriptor);
      if(volumeDescriptor?.configurable)Object.defineProperty(mediaPrototype,'volume',volumeDescriptor);
      if(originalPlay)mediaPrototype.play=originalPlay;
      if(originalVibrate)root.navigator.vibrate=originalVibrate;
      if(originalMediaSource)audioPrototype.createMediaElementSource=originalMediaSource;
    },
  };
})(window);
