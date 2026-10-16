/* Online authority and explicitly local AI practice share the presentation API. */
(function(root){
  'use strict';
  const {Engine}=root.TetrisBattleEngine, AI=root.TetrisBattleAI;
  class AuthorityRoom {
    constructor(sdk,callbacks={}){
      this.sdk=sdk;this.callbacks=callbacks;this.self=String(sdk.getUser().id);this.verified=true;this.local=false;
      this.spectator=sdk.isSpectator===true;
      this.players=new Map();this.ready=new Set();this.received=new Set();this.pending=[];this.seq=0;this.version=-1;this.round=0;this.serverTime=-1;this.lastSeen=performance.now();this.lastPing=0;this.lastSend=0;this.lastPull=-Infinity;this.offset=Date.now()-performance.now();
      this.off=sdk.onGameEvent((name,payload,sender)=>{
        if(String(sender)!=='SYSTEM')return;
        if(name==='TETRIS_PRIVATE'&&String(payload?.userId)===this.self)this.accept(payload.session);
        if(this.spectator&&name==='TETRIS_SPECTATOR')this.accept(payload.session);
        if(name==='TETRIS_QUEUED'&&Number(payload?.round)===this.round&&Number.isSafeInteger(payload?.seq)&&Number.isFinite(payload?.receivedAt)){
          const pending=this.pending.find(command=>command.round===this.round&&command.seq===payload.seq);
          if(pending)pending.localAt=Math.max(pending.localAt,payload.receivedAt);
        }
        if(name==='TETRIS_ERROR'){
          if(payload?.code==='TETRIS_INPUT_RESYNC'){
            this.rebasePending();this.callbacks.changed?.();
            this.correctionUntil=performance.now()+2200;
          }else callbacks.notice?.(payload?.message||'操作未確認，請同步');
        }
      });
      this.endOff=sdk.onSessionEnd(()=>{this.phase='ended';callbacks.changed?.();});
      this.accept(sdk.getSession(),false);
    }
    now(){return performance.now()+this.offset;}
    get isHost(){return !this.spectator&&this.host===this.self;}
    get seedForRound(){return (this.state.seed+Math.imul(this.round,2654435761))>>>0;}
    get allReady(){const humans=[...this.players.values()].filter(p=>!p.bot);return humans.length===1?humans[0].connected&&!humans[0].forfeited:humans.length>=2&&humans.every(p=>p.connected&&!p.forfeited&&this.ready.has(p.id)&&Object.hasOwn(this.proposals,p.id));}
    accept(session,announce=true){
      if(session?.engine!=='TETRIS'||session.sessionId!==this.sdk.getSession()?.sessionId||!Number.isSafeInteger(session.version)||session.version<0||!Number.isFinite(session.serverTime)||session.version<this.version)return;
      let state=session.engineState;if(!state||!Array.isArray(state.members))return;
      if(state.round<this.round)return;
      if(session.version===this.version){
        if(session.serverTime<=this.serverTime)return;
        this.serverTime=session.serverTime;this.lastSeen=performance.now();this.recovering=false;
        const target=session.serverTime-performance.now();this.offset+=Math.max(-50,Math.min(50,target-this.offset))*.12;
        return;
      }
      if(this.spectator&&state.boardEncoding==='digits-v1'){
        if(state.members.some(m=>m.view&&(!Array.isArray(m.view.board)||m.view.board.length!==22||m.view.board.some(line=>typeof line!=='string'||!/^[0-8]{10}$/.test(line)))))return;
        state={...state,members:state.members.map(m=>({...m,view:m.view?{...m.view,board:m.view.board.map(line=>[...line].map(Number))}:null}))};
      }
      const clock=performance.now(),target=session.serverTime-clock,first=this.version<0;
      this.version=session.version;this.serverTime=session.serverTime;this.offset=first?target:this.offset+Math.max(-50,Math.min(50,target-this.offset))*.2;this.lastSeen=clock;this.recovering=false;
      if(this.round!==state.round){this.pending=[];this.seq=0;}
      this.state=state;for(const key of ['host','round','phase','startAt','endAt','epoch','stake','limit','proposals','aiLevels','results','settlement','ownBalance'])this[key]=state[key];
      this.ready=new Set(state.ready);this.players=new Map(state.members.map(p=>[p.id,{...p,seq:p.ack}]));
      const own=state.members.find(p=>p.id===this.self);this.pending=this.pending.filter(c=>c.seq>(own?.ack||0));this.seq=Math.max(this.seq,own?.ack||0);
      if(!own?.alive)this.pending=[];
      this.ownEngine=own?.engine?Engine.restore(own.engine):null;
      if(announce)this.callbacks.changed?.();
    }
    rebasePending(){
      const own=this.players.get(this.self),ack=Number.isSafeInteger(own?.ack)?own.ack:0;
      const engine=this.ownEngine?Engine.restore(this.ownEngine.save()):null;
      if(!engine){this.pending=[];this.seq=ack;this.requestSnapshot();return;}
      let at=Number.isFinite(this.state?.at)?this.state.at:this.now(),soft=!!own?.soft,seq=ack;
      const kept=[];
      for(const command of this.pending.filter(c=>c.round===this.round&&c.seq>ack).sort((a,b)=>a.seq-b.seq)){
        const next=Math.max(at,Number.isFinite(command.localAt)?command.localAt:at);
        if(this.phase==='playing')engine.advance(Math.min(1000,Math.max(0,next-at)),soft);
        at=next;
        command.round=this.round;command.localAt=at;command.sentAt=0;
        if(command.kind==='softOn'||command.kind==='softOff'){
          command.pieces=engine.pieces;soft=command.kind==='softOn';
        }else if(command.kind==='target'){
          if(!this.players.get(String(command.target))?.alive)continue;
        }else{
          command.pieces=engine.pieces;
          if(!AI.apply(engine,command.kind))continue;
        }
        command.seq=++seq;kept.push(command);
      }
      this.pending=kept;this.seq=seq;
    }
    predicted(){
      if(!this.ownEngine)return null;
      const engine=Engine.restore(this.ownEngine.save());let at=this.state.at,soft=this.players.get(this.self)?.soft||false;
      // Replay only unacknowledged commands; boards, attacks and rankings come
      // from the server snapshot. Input stays immediate while packets travel.
      for(const c of this.pending){const next=Math.max(at,c.localAt);if(this.phase==='playing')engine.advance(Math.min(1000,next-at),soft);at=next;
        if(c.kind==='softOn'||c.kind==='softOff')soft=c.kind==='softOn';else if(c.kind!=='target'&&c.pieces===engine.pieces)AI.apply(engine,c.kind);
      }
      if(this.phase==='playing')engine.advance(Math.min(1000,Math.max(0,this.now()-at)),soft);engine.drainEvents();return engine;
    }
    send(command){return !this.spectator&&this.sdk.sendGameEvent('TETRIS_COMMAND',{round:this.round,...command});}
    control(kind,fields={}){if(!this.spectator)this.sdk.sendCommand('TETRIS_COMMAND',kind,{round:this.round,epoch:this.epoch,stake:this.stake,...fields},{expectedVersion:this.version});}
    setReady(){this.control('READY');}
    start(){this.control('START');}
    vote(amount){this.control('VOTE',{amount});}
    configure(levels){this.control('CONFIGURE',{levels});}
    input(kind,pieces,target){if(this.spectator||this.phase!=='playing'||this.recovering||!this.players.get(this.self)?.alive)return;this.pending.push({kind,pieces,target,round:this.round,seq:++this.seq,localAt:this.now(),sentAt:0});this.pump();}
    selectTarget(id){if(id)this.input('target',null,id);}
    pump(){const time=performance.now();if(time-this.lastSend<12)return;const c=this.pending.find(p=>!p.sentAt||time-p.sentAt>=600);if(!c)return;const {localAt,sentAt,...packet}=c;if(this.send(packet)){c.sentAt=time;this.lastSend=time;}}
    requestSnapshot(){const time=performance.now();if(time-this.lastPull<2000)return;this.lastPull=time;this.sdk.requestGameUi?.('SYNC');}
    tick(){this.pump();const time=performance.now();if(time-this.lastSeen>5000){if(!this.recovering){this.recovering=true;this.callbacks.changed?.();}this.requestSnapshot();}if(!this.spectator&&time-this.lastPing>1500){this.lastPing=time;this.send({kind:'PING'});}}
    sync(){this.control('SYNC');this.requestSnapshot();}
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
