(function () {
  'use strict';
  const adapters = window.BoomRoomOfficialClientAdapters ||= {};
  const state = session => session.engineState || {};
  const own = (s, id) => (s.members || []).find(p => p.id === String(id));
  const labels = { RUNNING: '等待收錢', CASHED: '已成功收錢', CRASHED: 'CRASH 淘汰', EXITED: '已退出' };
  function draw(canvas, session, selectedId, now) {
    const s = state(session), c = canvas.getContext('2d'), w = canvas.width, h = canvas.height, font = Math.max(11, Math.min(19, w / 25)), selected = own(s, selectedId);
    c.fillStyle = s.crashed ? '#2b1027' : '#111629'; c.fillRect(0, 0, w, h); c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold ' + font + 'px sans-serif'; c.fillStyle = '#a7d8ff';
    c.fillText(s.crashed ? '💥 CRASH！' : '霓虹電梯 · Crash 時間未公開', w / 2, h * .06);
    const top = h * .18, bottom = h * .74, shaft = w * .36, height = h * .14, progress = Math.min(1, Math.max(0, ((s.multiplier || 1) - 1) / 11)), carY = bottom - (bottom - top - height) * progress;
    c.fillStyle = '#1e2941'; c.fillRect(w * .16, top, w * .68, bottom - top + height); c.strokeStyle = '#466485'; c.lineWidth = 2; c.strokeRect(w * .16, top, w * .68, bottom - top + height);
    for (let i = 0; i < 9; i++) { const y = bottom - i * (bottom - top) / 8; c.strokeStyle = '#324761'; c.beginPath(); c.moveTo(w * .16, y); c.lineTo(w * .84, y); c.stroke(); c.fillStyle = '#718aa6'; c.font = font * .67 + 'px sans-serif'; c.fillText((1 + i * 11 / 8).toFixed(1) + 'x', w * .12, y); }
    c.strokeStyle = '#8a97a9'; c.lineWidth = 2; c.beginPath(); c.moveTo(w * .41, top); c.lineTo(w * .41, carY); c.moveTo(w * .59, top); c.lineTo(w * .59, carY); c.stroke();
    c.fillStyle = s.crashed ? '#c5526a' : '#51bdd6'; c.fillRect(w * .32, carY, shaft, height); c.strokeStyle = '#d7f0f7'; c.strokeRect(w * .32, carY, shaft, height); c.beginPath(); c.moveTo(w * .5, carY); c.lineTo(w * .5, carY + height); c.stroke();
    c.font = 'bold ' + font * 1.5 + 'px sans-serif'; c.fillStyle = '#fff'; c.fillText((s.multiplier || 1).toFixed(2) + '×', w / 2, carY + height * .5);
    if (s.crashed) { c.strokeStyle = '#ffb1b7'; c.lineWidth = 3; c.beginPath(); c.moveTo(w * .34, carY); c.lineTo(w * .53, carY + height * .35); c.lineTo(w * .43, carY + height * .63); c.lineTo(w * .65, carY + height); c.stroke(); }
    c.font = font * .8 + 'px sans-serif'; c.fillStyle = '#cfe1f6';
    const qualification = Math.max(0, Math.ceil((s.qualificationAt - now) / 1000));
    c.fillText(qualification && s.phase === 'playing' ? '還有 ' + qualification + ' 秒可有效收錢' : '倍率越高風險越高 · 收錢後繼續觀看', w / 2, h * .115);
    const members = s.members || [], cols = w >= 500 ? 5 : 2, rows = Math.ceil(members.length / cols), dy = h * .17 / Math.max(1, rows);
    c.font = Math.max(10, font * .74) + 'px sans-serif';
    members.forEach((p, i) => { c.fillStyle = p.view.status === 'CASHED' ? '#87f4b7' : p.alive ? '#b1cce8' : '#de8b9e'; c.fillText(p.name.slice(0, 5) + ' · ' + (p.view.status === 'CASHED' ? p.view.cashMultiplier.toFixed(2) + '×' : labels[p.view.status] || ''), w / cols * (i % cols + .5), h * .84 + Math.floor(i / cols) * dy); });
    c.fillStyle = '#c6ddf2'; c.font = Math.max(10, font * .75) + 'px sans-serif';
    if (selected) c.fillText(selected.name + ' · ' + (labels[selected.view.status] || '') + (selected.view.cashMultiplier ? ' · 鎖定 ' + selected.view.cashMultiplier.toFixed(2) + '×' : ''), w / 2, h * .982);
  }
  function cash(session, userId) { const s = state(session), p = own(s, userId); return s.phase === 'playing' && p?.alive && !p.left && p.view.status === 'RUNNING' ? { kind: 'CASHOUT' } : null; }
  adapters[12] = {
    draw,
    controls(session, userId) { const s = state(session); return cash(session, userId) ? [{ label: s.at < s.qualificationAt ? '10 秒後可收錢' : '立即收錢', kind: 'CASHOUT', disabled: s.at < s.qualificationAt }] : []; },
    pointer(canvas, event, session, userId) { return event.type === 'pointerdown' ? cash(session, userId) : null; },
    key(event, session, userId) { return event.type !== 'keyup' && !event.repeat && ['Space', 'Enter'].includes(event.code) ? cash(session, userId) : null; }
  };
})();
