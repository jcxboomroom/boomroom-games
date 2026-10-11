/* Online authority and explicitly local AI practice share the presentation API. */
(function(root){
  'use strict';
  const {Engine}=root.TetrisBattleEngine, AI=root.TetrisBattleAI;
  class AuthorityRoom {
    constructor(sdk,callbacks={}){
      this.sdk=sdk;this.callbacks=callbacks;this.self=String(sdk.getUser().id);this.verified=true;this.local=false;
      this.players=new Map();this.ready=new Set();this.received=new Set();this.pending=[];this.seq=0;this.version=-1;this.round=0;this.lastSeen=performance.now();this.lastPing=0;this.lastSend=0;this.offset=Date.now()-performance.now();
      this.off=sdk.onGameEvent((name,payload,sender)=>{
        if(String(sender)!=='SYSTEM')return;
        if(name==='TETRIS_PRIVATE'&&String(payload?.userId)===this.self)this.accept(payload.session);
        if(name==='TETRIS_ERROR')callbacks.notice?.(payload?.message||'操作未確認，請同步');
      });
      this.endOff=sdk.onSessionEnd(()=>{this.phase='ended';callbacks.changed?.();});
      this.accept(sdk.getSession(),false);
    }
    now(){return performance.now()+this.offset;}
    get isHost(){return this.host===this.self;}
    get seedForRound(){return (this.state.seed+Math.imul(this.round,2654435761))>>>0;}
    get allReady(){return this.players.size>=2&&[...this.players.values()].filter(p=>!p.bot).every(p=>p.connected&&this.ready.has(p.id)&&Object.hasOwn(this.proposals,p.id));}
    accept(session,announce=true){
      if(session?.engine!=='TETRIS'||session.sessionId!==this.sdk.getSession()?.sessionId||session.version<this.version)return;
      const state=session.engineState;if(!state||!Array.isArray(state.members))return;
      this.version=session.version;this.offset=Number(session.serverTime)-performance.now();this.lastSeen=performance.now();this.recovering=false;
      if(this.round!==state.round){this.pending=[];this.seq=0;}
      this.state=state;for(const key of ['host','round','phase','startAt','endAt','epoch','stake','limit','proposals','aiLevels','results','settlement','ownBalance'])this[key]=state[key];
      this.ready=new Set(state.ready);this.players=new Map(state.members.map(p=>[p.id,{...p,seq:p.ack}]));
      const own=state.members.find(p=>p.id===this.self);this.pending=this.pending.filter(c=>c.seq>(own?.ack||0));this.seq=Math.max(this.seq,own?.ack||0);
      this.ownEngine=own?.engine?Engine.restore(own.engine):null;
      if(announce)this.callbacks.changed?.();
    }
    predicted(){
      if(!this.ownEngine)return null;
      const engine=Engine.restore(this.ownEngine.save());let at=this.state.at,soft=this.players.get(this.self)?.soft||false;
      // Replay only unacknowledged commands; boards, attacks and rankings come
      // from the server snapshot. Input stays immediate while packets travel.
      for(const c of this.pending){const next=Math.max(at,c.localAt);if(this.phase==='playing')engine.advance(Math.min(1000,next-at),soft);at=next;
        if(c.kind==='softOn'||c.kind==='softOff')soft=c.kind==='softOn';else if(c.pieces===engine.pieces)AI.apply(engine,c.kind);
      }
      if(this.phase==='playing')engine.advance(Math.min(1000,Math.max(0,this.now()-at)),soft);engine.drainEvents();return engine;
    }
    send(command){return this.sdk.sendGameEvent('TETRIS_COMMAND',{round:this.round,...command});}
    control(kind,fields={}){this.sdk.sendCommand('TETRIS_COMMAND',kind,{round:this.round,epoch:this.epoch,stake:this.stake,...fields},{expectedVersion:this.version});}
    setReady(){this.control('READY');}
    start(){this.control('START');}
    vote(amount){this.control('VOTE',{amount});}
    configure(levels){this.control('CONFIGURE',{levels});}
    input(kind,pieces,target){if(this.phase!=='playing'||this.recovering)return;this.pending.push({kind,pieces,target,round:this.round,seq:++this.seq,localAt:this.now(),sentAt:0});this.pump();}
    selectTarget(id){if(id)this.input('target',null,id);}
    pump(){const time=performance.now();if(time-this.lastSend<12)return;const c=this.pending.find(p=>!p.sentAt||time-p.sentAt>=600);if(!c)return;const {localAt,sentAt,...packet}=c;if(this.send(packet)){c.sentAt=time;this.lastSend=time;}}
    tick(){this.pump();const time=performance.now();if(time-this.lastSeen>5000&&!this.recovering){this.recovering=true;this.callbacks.changed?.();}if(time-this.lastPing>1500){this.lastPing=time;this.send({kind:'PING'});this.send({kind:'SYNC'});}}
    sync(){this.control('SYNC');}
    publish(){} attack(){}
    forfeit(){this.send({kind:'EXIT'});}
    snapshot(){return null;}
    dispose(){this.off?.();this.endOff?.();this.pending=[];}
  }
  class PracticeRoom {
    constructor(levels,callbacks={}){
      this.callbacks=callbacks;this.local=true;this.verified=false;this.self='local';this.host='local';this.received=new Set();this.recovering=false;
      this.arena=new root.TetrisBattleArena.Arena([{id:'local',name:'你'}],'local',Date.now()>>>0);this.arena.configure(levels);this.refresh(false);
    }
    now(){return Date.now();}get isHost(){return true;}get allReady(){return this.arena.canStart();}
    get seedForRound(){return (this.arena.seed+Math.imul(this.round,2654435761))>>>0;}
    refresh(announce=true){const s=this.arena;for(const key of ['round','phase','startAt','endAt','epoch','stake','limit','proposals','aiLevels','results','settlement'])this[key]=s[key];this.ready=new Set(s.ready);this.players=new Map(s.members.map(p=>[p.id,{...p,view:p.engine?.view()||null,seq:p.ack}]));this.ownEngine=s.members[0].engine;if(announce)this.callbacks.changed?.();}
    configure(levels){this.arena.configure(levels);this.refresh();}
    setReady(){this.arena.vote(this.self,0);this.arena.consent(this.self,this.arena.epoch,0);this.refresh();}
    start(){this.arena.members[0].lastSeen=this.now();this.arena.begin(this.now());this.refresh();}
    tick(){this.arena.members[0].lastSeen=this.now();this.arena.advance(this.now(),this.self);this.refresh();}
    selectTarget(id){this.arena.members[0].target=id;}
    publish(){const m=this.arena.members[0];if(m.engine?.status!=='playing'&&m.alive){m.alive=false;m.eliminatedAt=this.now();}this.refresh(false);}
    attack(lines,target){this.arena.garbage(this.self,lines,target);}
    forfeit(){this.arena.members[0].engine?.finish('forfeit');this.publish();}
    sync(){this.refresh();}snapshot(){return null;}dispose(){}
  }
  root.TetrisAuthority={AuthorityRoom,PracticeRoom};
})(window);
