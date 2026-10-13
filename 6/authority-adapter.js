(function () {
  'use strict';
  const adapters = window.BoomRoomOfficialClientAdapters ||= {};
  const state = session => session.engineState || {};
  const own = (s, id) => (s.members || []).find(p => p.id === String(id));
  function draw(canvas, session, selectedId, now) {
    const s = state(session), c = canvas.getContext('2d'), w = canvas.width, h = canvas.height, members = s.members || [], font = Math.max(11, Math.min(18, w / 26));
    c.fillStyle = '#111027'; c.fillRect(0, 0, w, h); c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold ' + font + 'px sans-serif'; c.fillStyle = '#ffb4eb';
    c.fillText('10 秒手速競賽 · ' + Math.max(0, Math.ceil((s.endAt - now) / 1000)) + ' 秒', w / 2, h * .065);
    const row = Math.min(h * .052, h * .52 / Math.max(1, members.length));
    members.forEach((p, i) => {
      const y = h * .15 + i * row; c.strokeStyle = '#303049'; c.lineWidth = 1; c.beginPath(); c.moveTo(w * .25, y + row * .6); c.lineTo(w * .91, y + row * .6); c.stroke();
      c.font = font * .75 + 'px sans-serif'; c.textAlign = 'left'; c.fillStyle = p.id === selectedId ? '#76eeff' : '#c7bbd7'; c.fillText((p.bot ? 'AI ' : '') + p.name.slice(0, 6), w * .04, y);
      const x = w * .27 + w * .62 * Math.min(1, p.score / 250); c.fillStyle = p.left ? '#626176' : p.id === selectedId ? '#65ecff' : ['#ff659f', '#98ff94', '#dfb2ff'][i % 3]; c.fillRect(x, y - row * .22, row * .8, row * .45);
      c.beginPath(); c.arc(x + row * .15, y + row * .25, row * .1, 0, Math.PI * 2); c.arc(x + row * .65, y + row * .25, row * .1, 0, Math.PI * 2); c.fillStyle = '#15141d'; c.fill();
      c.textAlign = 'right'; c.fillStyle = '#f1edff'; c.fillText(p.score + '次', w * .96, y);
    });
    const p = own(s, selectedId); c.textAlign = 'center'; c.fillStyle = '#ff61a8'; c.beginPath(); c.arc(w / 2, h * .82, Math.min(w * .18, h * .13), 0, Math.PI * 2); c.fill();
    c.font = 'bold ' + font * 1.5 + 'px sans-serif'; c.fillStyle = '#fff'; c.fillText('TAP!', w / 2, h * .81);
    c.font = font * .76 + 'px sans-serif'; c.fillStyle = '#c4c6de'; c.fillText((p ? p.name + ' · ' + p.score + ' 次 · ' : '') + '每秒至多 25 次', w / 2, h * .975);
  }
  function intent(session, userId) { const s = state(session), p = own(s, userId); return s.phase === 'playing' && p?.alive && !p.left ? { kind: 'TAP' } : null; }
  adapters[6] = {
    draw, controls(session, userId) { return intent(session, userId) ? [{ label: 'TAP！', kind: 'TAP' }] : []; },
    pointer(canvas, event, session, userId) { return event.type === 'pointerdown' ? intent(session, userId) : null; },
    key(event, session, userId) { return event.type !== 'keyup' && !event.repeat && ['Space', 'Enter'].includes(event.code) ? intent(session, userId) : null; }
  };
})();
