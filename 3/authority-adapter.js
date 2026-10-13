(function () {
  'use strict';
  const adapters = window.BoomRoomOfficialClientAdapters ||= {};
  const state = session => session.engineState || {};
  const own = (s, id) => (s.members || []).find(p => p.id === String(id));
  function draw(canvas, session, selectedId, now) {
    const s = state(session), ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    const font = Math.max(11, Math.min(18, w / 29));
    ctx.fillStyle = '#080c20'; ctx.fillRect(0, 0, w, h); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold ' + font + 'px sans-serif'; ctx.fillStyle = '#e7edff'; ctx.fillText('核心拔河 · ' + (s.winnerTeam || '點準中央發動駭入'), w / 2, h * .065);
    ctx.fillStyle = '#16223d'; ctx.fillRect(w * .08, h * .16, w * .84, h * .12);
    ctx.fillStyle = '#34c8ff'; ctx.fillRect(w * .08, h * .16, w * .84 * (s.balance ?? 50) / 100, h * .12);
    ctx.fillStyle = '#ff426d'; ctx.fillRect(w * .08 + w * .84 * (s.balance ?? 50) / 100, h * .16, w * .84 * (100 - (s.balance ?? 50)) / 100, h * .12);
    const coreX = w * .08 + w * .84 * (s.balance ?? 50) / 100;
    ctx.beginPath(); ctx.arc(coreX, h * .22, h * .046, 0, Math.PI * 2); ctx.fillStyle = '#fff0a8'; ctx.fill();
    ctx.fillStyle = '#e7edff'; ctx.fillText('藍隊  ← 核心 ' + Math.round(s.balance ?? 50) + '% →  紅隊', w / 2, h * .32);
    const progress = Math.max(0, Math.min(1, (now - s.startAt) / 90000)), good = 16 - progress * 4, perfect = 4 - progress * 1.4;
    const x = w * .08, y = h * .405, bw = w * .84;
    ctx.fillStyle = '#282d49'; ctx.fillRect(x, y, bw, h * .09);
    ctx.fillStyle = '#155246'; ctx.fillRect(x + bw * (.5 - good / 100), y, bw * good / 50, h * .09);
    ctx.fillStyle = '#ffc961'; ctx.fillRect(x + bw * (.5 - perfect / 100), y, bw * perfect / 50, h * .09);
    const elapsed = s.phase === 'playing' ? Math.min(150, Math.max(0, now - s.at)) : 0;
    let cursor = (s.cursor ?? 50) + (s.direction || 1) * (.78 + .64 * progress) * elapsed * .09;
    if (cursor > 100) cursor = 200 - cursor; if (cursor < 0) cursor = -cursor;
    ctx.fillStyle = '#fff'; ctx.fillRect(x + bw * cursor / 100 - 2, y - 5, 4, h * .09 + 10);
    ctx.fillStyle = '#a9b8d7'; ctx.font = font * .78 + 'px sans-serif'; ctx.fillText('中央金色 PERFECT · 綠色 GOOD · 空白 MISS', w / 2, h * .535);
    for (const [team, column, color] of [['BLUE', 0, '#34c8ff'], ['RED', 1, '#ff426d']]) {
      const list = (s.members || []).filter(p => p.view.team === team);
      list.forEach((p, i) => {
        const py = h * .595 + i * h * .06, left = w * (.07 + column * .48);
        if (p.id === selectedId) { ctx.fillStyle = '#243554'; ctx.fillRect(left - 6, py - font, w * .42, font * 1.7); }
        ctx.textAlign = 'left'; ctx.fillStyle = p.left ? '#65738c' : color; ctx.fillText((p.bot ? 'AI ' : '') + p.name.slice(0, 8) + ' ' + p.score, left, py);
        ctx.fillStyle = '#35445e'; ctx.fillRect(left, py + font * .55, w * .37, 3);
        ctx.fillStyle = '#ffc961'; ctx.fillRect(left, py + font * .55, w * .37 * p.view.ult / 100, 3);
      });
    }
    const p = own(s, selectedId); ctx.textAlign = 'center'; ctx.fillStyle = '#e7edff';
    if (p) ctx.fillText(p.name + ' · COMBO ' + p.view.combo + ' · ULT ' + p.view.ult + '% · ' + p.view.lastHit, w / 2, h * .95);
  }
  adapters[3] = {
    draw,
    controls(session, userId) {
      const s = state(session), p = own(s, userId); if (s.phase !== 'playing' || !p?.alive || p.left) return [];
      return [{ label: '⚡ HACK 攻擊', kind: 'HACK' }, { label: 'ULT 終極駭入 ' + p.view.ult + '%', kind: 'ULT', disabled: p.view.ult < 100 }];
    },
    pointer(canvas, event, session, userId) { const s = state(session), p = own(s, userId); return event.type === 'pointerdown' && s.phase === 'playing' && p?.alive && !p.left ? { kind: 'HACK' } : null; },
    key(event, session, userId) { if (event.type === 'keyup' || event.repeat || !this.controls(session, userId).length) return null; return event.code === 'Space' ? { kind: 'HACK' } : event.code === 'KeyU' ? { kind: 'ULT' } : null; }
  };
})();
