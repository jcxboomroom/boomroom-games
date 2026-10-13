(function () {
  'use strict';
  const adapters = window.BoomRoomOfficialClientAdapters ||= {};
  const state = session => session.engineState || {};
  const own = (s, id) => (s.members || []).find(p => p.id === String(id));
  const colors = ['#ff6285', '#65df91', '#67afff', '#ffe479'];
  function draw(canvas, session, selectedId, now) {
    const s = state(session), c = canvas.getContext('2d'), w = canvas.width, h = canvas.height, font = Math.max(11, Math.min(18, w / 25)), selected = own(s, selectedId);
    c.fillStyle = '#0a1525'; c.fillRect(0, 0, w, h); c.textBaseline = 'middle'; c.textAlign = 'center'; c.font = 'bold ' + font + 'px sans-serif'; c.fillStyle = '#e5edf7';
    c.fillText(s.stage === 'SELECT' ? '選神豬 · ' + Math.max(0, Math.ceil((s.raceStartAt - now) / 1000)) + ' 秒' : s.phase === 'results' ? '冠軍：' + (s.winningPigs || []).map(id => s.pigs[id].name).join('、') : '神豬競速 · 加速 ×1／陷阱 ×1', w / 2, h * .065);
    (s.pigs || []).forEach((pig, i) => {
      const y = h * (.22 + i * .145), left = w * .20, right = w * .92;
      c.fillStyle = '#192d42'; c.fillRect(left, y - h * .045, right - left, h * .09);
      c.strokeStyle = '#385770'; c.lineWidth = 1; c.beginPath(); c.moveTo(left, y + h * .06); c.lineTo(right, y + h * .06); c.stroke();
      if (selected?.view.pigId === i) { c.strokeStyle = colors[i]; c.lineWidth = 2; c.strokeRect(w * .025, y - h * .055, w * .95, h * .115); }
      c.font = font * .8 + 'px sans-serif'; c.textAlign = 'left'; c.fillStyle = colors[i]; c.fillText(pig.name, w * .03, y - h * .015); c.fillText(i === 2 ? '抗陷阱' : i === 3 ? '機率爆發' : i === 1 ? '大起大落' : '速度穩定', w * .03, y + h * .02);
      const x = left + (right - left) * (pig.distance - 5) / 85, r = Math.min(w * .032, h * .025);
      c.save(); c.translate(x, y); c.fillStyle = colors[i]; c.beginPath(); c.ellipse(0, 0, r * 1.25, r, 0, 0, Math.PI * 2); c.fill(); c.beginPath(); c.ellipse(r, r * .12, r * .55, r * .5, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#1c2331'; c.beginPath(); c.arc(r * 1.0, -r * .24, r * .09, 0, Math.PI * 2); c.fill(); c.fillRect(-r * .6, r * .6, r * .22, r * .65); c.fillRect(r * .3, r * .6, r * .22, r * .65); c.restore();
      c.textAlign = 'right'; c.fillStyle = '#e0eaf5'; c.fillText(pig.speedMod > 1 ? '⚡ 加速' : pig.speedMod < 1 ? '⚠ 陷阱' : Math.round(pig.distance / 90 * 100) + '%', w * .94, y - h * .02);
      for (let j = 0; j < 4; j++) { c.fillStyle = j % 2 ? '#8c9db2' : '#233047'; c.fillRect(right, y - h * .05 + j * h * .025, w * .025, h * .025); }
    });
    const members = s.members || [], cols = w >= 500 ? 5 : 2, rows = Math.ceil(members.length / cols), dy = h * .20 / Math.max(1, rows);
    c.textAlign = 'center'; c.font = Math.max(10, font * .76) + 'px sans-serif';
    members.forEach((p, i) => { c.fillStyle = p.left ? '#56677c' : p.view.pigId == null ? '#a8b7cf' : colors[p.view.pigId]; c.fillText(p.name.slice(0, 5) + ' → ' + (p.view.pigId == null ? '待選' : s.pigs[p.view.pigId].name), w / cols * (i % cols + .5), h * .81 + Math.floor(i / cols) * dy); });
  }
  adapters[9] = {
    draw,
    controls(session, userId) {
      const s = state(session), p = own(s, userId); if (s.phase !== 'playing' || !p?.alive || p.left) return [];
      if (s.stage === 'SELECT') return (s.pigs || []).map(pig => ({ label: (p.view.pigId === pig.id ? '✓ ' : '') + pig.name, kind: 'CHOOSE', fields: { pigId: pig.id } }));
      if (p.view.pigId == null) return [];
      return [{ label: '⚡ 自家加速', kind: 'ITEM', fields: { pigId: p.view.pigId, type: 'boost' }, disabled: !p.view.boost },
        ...(s.pigs || []).filter(pig => pig.id !== p.view.pigId).map(pig => ({ label: '陷阱 → ' + pig.name, kind: 'ITEM', fields: { pigId: pig.id, type: 'trap' }, disabled: !p.view.trap }))];
    },
    pointer(canvas, event, session, userId) {
      const s = state(session), p = own(s, userId); if (event.type !== 'pointerdown' || s.phase !== 'playing' || !p?.alive || p.left) return null;
      const r = canvas.getBoundingClientRect(), y = (event.clientY - r.top) / r.height, pigId = Math.round((y - .22) / .145);
      if (pigId < 0 || pigId > 3 || Math.abs(y - (.22 + pigId * .145)) > .058) return null;
      return s.stage === 'SELECT' ? { kind: 'CHOOSE', pigId } : { kind: 'ITEM', pigId, type: pigId === p.view.pigId ? 'boost' : 'trap' };
    }
  };
})();
