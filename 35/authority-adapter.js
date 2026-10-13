(function () {
  'use strict';
  const adapters = window.BoomRoomOfficialClientAdapters ||= {};
  const laneColors = ['#60d8ff', '#91f5b5', '#f1b0ff', '#ffce78'];
  const ratingColors = { perfect: '#ffdd78', great: '#77e1ff', good: '#99efa7', miss: '#ff6f91' };
  adapters[35] = {
    controls() { return []; },
    draw(canvas, session, selectedId, serverNow) {
      const s = session.engineState || {}, chart = s.chart, p = (s.members || []).find(m => m.id === String(selectedId)), v = p?.view || {};
      const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height, font = Math.max(11, Math.min(18, w / 26));
      c.fillStyle = '#0b1023'; c.fillRect(0, 0, w, h); c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = 'bold ' + font + 'px sans-serif'; c.fillStyle = '#dbe9fb'; c.fillText(chart ? chart.title + ' · ' + chart.diff.toUpperCase() : '等待官方譜面載入', w / 2, h * .045);
      c.font = font * .85 + 'px sans-serif'; c.fillStyle = '#96cde9'; c.fillText((p?.name || '選擇觀戰玩家') + ' · ' + (p?.score || 0) + ' 分 · COMBO ' + (v.combo || 0), w / 2, h * .097);
      const x = w * .16, laneWidth = w * .17, top = h * .17, judgeY = h * .80, speed = (judgeY - top) / 3.2;
      const elapsed = s.startAt && ['playing', 'results'].includes(s.phase) ? Math.max(0, (serverNow - s.startAt) / 1000) : 0;
      const holds = new Set(v.holds || []), hits = new Map((v.lastHits || []).map(hit => [hit.id, hit]));
      const notes = new Map((chart?.notes || []).map(note => [note.id, note]));
      const hitTime = hit => hit.at + (notes.get(hit.id)?.type === 'hold' ? notes.get(hit.id).len || 0 : 0);
      for (let lane = 0; lane < 4; lane++) {
        c.fillStyle = v.keys?.[lane] ? '#253d56' : '#131d35'; c.fillRect(x + lane * laneWidth + 1, top, laneWidth - 2, judgeY - top + h * .10);
        c.strokeStyle = '#324460'; c.lineWidth = 1; c.strokeRect(x + lane * laneWidth, top, laneWidth, judgeY - top + h * .10);
        if (v.keys?.[lane]) {
          const gradient = c.createLinearGradient(0, judgeY, 0, top); gradient.addColorStop(0, laneColors[lane] + '99'); gradient.addColorStop(1, laneColors[lane] + '00'); c.fillStyle = gradient; c.fillRect(x + lane * laneWidth + 2, top, laneWidth - 4, judgeY - top);
        }
      }
      c.save(); c.beginPath(); c.rect(x, top, laneWidth * 4, judgeY - top + h * .055); c.clip();
      if (chart) {
        const beat = 60 / (chart.bpm || 120);
        for (let i = Math.floor(elapsed / beat) - 1; i <= Math.ceil((elapsed + 4) / beat); i++) {
          const y = judgeY - (i * beat - elapsed) * speed;
          c.strokeStyle = i % 4 ? '#22344a' : '#39546e'; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.lineTo(x + laneWidth * 4, y); c.stroke();
        }
        for (const note of chart.notes || []) {
          const hit = hits.get(note.id), head = judgeY - (note.t - elapsed) * speed, tail = judgeY - (note.t + (note.len || 0) - elapsed) * speed;
          if (head < top - h * .05 || tail > judgeY + h * .13) continue;
          const nx = x + note.lane * laneWidth, margin = laneWidth * .12, color = note.fake ? '#ff6685' : laneColors[note.lane];
          if (note.type === 'hold' && note.len > 0 && (!hit || holds.has(note.id))) {
            const end = holds.has(note.id) ? Math.min(head, judgeY) : head;
            c.fillStyle = color + '66'; c.fillRect(nx + laneWidth * .30, tail, laneWidth * .40, Math.max(0, end - tail));
            c.strokeStyle = color; c.lineWidth = 2; c.strokeRect(nx + laneWidth * .30, tail, laneWidth * .40, Math.max(0, end - tail));
          }
          if (hit && !holds.has(note.id)) continue;
          c.fillStyle = color; c.fillRect(nx + margin, holds.has(note.id) ? judgeY - h * .014 : head - h * .014, laneWidth - margin * 2, h * .028);
          if (note.type === 'slide') { c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.moveTo(nx + laneWidth * .30, head); c.lineTo(nx + laneWidth * .55, head); c.lineTo(nx + laneWidth * .46, head - h * .013); c.moveTo(nx + laneWidth * .55, head); c.lineTo(nx + laneWidth * .46, head + h * .013); c.stroke(); }
          if (note.fake) { c.font = 'bold ' + font * .75 + 'px sans-serif'; c.fillStyle = '#47152c'; c.fillText('×', nx + laneWidth / 2, head); }
        }
      }
      c.restore(); c.strokeStyle = '#e2eaff'; c.lineWidth = 3; c.beginPath(); c.moveTo(x, judgeY); c.lineTo(x + laneWidth * 4, judgeY); c.stroke();
      for (let lane = 0; lane < 4; lane++) {
        const hit = (v.lastHits || []).filter(a => notes.get(a.id)?.lane === lane).slice(-1)[0];
        const age = hit ? elapsed - hitTime(hit) : 100;
        if (age >= 0 && age < .35) { c.fillStyle = (ratingColors[hit.rating.toLowerCase()] || '#fff') + '88'; c.fillRect(x + lane * laneWidth, judgeY - h * .03, laneWidth, h * .06); }
        c.fillStyle = v.keys?.[lane] ? laneColors[lane] : '#31425e'; c.fillRect(x + lane * laneWidth + 5, judgeY + h * .025, laneWidth - 10, h * .07);
        c.font = 'bold ' + font + 'px sans-serif'; c.fillStyle = v.keys?.[lane] ? '#10233c' : '#cdd9eb'; c.fillText(['D', 'F', 'J', 'K'][lane], x + (lane + .5) * laneWidth, judgeY + h * .06);
      }
      const latest = (v.lastHits || []).slice(-1)[0], age = latest ? elapsed - hitTime(latest) : 100;
      if (age >= 0 && age < .65) { c.font = 'bold ' + font * 1.15 + 'px sans-serif'; c.fillStyle = ratingColors[latest.rating.toLowerCase()] || '#fff'; c.fillText(latest.rating.toUpperCase(), w / 2, h * .145); }
      c.font = Math.max(10, font * .72) + 'px sans-serif'; c.fillStyle = '#bdd3e9'; c.fillText('P ' + (v.perfect || 0) + ' · GREAT ' + (v.great || 0) + ' · GOOD ' + (v.good || 0) + ' · MISS ' + (v.miss || 0) + ' · ' + ((v.accuracy || 0) * 100).toFixed(1) + '%', w / 2, h * .95);
      c.fillStyle = '#8da5c4'; c.fillText('公開節奏觀戰 · 音符與按鍵由伺服器狀態重建', w / 2, h * .99);
    }
  };
})();
