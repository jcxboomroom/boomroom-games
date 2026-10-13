(function () {
  'use strict';
  const adapters = window.BoomRoomOfficialClientAdapters ||= {};
  const state = session => session.engineState || {};
  const own = (s, id) => (s.members || []).find(p => p.id === String(id));
  const chaosNames = { NORMAL: '正常倒數', RUSH: '最後 5 秒暴走', LOCK: '開局禁傳', SWAP: '中段換手' };
  function spots(s) { return (s.members || []).map((p, i, a) => ({ p, x: .5 + Math.cos(-Math.PI / 2 + i / a.length * Math.PI * 2) * .35, y: .52 + Math.sin(-Math.PI / 2 + i / a.length * Math.PI * 2) * .32 })); }
  function draw(canvas, session, selectedId, now) {
    const s = state(session), c = canvas.getContext('2d'), w = canvas.width, h = canvas.height, font = Math.max(11, Math.min(18, w / 25)), holder = own(s, s.holderId), selected = own(s, selectedId);
    c.fillStyle = s.exploded ? '#311024' : '#11142a'; c.fillRect(0, 0, w, h); c.textBaseline = 'middle'; c.textAlign = 'center'; c.font = 'bold ' + font + 'px sans-serif'; c.fillStyle = '#ffad69';
    c.fillText('燙手炸彈 · ' + (chaosNames[s.chaos] || ''), w / 2, h * .058);
    c.font = font * .84 + 'px sans-serif'; c.fillStyle = now < s.jamUntil ? '#ff6788' : '#c2c9df'; c.fillText(now < s.jamUntil ? '禁傳 ' + ((s.jamUntil - now) / 1000).toFixed(1) + ' 秒' : '持有者：' + (holder?.name || '—'), w / 2, h * .12);
    const locations = spots(s), holderSpot = locations.find(a => a.p.id === s.holderId);
    for (const a of locations) {
      const x = a.x * w, y = a.y * h, r = Math.min(w * .052, h * .043);
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = a.p.left ? '#4e5265' : a.p.id === s.holderId ? '#fa7956' : '#4c6f9d'; c.fill();
      c.strokeStyle = a.p.id === String(selectedId) ? '#fff' : a.p.view.shieldActive ? '#73f6c0' : '#28385e'; c.lineWidth = a.p.view.shieldActive ? 4 : 2; c.stroke();
      c.fillStyle = '#e5efff'; c.font = 'bold ' + font * .78 + 'px sans-serif'; c.fillText(a.p.view.shieldActive ? '🛡' : a.p.bot ? 'AI' : a.p.name.slice(0, 1), x, y);
      c.font = Math.max(10, font * .76) + 'px sans-serif'; c.fillStyle = a.p.alive ? '#d3daeb' : '#aa778c'; c.fillText(a.p.name.slice(0, 6), x, y + r + font * .65);
    }
    if (holderSpot) { c.strokeStyle = '#ef906880'; c.lineWidth = 2; c.beginPath(); c.moveTo(w / 2, h * .52); c.lineTo(holderSpot.x * w, holderSpot.y * h); c.stroke(); }
    const r = Math.min(w * .115, h * .115), urgency = Math.max(0, Math.min(1, 1 - (s.explodesAt - now) / 10000));
    c.beginPath(); c.arc(w / 2, h * .50, r * (1 + Math.sin(now / 70) * .025 * urgency), 0, Math.PI * 2); c.fillStyle = '#323849'; c.fill(); c.strokeStyle = s.exploded ? '#ff436c' : '#ff9d4e'; c.lineWidth = 4; c.stroke();
    c.strokeStyle = '#e9ba75'; c.lineWidth = 3; c.beginPath(); c.moveTo(w / 2 + r * .45, h * .50 - r * .82); c.quadraticCurveTo(w / 2 + r, h * .50 - r * 1.7, w / 2 + r * .5, h * .50 - r * 1.6); c.stroke();
    c.font = 'bold ' + font * 1.5 + 'px sans-serif'; c.fillStyle = '#f8dba9'; c.fillText(s.exploded ? 'BOOM' : Math.max(0, (s.explodesAt - now) / 1000).toFixed(1), w / 2, h * .50);
    c.font = font * .78 + 'px sans-serif'; c.fillStyle = '#b7cbe6';
    if (selected) c.fillText(selected.name + ' · 傳遞 ' + selected.view.passes + ' 次 · 道具：護盾 ' + selected.view.items.shield + '／禁傳 ' + selected.view.items.jam + '／磁吸 ' + selected.view.items.magnet, w / 2, h * .945);
    c.fillText('持有炸彈時點對手傳出 · 每次傳遞相隔 1 秒', w / 2, h * .985);
  }
  adapters[11] = {
    draw,
    controls(session, userId) {
      const s = state(session), p = own(s, userId); if (s.phase !== 'playing' || !p?.alive || p.left) return [];
      const result = [{ label: '🛡 護盾 ×' + p.view.items.shield, kind: 'ITEM', fields: { type: 'shield' }, disabled: !p.view.items.shield }, { label: '禁傳 2.5秒 ×' + p.view.items.jam, kind: 'ITEM', fields: { type: 'jam' }, disabled: !p.view.items.jam }, { label: '磁吸 ×' + p.view.items.magnet, kind: 'ITEM', fields: { type: 'magnet' }, disabled: !p.view.items.magnet || s.holderId === p.id }];
      if (s.holderId === p.id) for (const target of (s.members || []).filter(m => m.alive && !m.left && m.id !== p.id)) result.push({ label: '傳給 ' + target.name, kind: 'PASS', fields: { targetId: target.id }, disabled: s.at < s.jamUntil || s.at < s.lastPassAt + 1000 });
      return result;
    },
    pointer(canvas, event, session, userId) {
      const s = state(session), p = own(s, userId); if (event.type !== 'pointerdown' || s.phase !== 'playing' || !p?.alive || p.left || s.holderId !== p.id) return null;
      const r = canvas.getBoundingClientRect(), x = (event.clientX - r.left) / r.width, y = (event.clientY - r.top) / r.height;
      const spot = spots(s).find(a => a.p.id !== p.id && a.p.alive && !a.p.left && Math.hypot(a.x - x, a.y - y) < .075);
      return spot ? { kind: 'PASS', targetId: spot.p.id } : null;
    },
    key(event, session, userId) { if (event.type === 'keyup' || event.repeat || !this.controls(session, userId).length) return null; const type = ({ KeyS: 'shield', KeyJ: 'jam', KeyM: 'magnet' })[event.code]; return type ? { kind: 'ITEM', type } : null; }
  };
})();
