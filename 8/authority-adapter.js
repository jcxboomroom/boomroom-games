(function () {
  'use strict';
  const adapters = window.BoomRoomOfficialClientAdapters ||= {};
  const state = session => session.engineState || {};
  const own = (s, id) => (s.members || []).find(p => p.id === String(id));
  function draw(canvas, session, selectedId, now) {
    const s = state(session), c = canvas.getContext('2d'), w = canvas.width, h = canvas.height, crown = s.crown || { x: .5, y: .5 }, font = Math.max(11, Math.min(18, w / 25));
    c.fillStyle = '#10112a'; c.fillRect(0, 0, w, h); c.textAlign = 'center'; c.textBaseline = 'middle';
    c.strokeStyle = '#303453'; c.lineWidth = 1;
    for (let i = 1; i < 8; i++) { c.beginPath(); c.moveTo(w * i / 8, h * .18); c.lineTo(w * i / 8, h * .78); c.stroke(); }
    for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(w * .1, h * (.18 + i * .12)); c.lineTo(w * .9, h * (.18 + i * .12)); c.stroke(); }
    c.font = 'bold ' + font + 'px sans-serif'; c.fillStyle = crown.golden ? '#ffda69' : '#70ddff';
    const owner = own(s, crown.ownerId); c.fillText(crown.golden ? '黃金王冠 ×2' : '45 秒搶王冠', w / 2, h * .065);
    c.font = font * .85 + 'px sans-serif'; c.fillStyle = '#cbd6eb'; c.fillText('持有者：' + (owner?.name || '尚未搶到') + ' · ' + Math.max(0, Math.ceil((s.endAt - now) / 1000)) + ' 秒', w / 2, h * .12);
    const x = crown.x * w, y = crown.y * h, r = Math.min(w, h) * .065;
    c.beginPath(); c.arc(x, y, r * (1.15 + Math.sin(now / 140) * .08), 0, Math.PI * 2); c.fillStyle = crown.golden ? '#ffca5525' : '#55dfff25'; c.fill();
    c.strokeStyle = crown.golden ? '#ffd057' : '#69e3ff'; c.lineWidth = 2; c.stroke(); c.fillStyle = crown.golden ? '#ffdd7d' : '#a9f0ff';
    c.beginPath(); c.moveTo(x - r * .8, y - r * .5); c.lineTo(x - r * .35, y - r * .1); c.lineTo(x, y - r * .82); c.lineTo(x + r * .35, y - r * .1); c.lineTo(x + r * .8, y - r * .5); c.lineTo(x + r * .57, y + r * .53); c.lineTo(x - r * .57, y + r * .53); c.closePath(); c.fill();
    c.fillStyle = '#563c25'; c.fillRect(x - r * .57, y + r * .28, r * 1.14, r * .14);
    const members = s.members || [], cols = w >= 500 ? 5 : 2, rows = Math.ceil(members.length / cols), dy = h * .19 / Math.max(1, rows);
    c.font = Math.max(10, font * .75) + 'px sans-serif';
    members.forEach((p, i) => {
      c.fillStyle = p.left ? '#626982' : p.id === String(selectedId) ? '#fff' : p.id === crown.ownerId ? '#ffda68' : '#9fd8ef';
      c.fillText((p.id === crown.ownerId ? '👑 ' : '') + p.name.slice(0, 5) + ' ' + p.score, w / cols * (i % cols + .5), h * .82 + Math.floor(i / cols) * dy);
    });
  }
  function intent(session, userId) { const s = state(session), p = own(s, userId); return s.phase === 'playing' && p?.alive && !p.left && s.crown ? { kind: 'CLAIM', x: s.crown.x, y: s.crown.y, serial: s.crown.serial } : null; }
  adapters[8] = {
    draw,
    controls(session, userId) { const c = intent(session, userId); return c ? [{ label: '👑 搶目前王冠', kind: 'CLAIM', fields: { x: c.x, y: c.y, serial: c.serial } }] : []; },
    pointer(canvas, event, session, userId) {
      const c = intent(session, userId); if (event.type !== 'pointerdown' || !c) return null;
      const r = canvas.getBoundingClientRect(), x = (event.clientX - r.left) / r.width, y = (event.clientY - r.top) / r.height;
      return Math.hypot(x - c.x, y - c.y) <= .065 ? { ...c, x, y } : null;
    },
    key(event, session, userId) { return event.type !== 'keyup' && !event.repeat && ['Space', 'Enter'].includes(event.code) ? intent(session, userId) : null; }
  };
})();
