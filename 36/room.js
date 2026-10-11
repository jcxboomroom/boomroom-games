/* A host-coordinated casual battle over authenticated SDK events. */
(function (root, factory) {
  const rules = typeof module === 'object' && module.exports ? require('./engine.js') : root.TetrisBattleEngine;
  const api = factory(rules);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TetrisBattleRoom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (rules) {
  'use strict';
  const int = (n,lo,hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const copy = v => JSON.parse(JSON.stringify(v));
  class Room {
    constructor(sdk, { changed = () => {}, garbage = () => {}, notice = () => {} } = {}) {
      this.sdk = sdk; this.changed = changed; this.garbage = garbage; this.notice = notice;
      const session = sdk.getSession();
      this.sessionId = session.sessionId; this.seed = session.seed >>> 0;
      this.self = String(sdk.getUser().id); this.host = String(session.hostId);
      this.players = new Map(session.players.map(p => {
        const id = String(p.userId ?? p.id);
        return [id, { id, name: String(p.username || '玩家').slice(0,24), alive: true, view: null,
          seq: 0, attackSeq: 0, eliminatedAt: null, lastSeen: this.now(), connected: true, inRound: false }];
      }));
      this.ready = new Set(); this.round = 0; this.phase = 'lobby'; this.startAt = this.endAt = 0;
      this.results = []; this.lastSync = 0; this.lastHello = 0; this.hostSeen = this.now();
      this.stateSeq = 0; this.attackSeq = 0; this.pending = new Map(); this.received = new Set();
      this.finishDue = 0; this.closed = false; this.recovering = !this.isHost;
      this.wantsReady = false; this.lastSnapshotAt = -Infinity;
      this.garbageLog = new Map();
      this.off = [sdk.onGameEvent((name,payload,sender) => this.receive(name,payload,String(sender))),
        sdk.onSessionEnd(() => this.endSession()),
        sdk.onRoomPlayersChange(({players}) => this.roster(players))];
      if (!this.players.has(this.self) || !this.players.has(this.host)) throw new Error('參賽者或房主資料無效');
    }
    now() {
      const value = this.sdk.getServerTime();
      if (Number.isFinite(value)) this.lastNow = value;
      // SDK pagehide disposal may run before this game's save handler.
      return this.lastNow ?? Date.now();
    }
    get isHost() { return this.self === this.host; }
    get seedForRound() { return (this.seed + Math.imul(this.round, 2654435761)) >>> 0; }
    send(name, fields) {
      if (this.closed || this.sdk.status !== 'PLAYING') return false;
      const packet = { ...fields, session: this.sessionId };
      if (!this.sdk.sendGameEvent(name,packet)) { this.notice('目前無法送出，請重試同步'); return false; }
      // Some hosts echo to the sender, others do not. All handlers are idempotent.
      this.receive(name,packet,this.self); return true;
    }
    setReady() {
      if (this.phase !== 'lobby' && this.phase !== 'results') return false;
      this.wantsReady = true;
      return this.send('TB_READY',{ round: this.round });
    }
    start() {
      const active = [...this.players.values()].filter(p => p.connected);
      if (!this.isHost || !['lobby','results'].includes(this.phase) || active.length < 2 ||
          active.some(p => !this.ready.has(p.id))) return false;
      return this.send('TB_CONTROL',{ kind:'START', round:this.round+1, startAt:this.now()+3000,
        ids: active.map(p=>p.id) });
    }
    publish(view) {
      if (!rules.validView(view) || this.phase !== 'playing' || this.recovering || !this.players.get(this.self).inRound) return false;
      return this.send('TB_STATE',{ round:this.round, seq:++this.stateSeq, view });
    }
    attack(lines, target) {
      if (this.phase !== 'playing' || this.recovering || !int(lines,1,20) || !this.players.get(this.self)?.alive) return false;
      const packet = { round:this.round, seq:++this.attackSeq, lines, target:String(target) };
      this.pending.set(packet.seq,{ packet, sent:this.now(), first:this.now() });
      return this.send('TB_ATTACK',packet);
    }
    forfeit() {
      const p = this.players.get(this.self);
      if (this.phase !== 'playing' || !p?.view) return;
      this.publish({ ...p.view, status:'over' });
    }
    sync() { this.lastHello = this.now(); return this.send('TB_SYNC_REQUEST',{ round:this.round }); }
    roster(list) {
      const ids = new Set(list.map(p => String(p.id ?? p.userId)));
      for (const p of this.players.values()) p.connected = ids.has(p.id);
      if (!ids.has(this.host)) { this.phase = 'interrupted'; this.recovering = true; this.changed(); }
    }
    receive(name, packet, sender) {
      if (this.closed || !name.startsWith('TB_') || !packet || packet.session !== this.sessionId || !this.players.has(sender)) return;
      const p = this.players.get(sender), time = this.now();
      p.lastSeen = time; p.connected = true;
      if (sender === this.host) { this.hostSeen = time; this.recovering = false; }
      if (name === 'TB_READY' && packet.round === this.round && ['lobby','results'].includes(this.phase)) {
        this.ready.add(sender); this.changed();
      } else if (name === 'TB_SYNC_REQUEST' && this.isHost) {
        this.send('TB_SYNC',this.snapshot());
      } else if (name === 'TB_SYNC' && sender === this.host && this.validSnapshot(packet)) {
        if (!this.isHost && packet.syncAt >= this.lastSnapshotAt) {
          this.lastSnapshotAt = packet.syncAt;
          this.applySnapshot(packet);
        }
      } else if (name === 'TB_GARBAGE_ACK' && this.isHost && packet.round === this.round &&
          typeof packet.key === 'string' && this.garbageLog.get(packet.key)?.target === sender) {
        this.garbageLog.delete(packet.key);
      } else if (name === 'TB_CONTROL' && sender === this.host) {
        this.control(packet);
      } else if (name === 'TB_STATE' && packet.round === this.round && this.phase === 'playing' &&
          p.inRound && int(packet.seq,1,100000000) && packet.seq > p.seq && rules.validView(packet.view)) {
        p.seq = packet.seq; p.view = copy(packet.view);
        if (p.alive && packet.view.status !== 'playing') { p.alive = false; p.eliminatedAt = time; }
        this.changed();
      } else if (name === 'TB_ATTACK' && this.isHost && this.phase === 'playing' && packet.round === this.round &&
          p.alive && int(packet.seq,1,100000000) && int(packet.lines,1,20)) {
        // Repeated sends reissue the same receipt, never apply a second garbage packet.
        if (packet.seq < p.attackSeq) return;
        if (packet.seq === p.attackSeq) {
          if (p.lastAttack) this.send('TB_CONTROL',p.lastAttack);
          return;
        }
        const opponents = [...this.players.values()].filter(o=>o.id !== sender && o.alive && o.view);
        const target = opponents.find(o=>o.id === packet.target) || opponents.sort((a,b)=>Number(a.id)-Number(b.id))[0];
        if (!target) return;
        p.attackSeq = packet.seq;
        p.lastAttack = { kind:'GARBAGE', round:this.round, from:sender, target:target.id, seq:packet.seq,
          lines:packet.lines, hole:((this.seedForRound ^ Math.imul(Number(sender),31) ^ Math.imul(packet.seq,97))>>>0)%10 };
        if (this.garbageLog.size >= 512) { this.notice('攻擊等待同步，請稍後'); return; }
        this.garbageLog.set(`${this.round}:${sender}:${packet.seq}`,copy(p.lastAttack));
        this.send('TB_CONTROL',p.lastAttack);
      }
    }
    control(packet) {
      if (packet.kind === 'START' && int(packet.round,1,100000) && packet.round === this.round+1 &&
          ['lobby','results'].includes(this.phase) && Number.isFinite(packet.startAt) &&
          packet.startAt >= this.now()-10000 && packet.startAt <= this.now()+5000 &&
          Array.isArray(packet.ids) && packet.ids.length >= 2 && packet.ids.length <= 10 &&
          new Set(packet.ids).size === packet.ids.length && packet.ids.every(id=>this.players.has(id))) {
        this.round = packet.round; this.phase = 'countdown'; this.startAt = packet.startAt;
        this.endAt = packet.startAt + 180000; this.results = []; this.ready.clear();
        this.received.clear(); this.pending.clear(); this.stateSeq = this.attackSeq = 0; this.finishDue = 0;
        this.wantsReady = false;
        this.garbageLog.clear();
        for (const p of this.players.values()) {
          p.inRound = packet.ids.includes(p.id); p.alive = p.inRound; p.view = null; p.seq = p.attackSeq = 0;
          p.eliminatedAt = null; p.lastAttack = null; p.lastSeen = this.now();
        }
        this.changed();
      } else if (packet.kind === 'GARBAGE' && this.phase === 'playing' && packet.round === this.round &&
          this.players.has(packet.from) && this.players.has(packet.target) && packet.from !== packet.target &&
          int(packet.seq,1,100000000) && int(packet.lines,1,20) && int(packet.hole,0,9)) {
        const key = `${this.round}:${packet.from}:${packet.seq}`;
        if (packet.from === this.self) this.pending.delete(packet.seq);
        if (this.received.has(key)) {
          if (packet.target === this.self) this.send('TB_GARBAGE_ACK',{round:this.round,key});
          return;
        }
        this.received.add(key);
        if (this.received.size > 20000) this.received.delete(this.received.values().next().value);
        if (packet.target === this.self && this.players.get(this.self).alive) this.garbage(packet.lines,packet.hole);
        if (packet.target === this.self) this.send('TB_GARBAGE_ACK',{round:this.round,key});
      } else if (packet.kind === 'RESULT' && packet.round === this.round && this.validResults(packet.results) &&
          ['playing','countdown'].includes(this.phase)) {
        this.phase = 'results'; this.results = copy(packet.results); this.ready.clear(); this.pending.clear(); this.changed();
      }
    }
    validResults(results) {
      return Array.isArray(results) && results.length >= 2 && results.length <= this.players.size &&
        new Set(results.map(r=>r.id)).size === results.length && results.every(r=>this.players.has(r.id) &&
          int(r.rank,1,10) && ['score','lines','attack'].every(k=>int(r[k],0,100000000)) && typeof r.alive === 'boolean');
    }
    validSnapshot(s) {
      return int(s.round,0,100000) && s.round >= this.round && Number.isFinite(s.syncAt) && ['lobby','countdown','playing','results','interrupted'].includes(s.phase) &&
        Number.isFinite(s.startAt) && Number.isFinite(s.endAt) && s.endAt >= s.startAt &&
        Array.isArray(s.ready) && s.ready.every(id=>this.players.has(id)) &&
        Array.isArray(s.members) && s.members.length === this.players.size && new Set(s.members.map(p=>p.id)).size === s.members.length &&
        s.members.every(p=>this.players.has(p.id) && typeof p.alive === 'boolean' && typeof p.connected === 'boolean' && typeof p.inRound === 'boolean' &&
          int(p.seq,0,100000000) && int(p.attackSeq,0,100000000) && (p.view === null || rules.validView(p.view)) &&
          (p.eliminatedAt === null || Number.isFinite(p.eliminatedAt))) &&
        Array.isArray(s.garbageLog) && s.garbageLog.length <= 512 && s.garbageLog.every(p=>
          p.kind==='GARBAGE' && p.round===s.round && this.players.has(p.from) && this.players.has(p.target) &&
          p.from!==p.target && int(p.seq,1,100000000) && int(p.lines,1,20) && int(p.hole,0,9)) &&
        (s.phase !== 'results' || this.validResults(s.results));
    }
    snapshot() {
      return { round:this.round, phase:this.phase, syncAt:this.now(), startAt:this.startAt, endAt:this.endAt, ready:[...this.ready],
        members:[...this.players.values()].map(({id,alive,view,seq,attackSeq,eliminatedAt,connected,inRound})=>
          ({id,alive,view,seq,attackSeq,eliminatedAt,connected,inRound})), results:this.results, garbageLog:[...this.garbageLog.values()] };
    }
    applySnapshot(s) {
      const newRound = s.round > this.round;
      if (!newRound && this.phase === 'results' && s.phase !== 'results') return;
      if (!newRound && this.phase === 'playing' && ['lobby','countdown'].includes(s.phase)) return;
      this.round = s.round; this.phase = s.phase; this.startAt = s.startAt; this.endAt = s.endAt;
      this.ready = new Set(s.ready); this.results = copy(s.results || []);
      if (newRound) { this.pending.clear(); this.received.clear(); this.stateSeq = this.attackSeq = 0; this.wantsReady = false; }
      for (const incoming of s.members) {
        const p = this.players.get(incoming.id);
        if (newRound || incoming.seq >= p.seq) Object.assign(p,copy(incoming));
        // Host elimination and connectivity override newer local previews.
        if (!incoming.alive) p.alive = false;
        p.connected = incoming.connected;
      }
      const self = this.players.get(this.self);
      this.stateSeq = Math.max(this.stateSeq,self.seq); this.attackSeq = Math.max(this.attackSeq,self.attackSeq);
      this.changed();
      for (const packet of s.garbageLog) this.control(packet);
    }
    restore(snapshot) {
      if (!this.validSnapshot(snapshot)) return false;
      if (this.isHost) {
        this.garbageLog = new Map(snapshot.garbageLog.map(p=>[`${p.round}:${p.from}:${p.seq}`,copy(p)]));
        this.applySnapshot(snapshot); this.recovering = false;
      }
      else { this.round = snapshot.round; this.stateSeq = snapshot.members.find(p=>p.id===this.self)?.seq || 0;
        this.attackSeq = snapshot.members.find(p=>p.id===this.self)?.attackSeq || 0; }
      return true;
    }
    endSession() { this.phase = 'ended'; this.recovering = true; this.pending.clear(); this.changed(); }
    tick() {
      if (this.closed || this.phase === 'ended') return;
      const time = this.now();
      if (!this.isHost && time-this.hostSeen > 5000 && !this.recovering) { this.recovering = true; this.changed(); this.sync(); }
      if (time-this.lastHello >= 2000) {
        this.sync();
        if (this.wantsReady && ['lobby','results'].includes(this.phase)) this.send('TB_READY',{round:this.round});
      }
      if (this.phase === 'countdown' && time >= this.startAt) { this.phase = 'playing'; this.changed(); }
      for (const [seq, pending] of this.pending) {
        if (time-pending.first > 8000) { this.pending.delete(seq); this.notice('攻擊同步逾時，已停止重送'); }
        else if (time-pending.sent >= 800) { pending.sent = time; this.send('TB_ATTACK',pending.packet); }
      }
      if (!this.isHost) return;
      for (const p of this.players.values()) {
        if (time-p.lastSeen > 8000 && p.connected) { p.connected = false; this.ready.delete(p.id); this.changed(); }
        if (this.phase === 'playing' && p.alive && time-p.lastSeen > 25000) {
          p.alive = false; p.eliminatedAt = time; this.changed();
        }
      }
      if (this.phase === 'playing') {
        const alive = [...this.players.values()].filter(p=>p.alive);
        if (alive.length <= 1 || time >= this.endAt) {
          if (!this.finishDue) this.finishDue = time+700;
          if (time >= this.finishDue) this.finish();
        } else this.finishDue = 0;
      }
      if (time-this.lastSync >= 1000) { this.lastSync = time; this.send('TB_SYNC',this.snapshot()); }
    }
    finish() {
      const included = [...this.players.values()].filter(p=>p.inRound);
      if (included.length < 2) return;
      const values = p => [p.alive ? 1 : 0, p.alive ? p.view?.attack || 0 : p.eliminatedAt || 0,
        p.view?.score || 0, p.view?.lines || 0];
      included.sort((a,b)=>{ const av=values(a),bv=values(b); for(let i=0;i<av.length;i++) if(av[i]!==bv[i])return bv[i]-av[i]; return Number(a.id)-Number(b.id); });
      let rank=1;
      const results=included.map((p,i)=>{
        if (i && JSON.stringify(values(p))!==JSON.stringify(values(included[i-1]))) rank=i+1;
        return { id:p.id,rank,alive:p.alive,score:p.view?.score||0,lines:p.view?.lines||0,attack:p.view?.attack||0 };
      });
      this.send('TB_CONTROL',{kind:'RESULT',round:this.round,results});
    }
    dispose() { this.closed = true; this.pending.clear(); for(const off of this.off) off?.(); this.off=[]; }
  }
  return { Room };
});
