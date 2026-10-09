/* Start embedded games only after the real host has supplied a valid session.
 * Standalone pages retain their explicit local practice flow. */
(function (root) {
  'use strict';
  const script = root.document.currentScript;
  const embedded = root.parent !== root || new URL(root.location.href).searchParams.get('boomroomHost') === '1';
  let started = false;
  async function start() {
    if (started) return;
    started = true;
    const pending = [...root.document.querySelectorAll('script[type="application/boomroom-game"]')];
    for (const original of pending) {
      const executable = root.document.createElement('script');
      const type = original.getAttribute('data-boomroom-type');
      if (type) executable.type = type;
      const src = original.getAttribute('data-boomroom-src');
      const loaded = src || type === 'module' ? new Promise((resolve, reject) => {
        executable.onload = resolve;
        executable.onerror = () => reject(new Error('遊戲資源載入失敗'));
      }) : null;
      if (src) executable.src = src;
      else executable.textContent = original.textContent;
      original.replaceWith(executable);
      if (loaded) await loaded;
    }
  }
  function failed(error) {
    root.console.error('BoomRoom game startup failed:', error);
    const panel = root.document.createElement('div');
    panel.setAttribute('role','alert');
    panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-content:center;text-align:center;padding:24px;background:#101728;color:#fff;font:16px system-ui';
    panel.textContent = '遊戲載入失敗，請返回房間後重新開始。';
    root.document.body.appendChild(panel);
  }
  if (!embedded) { start().catch(failed); return; }
  const sdkScript = root.document.createElement('script');
  sdkScript.src = new URL(script.getAttribute('data-sdk'),script.src).href;
  sdkScript.setAttribute('data-legacy-callbacks',script.getAttribute('data-legacy-callbacks') || 'false');
  sdkScript.onload = () => {
    root.BoomRoomSDK.onSessionStart(() => start().catch(failed));
    root.dispatchEvent(new Event('BoomRoomSDKTransportReady'));
  };
  sdkScript.onerror = () => failed(new Error('SDK 載入失敗'));
  root.document.head.appendChild(sdkScript);
})(window);
