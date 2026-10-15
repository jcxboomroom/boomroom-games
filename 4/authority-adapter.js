(function () {
  'use strict';
  const adapters = window.BoomRoomOfficialClientAdapters ||= {};
  const state = session => session.engineState || {};
  const own = (s, id) => (s.members || []).find(p => p.id === String(id));
  const icons = { GEM: '💎', GOLD: '🔶', SILVER: '💠', CHEST: '📦', HEART: '❤️', SHIELD: '🛡', DIRT: '🪨', BOMB: '💣' };
  function layout(canvas) { const cell = Math.min(canvas.width * .92 / 6, canvas.height * .69 / 5); return { cell, x: (canvas.width - cell * 6) / 2, y: canvas.height * .21 }; }
  function draw(canvas, session, selectedId, now) {
    const s = state(session), c = canvas.getContext('2d'), w = canvas.width, h = canvas.height, font = Math.max(11, Math.min(17, w / 27));
    c.fillStyle = '#11121f'; c.fillRect(0, 0, w, h); c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold ' + font + 'px sans-serif';
    const turn = own(s, s.turnId), p = own(s, selectedId); c.fillStyle = '#ffe49d'; c.fillText('礦脈 LV.' + (s.level || 1) + ' · 第 ' + (s.turnNo || 1) + ' 手', w / 2, h * .052);
    c.fillStyle = '#8affa6'; c.fillText('輪到 ' + (turn?.name || '—') + ' · ' + Math.max(0, Math.ceil((s.turnEndsAt - now) / 1000)) + ' 秒', w / 2, h * .116);
    c.font = font * .8 + 'px sans-serif'; c.fillStyle = '#d7d9ef'; if (p) c.fillText(p.name + ' · ' + p.score + '分 · HP ' + p.view.hp + '/3 · 護盾 ' + p.view.shield + ' · COMBO ' + p.view.combo, w / 2, h * .17);
    const l = layout(canvas);
    (s.board || []).forEach((tile, index) => {
      const x = l.x + index % 6 * l.cell, y = l.y + Math.floor(index / 6) * l.cell;
      c.fillStyle = tile.type === 'BOMB' ? '#66313f' : tile.minedBy ? '#1e3541' : '#30304a'; c.fillRect(x + 2, y + 2, l.cell - 4, l.cell - 4);
      if (tile.minedBy === selectedId) { c.strokeStyle = '#67e9ff'; c.lineWidth = 2; c.strokeRect(x + 3, y + 3, l.cell - 6, l.cell - 6); }
      c.fillStyle = '#f3e8d5'; c.font = Math.max(16, l.cell * .38) + 'px sans-serif'; c.fillText(tile.minedBy ? icons[tile.type] || '·' : '?', x + l.cell / 2, y + l.cell * .43);
      c.font = Math.max(9, l.cell * .17) + 'px sans-serif'; c.fillStyle = '#abb8cc';
      c.fillText(tile.minedBy ? (own(s, tile.minedBy)?.name || '').slice(0, 4) : String.fromCharCode(65 + Math.floor(index / 6)) + (index % 6 + 1), x + l.cell / 2, y + l.cell * .78);
    });
    c.fillStyle = '#aab8d1'; c.font = font * .85 + 'px sans-serif'; c.fillText('輪到你時點選未挖礦格 · 炸彈扣血，出局可繼續觀戰', w / 2, h * .965);
  }
  adapters[4] = {
    draw,
    controls(session, userId) {
      const s = state(session), p = own(s, userId); if (s.phase !== 'playing' || !p?.alive || p.left || p.id !== s.turnId) return [];
      return [{label:'保留寶物並收手',kind:'BANK',fields:{turnNo:s.turnNo}},...(s.board || []).map((tile, index) => tile.minedBy ? null : ({ label: '挖 ' + String.fromCharCode(65 + Math.floor(index / 6)) + (index % 6 + 1), kind: 'MINE', fields: { index, turnNo: s.turnNo, level: s.level } })).filter(Boolean)];
    },
    pointer(canvas, event, session, userId) {
      const s = state(session), p = own(s, userId); if (event.type !== 'pointerdown' || s.phase !== 'playing' || !p?.alive || p.left || p.id !== s.turnId) return null;
      const rect = canvas.getBoundingClientRect(), l = layout(canvas), x = (event.clientX - rect.left) * canvas.width / rect.width - l.x, y = (event.clientY - rect.top) * canvas.height / rect.height - l.y;
      const col = Math.floor(x / l.cell), row = Math.floor(y / l.cell); if (col < 0 || col > 5 || row < 0 || row > 4) return null;
      const index = row * 6 + col; return s.board[index].minedBy ? null : { kind: 'MINE', index, turnNo: s.turnNo, level: s.level };
    }
  };
})();
