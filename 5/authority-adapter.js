(function () {
  'use strict';
  const adapters = window.BoomRoomOfficialClientAdapters ||= {};
  const state = session => session.engineState || {};
  const own = (s, id) => (s.members || []).find(p => p.id === String(id));
  const labels = { WAITING: '等待蓄力', HOLDING: '蓄力中', CASHED_OUT: '安全下莊', DEAD: '走火淘汰', EXITED: '已退出' };
  function draw(canvas, session, selectedId, now) {
    const s = state(session), c = canvas.getContext('2d'), w = canvas.width, h = canvas.height, r = Math.min(w * .22, h * .20), p = own(s, selectedId);
    c.fillStyle = s.fired ? '#300a17' : '#10101c'; c.fillRect(0, 0, w, h); c.textAlign = 'center'; c.textBaseline = 'middle';
    const font = Math.max(12, Math.min(19, w / 25)); c.font = 'bold ' + font + 'px sans-serif'; c.fillStyle = '#ffc668';
    c.fillText(s.fired ? '💥 走火！' : '未知走火時間 · 安全下莊前都在冒險', w / 2, h * .075);
    c.save(); c.translate(w / 2, h * .35); c.rotate((now - s.startAt) / (s.fired ? 6000 : 700));
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fillStyle = '#454459'; c.fill(); c.strokeStyle = '#a7a0af'; c.lineWidth = 4; c.stroke();
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; c.beginPath(); c.arc(Math.cos(a) * r * .64, Math.sin(a) * r * .64, r * .23, 0, Math.PI * 2); c.fillStyle = s.fired && i === 0 ? '#ff304c' : '#11131c'; c.fill(); }
    c.beginPath(); c.arc(0, 0, r * .16, 0, Math.PI * 2); c.fillStyle = '#cbc2ce'; c.fill(); c.restore();
    if (p) {
      c.fillStyle = '#f1efff'; c.fillText(p.name + ' · ' + (labels[p.view.status] || p.view.status), w / 2, h * .61);
      const charging = p.view.status === 'HOLDING' && s.phase === 'playing' ? p.view.charging + Math.min(250, Math.max(0, now - s.at)) : p.score;
      c.font = 'bold ' + Math.max(24, font * 2) + 'px sans-serif'; c.fillStyle = p.view.status === 'DEAD' ? '#ff526d' : '#ffc668'; c.fillText(Math.floor(charging || 0) + ' ms', w / 2, h * .69);
    }
    c.font = font * .78 + 'px sans-serif';
    const members = s.members || [], cols = w >= 500 ? 5 : 2, rows = Math.ceil(members.length / cols), height = Math.min(font * 1.8, h * .20 / Math.max(1, rows));
    members.forEach((m, i) => { c.fillStyle = m.id === selectedId ? '#89eaff' : m.alive ? '#bec5da' : '#7e6c83'; c.fillText((m.bot ? 'AI ' : '') + m.name.slice(0, 5) + ' ' + (labels[m.view.status] || ''), w / cols * (i % cols + .5), h * .78 + Math.floor(i / cols) * height); });
  }
  adapters[5] = {
    draw,
    controls(session, userId) {
      const s = state(session), p = own(s, userId); if (s.phase !== 'playing' || !p?.alive || p.left) return [];
      return p.view.status === 'WAITING' ? [{ label: '開始蓄力（長按畫面）', kind: 'HOLD' }] : p.view.status === 'HOLDING' ? [{ label: '安全下莊（鬆開畫面）', kind: 'CASHOUT' }] : [];
    },
    pointer(canvas, event, session, userId) {
      const s = state(session), p = own(s, userId); if (s.phase !== 'playing' || !p?.alive || p.left || !['WAITING', 'HOLDING'].includes(p.view.status)) return null;
      if (event.type === 'pointerdown' && p.view.status === 'WAITING') return { kind: 'HOLD' };
      return ['pointerup', 'pointercancel'].includes(event.type) ? { kind: 'CASHOUT' } : null;
    },
    key(event, session, userId) {
      const s = state(session), p = own(s, userId); if (!p || s.phase !== 'playing' || !p.alive || p.left || event.repeat) return null;
      if (event.code === 'Space') return { kind: event.type === 'keyup' ? 'CASHOUT' : 'HOLD' };
      return event.code === 'Enter' && event.type !== 'keyup' ? { kind: 'CASHOUT' } : null;
    }
  };
})();
