(function () {
  'use strict';
  const adapters = window.BoomRoomOfficialClientAdapters ||= {};
  const state = session => session.engineState || {};
  const own = (s, id) => (s.members || []).find(p => p.id === String(id));
  const colors = ['#57daff', '#ff6495', '#a5f57c', '#e6b4ff', '#ffcd6a'];
  function draw(canvas, session, selectedId, now) {
    const s = state(session), c = canvas.getContext('2d'), w = canvas.width, h = canvas.height, font = Math.max(11, Math.min(18, w / 26));
    c.fillStyle = '#101729'; c.fillRect(0, 0, w, h); c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold ' + font + 'px sans-serif';
    const color = s.light === 'RED' ? '#ff4a74' : s.light === 'YELLOW' ? '#ffd15f' : '#68efa1';
    c.fillStyle = color; c.fillText(s.light === 'RED' ? 'STOP · 動作立即淘汰' : s.light === 'YELLOW' ? 'BRAKE · 準備煞車' : 'RUN · 綠燈前進', w / 2, h * .065);
    [['RED', '#ff4a74'], ['YELLOW', '#ffd15f'], ['GREEN', '#68efa1']].forEach(([type, col], i) => { c.beginPath(); c.arc(w * .42 + i * w * .08, h * .145, Math.min(w * .025, h * .032), 0, Math.PI * 2); c.fillStyle = s.light === type ? col : '#30374b'; c.fill(); });
    const members = s.members || [], row = h * .61 / Math.max(1, members.length), finish = w * .94;
    for (let i = 0; i < 16; i++) { c.fillStyle = i % 2 ? '#b8c6d3' : '#30374d'; c.fillRect(finish, h * .22 + i * h * .038, w * .024, h * .038); }
    members.forEach((p, i) => {
      const y = h * .25 + row * (i + .5); c.strokeStyle = '#28344c'; c.lineWidth = 1; c.beginPath(); c.moveTo(w * .12, y + row * .42); c.lineTo(finish, y + row * .42); c.stroke();
      c.font = Math.max(10, font * .7) + 'px sans-serif'; c.fillStyle = '#afbcd7'; c.textAlign = 'left'; c.fillText(p.name.slice(0, 5), w * .015, y);
      const extrapolate = p.alive && p.view.holding && s.phase === 'playing' && s.light !== 'RED' ? Math.min(150, Math.max(0, now - s.at)) * .000175 : 0;
      const x = w * .12 + (finish - w * .12) * Math.min(.93, p.view.x + extrapolate) / .93, size = Math.max(7, Math.min(row * .65, h * .036));
      c.save(); c.translate(x, y); const stride = p.view.holding && p.alive ? Math.sin(now / 75) * size * .35 : 0;
      c.strokeStyle = p.alive ? colors[i % colors.length] : '#6d6676'; c.fillStyle = c.strokeStyle; c.lineWidth = Math.max(2, size * .12);
      c.beginPath(); c.arc(0, -size * .55, size * .24, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(0, -size * .28); c.lineTo(0, size * .28); c.moveTo(0, 0); c.lineTo(-size * .4, size * .12 + stride); c.moveTo(0, 0); c.lineTo(size * .4, size * .12 - stride);
      c.moveTo(0, size * .28); c.lineTo(-size * .25 + stride, size * .67); c.moveTo(0, size * .28); c.lineTo(size * .25 - stride, size * .67); c.stroke();
      if (!p.alive) { c.strokeStyle = '#ff5b73'; c.beginPath(); c.moveTo(-size * .5, -size * .6); c.lineTo(size * .5, size * .6); c.moveTo(size * .5, -size * .6); c.lineTo(-size * .5, size * .6); c.stroke(); }
      if (p.id === String(selectedId)) { c.strokeStyle = '#fff'; c.strokeRect(-size * .7, -size, size * 1.4, size * 1.9); }
      c.restore();
    });
    if (s.light === 'RED') { c.strokeStyle = '#ff4a7477'; c.lineWidth = 2; c.beginPath(); c.moveTo(finish, h * .21); c.lineTo(w * .09, h * .82); c.stroke(); }
    const p = own(s, selectedId); c.font = font * .83 + 'px sans-serif'; c.textAlign = 'center'; c.fillStyle = color;
    if (p) c.fillText(p.name + ' · ' + Math.round((p.view.x - .06) / .87 * 100) + '% · ' + (p.left ? '退出' : !p.alive ? '淘汰觀戰' : p.view.holding ? '奔跑中' : '已煞車'), w / 2, h * .90);
    c.fillStyle = '#c0c9e1'; c.fillText('長按畫面／Space 前進，放開停止 · 相鄰跑道會碰撞', w / 2, h * .968);
  }
  function can(session, userId) { const s = state(session), p = own(s, userId); return s.phase === 'playing' && p?.alive && !p.left; }
  adapters[7] = {
    draw,
    controls(session, userId) {
      if (!can(session, userId)) return []; const p = own(state(session), userId);
      return [{ label: '開始跑步', kind: 'RUN', disabled: p.view.holding }, { label: '停止／煞車', kind: 'STOP', disabled: !p.view.holding }];
    },
    pointer(canvas, event, session, userId) { if (!can(session, userId)) return null; return event.type === 'pointerdown' ? { kind: 'RUN' } : ['pointerup', 'pointercancel'].includes(event.type) ? { kind: 'STOP' } : null; },
    key(event, session, userId) { if (!can(session, userId) || event.repeat) return null; if (event.code === 'Space') return { kind: event.type === 'keyup' ? 'STOP' : 'RUN' }; return event.code === 'Escape' ? { kind: 'STOP' } : null; }
  };
})();
