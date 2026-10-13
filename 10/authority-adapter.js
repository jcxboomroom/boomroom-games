(function () {
  'use strict';
  const adapters = window.BoomRoomOfficialClientAdapters ||= {};
  const state = session => session.engineState || {};
  const own = (s, id) => (s.members || []).find(p => p.id === String(id));
  const names = { small: '小（4～10）', big: '大（11～17）', triple: '任意豹子' };
  const pipPositions = { 1: [[0, 0]], 2: [[-.5, -.5], [.5, .5]], 3: [[-.5, -.5], [0, 0], [.5, .5]], 4: [[-.5, -.5], [.5, -.5], [-.5, .5], [.5, .5]], 5: [[-.5, -.5], [.5, -.5], [0, 0], [-.5, .5], [.5, .5]], 6: [[-.5, -.5], [.5, -.5], [-.5, 0], [.5, 0], [-.5, .5], [.5, .5]] };
  function draw(canvas, session, selectedId, now) {
    const s = state(session), c = canvas.getContext('2d'), w = canvas.width, h = canvas.height, font = Math.max(11, Math.min(20, w / 24)), selected = own(s, selectedId);
    c.fillStyle = '#121124'; c.fillRect(0, 0, w, h); c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold ' + font + 'px sans-serif'; c.fillStyle = '#f6d181';
    c.fillText(s.stage === 'REVEALED' ? '開骰：' + (names[s.resultType] || '') : s.stage === 'ROLLING' ? '伺服器開骰中…' : '預測大小／任意豹子', w / 2, h * .085);
    c.font = font * .85 + 'px sans-serif'; c.fillStyle = '#b9c7e1';
    c.fillText(s.stage === 'PREDICT' ? '還有 ' + Math.max(0, Math.ceil((s.betEndsAt - now) / 1000)) + ' 秒可選擇' : s.dice ? '總和 ' + s.total + ' · 三顆相同只算豹子' : '點數尚未公開', w / 2, h * .16);
    const size = Math.min(w * .23, h * .21);
    for (let i = 0; i < 3; i++) {
      const x = w * (.2 + i * .3), y = h * .38, value = s.dice?.[i] || (s.stage === 'ROLLING' ? 1 + (Math.floor(now / 90) + i * 3) % 6 : 0);
      c.fillStyle = '#e8e9f2'; c.fillRect(x - size / 2, y - size / 2, size, size); c.strokeStyle = '#93a8c5'; c.lineWidth = 3; c.strokeRect(x - size / 2, y - size / 2, size, size);
      if (!value) { c.font = 'bold ' + size * .5 + 'px sans-serif'; c.fillStyle = '#7f8198'; c.fillText('?', x, y); }
      for (const [px, py] of pipPositions[value] || []) { c.beginPath(); c.arc(x + px * size * .58, y + py * size * .58, size * .065, 0, Math.PI * 2); c.fillStyle = value === 1 ? '#e64871' : '#303849'; c.fill(); }
    }
    c.font = font * .87 + 'px sans-serif'; c.fillStyle = '#a9defd';
    if (selected) c.fillText(selected.name + ' · ' + (selected.view.choice ? names[selected.view.choice] : selected.view.submitted ? '已預測（內容未公開）' : '尚未預測') + (s.stage === 'REVEALED' ? ' · ' + selected.score + ' 挑戰分' : ''), w / 2, h * .61);
    const members = s.members || [], cols = w >= 500 ? 5 : 2, rows = Math.ceil(members.length / cols), dy = h * .25 / Math.max(1, rows);
    c.font = Math.max(10, font * .76) + 'px sans-serif';
    members.forEach((p, i) => { c.fillStyle = p.left ? '#685d72' : p.view.status === 'WIN' ? '#75eea5' : '#c8d0e5'; c.fillText(p.name.slice(0, 5) + ' · ' + (p.view.choice ? names[p.view.choice].split('（')[0] : p.view.submitted ? '✓ 已選' : '待選'), w / cols * (i % cols + .5), h * .71 + Math.floor(i / cols) * dy); });
    c.font = Math.max(10, font * .73) + 'px sans-serif'; c.fillStyle = '#99a9c3'; c.fillText('加碼僅由共用獎池結算，2／24 為挑戰分數', w / 2, h * .975);
  }
  adapters[10] = {
    draw,
    controls(session, userId) {
      const s = state(session), p = own(s, userId); if (s.phase !== 'playing' || s.stage !== 'PREDICT' || !p?.alive || p.left) return [];
      return ['small', 'triple', 'big'].map(choice => ({ label: (p.view.choice === choice ? '✓ ' : '') + names[choice], kind: 'PREDICT', fields: { choice } }));
    },
    key(event, session, userId) { if (event.type === 'keyup' || event.repeat || !this.controls(session, userId).length) return null; const choice = ({ Digit1: 'small', Digit2: 'triple', Digit3: 'big' })[event.code]; return choice ? { kind: 'PREDICT', choice } : null; }
  };
})();
