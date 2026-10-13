(function () {
  'use strict';
  const st = session => session.engineState || session;
  const ranks = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
  const suits = ['♣','♦','♥','♠'];
  let selected = [], selectionRound = 0, requestRank = 12, requestSuit = 3;
  const text = n => suits[n % 4] + ranks[Math.floor(n / 4)];
  function layout(canvas, state) {
    const hand = state.privateHand || [];
    const width = Math.min(60, canvas.width / (Math.max(1, hand.length) + 1));
    return { hand, width, left: (canvas.width - hand.length * width) / 2, top: canvas.height * .77 };
  }
  window.BoomRoomOfficialClientAdapters ||= {};
  window.BoomRoomOfficialClientAdapters[26] = {
    draw(canvas, session, selectedId) {
      const state = st(session), ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
      if (selectionRound !== state.round) { selected = []; selectionRound = state.round; }
      selected = selected.filter(n => (state.privateHand || []).includes(n));
      ctx.fillStyle = '#301424'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#682b44'; ctx.beginPath(); ctx.ellipse(w / 2, h * .35, w * .42, h * .24, 0, 0, Math.PI * 2); ctx.fill();
      ctx.textAlign = 'center'; ctx.fillStyle = '#ffe4ea'; ctx.font = 'bold ' + Math.max(14, w * .024) + 'px sans-serif';
      const actorName = id => state.members.find(m => m.id === id)?.name || '';
      ctx.fillText(state.stage === 'EXCHANGE' ? actorName(state.exchange?.from) + ' 向 ' + actorName(state.exchange?.to) + ' 隱密換牌' : '輪到 ' + actorName(state.turn), w / 2, h * .07);
      ctx.fillText((state.lastPlay?.cards || []).map(text).join('  ') || (state.stage === 'EXCHANGE' ? '選一張自己的牌，再選想徵求的牌' : '自由牌權'), w / 2, h * .34);
      state.members.forEach((member, i) => {
        const angle = -Math.PI / 2 + i * Math.PI * 2 / state.members.length;
        const x = w / 2 + Math.cos(angle) * w * .32, y = h * .32 + Math.sin(angle) * h * .15;
        ctx.fillStyle = member.alive ? '#fff' : '#d394aa';
        ctx.font = Math.max(12, w * .019) + 'px sans-serif';
        ctx.fillText(member.name + ' · ' + member.view.cardCount + ' 張', x, y);
        ctx.fillText(member.view.role || '', x, y + 18);
      });
      if (state.stage === 'EXCHANGE' && state.privateHand?.length) {
        ctx.font = Math.max(13, w * .019) + 'px sans-serif';
        for (let i = 0; i < ranks.length; i++) {
          const x = w * .08 + i % 7 * w * .12, y = h * (.48 + Math.floor(i / 7) * .075);
          ctx.fillStyle = i === requestRank ? '#ffe09f' : '#a76183';
          ctx.fillRect(x, y, w * .11, h * .065);
          ctx.fillStyle = '#241629'; ctx.fillText(ranks[i], x + w * .055, y + h * .045);
        }
        for (let i = 0; i < suits.length; i++) {
          const x = w * .22 + i * w * .15, y = h * .645;
          ctx.fillStyle = i === requestSuit ? '#ffe09f' : '#a76183'; ctx.fillRect(x, y, w * .13, h * .065);
          ctx.fillStyle = i === 1 || i === 2 ? '#b32852' : '#241629'; ctx.fillText(suits[i], x + w * .065, y + h * .045);
        }
      }
      const cards = layout(canvas, state);
      cards.hand.forEach((n, i) => {
        const x = cards.left + i * cards.width, y = cards.top - (selected.includes(n) ? 12 : 0);
        ctx.fillStyle = selected.includes(n) ? '#ffdeb4' : '#fff5ef'; ctx.fillRect(x, y, cards.width - 2, h * .17);
        ctx.fillStyle = n % 4 === 1 || n % 4 === 2 ? '#c02954' : '#21182a';
        ctx.font = 'bold ' + Math.max(12, cards.width * .38) + 'px sans-serif'; ctx.fillText(text(n), x + (cards.width - 2) / 2, y + h * .07);
      });
      if (!cards.hand.length) {
        ctx.fillStyle = '#d6a7b5'; ctx.font = '14px sans-serif'; ctx.fillText('公開觀戰只顯示張數，不顯示私牌', w / 2, h * .86);
      }
    },
    controls(session, userId) {
      const state = st(session), member = state.members.find(p => p.id === String(userId));
      if (state.stage === 'EXCHANGE') return [{
        label: '用所選一張徵求 ' + text(requestRank * 4 + requestSuit), kind: 'EXCHANGE',
        fields: { offer: selected[0], request: requestRank * 4 + requestSuit },
        disabled: state.phase !== 'playing' || state.exchange?.from !== String(userId) || selected.length !== 1
      }];
      const disabled = state.phase !== 'playing' || !member?.alive || state.turn !== String(userId);
      return [{ label: '出牌 (' + selected.length + ')', kind: 'PLAY', fields: { cards: [...selected] }, disabled: disabled || !selected.length },
        { label: 'PASS', kind: 'PASS', disabled: disabled || !state.lastPlay }];
    },
    pointer(canvas, event, session) {
      const state = st(session), cards = layout(canvas, state), rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) * canvas.width / rect.width, y = (event.clientY - rect.top) * canvas.height / rect.height;
      if (state.stage === 'EXCHANGE' && cards.hand.length && y < cards.top - 16) {
        for (let i = 0; i < 13; i++) {
          const left = canvas.width * (.08 + i % 7 * .12), top = canvas.height * (.48 + Math.floor(i / 7) * .075);
          if (x >= left && x <= left + canvas.width * .11 && y >= top && y <= top + canvas.height * .065) requestRank = i;
        }
        for (let i = 0; i < 4; i++) {
          const left = canvas.width * (.22 + i * .15), top = canvas.height * .645;
          if (x >= left && x <= left + canvas.width * .13 && y >= top && y <= top + canvas.height * .065) requestSuit = i;
        }
        return null;
      }
      if (y < cards.top - 16 || y > cards.top + canvas.height * .17) return null;
      const n = cards.hand[Math.floor((x - cards.left) / cards.width)];
      if (n != null) {
        if (selected.includes(n)) selected = selected.filter(v => v !== n);
        else if (selected.length < 5) selected.push(n);
      }
      return null;
    },
    key(event) {
      return event.key.toLowerCase() === 'p' ? { kind: 'PASS' } :
        event.key === 'Enter' && selected.length ? { kind: 'PLAY', cards: [...selected] } : null;
    }
  };
})();