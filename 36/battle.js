/* Shared deterministic match rules. Only server code may debit or credit coins. */
(function(root,factory){
  const node=typeof module==='object'&&module.exports,api=factory(node?require('./engine.js'):root.TetrisBattleEngine,node?require('./ai.js'):root.TetrisBattleAI);
  if(node)module.exports=api;else root.TetrisBattleArena=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(rules,ai){
  'use strict';const copy=v=>JSON.parse(JSON.stringify(v));
  class Arena {
    constructor(players,host,seed=1){
      this.host=String(host);this.seed=seed>>>0;this.round=0;this.phase='lobby';this.epoch=1;this.stake=0;this.proposals={};this.ready=[];
      this.aiLevels=[];this.limit=0;this.startAt=0;this.endAt=0;this.at=0;this.results=[];this.settlement=null;this.abortReason='';this.readyAt={};this.walletBalances={};
      this.members=players.map(p=>({id:String(p.userId??p.id),name:String(p.username??p.name??'玩家').slice(0,24),bot:false,level:0,alive:true,inRound:false,connected:true,engine:null,ack:0,target:null,soft:false,lastInput:0,lastHard:0,lastSeen:0,eliminatedAt:null,nextAI:0}));
    }
    static restore(data){const arena=Object.create(Arena.prototype);Object.assign(arena,copy(data));for(const m of arena.members)m.engine=m.engine?rules.Engine.restore(m.engine):null;return arena;}
    save(){const out={...this,members:this.members.map(m=>({...m,engine:m.engine?.save()||null}))};return copy(out);}
    get humans(){return this.members.filter(m=>!m.bot);}
    invalidate(){this.epoch++;this.ready=[];this.readyAt={};}
    configure(levels){
      if(!['lobby','results'].includes(this.phase)||!Array.isArray(levels)||levels.length+this.humans.length>10||levels.some(n=>!Number.isInteger(n)||n<1||n>9))throw Error('AI 設定無效');
      this.aiLevels=[...levels];this.members=this.humans.concat(levels.map((level,i)=>({id:'ai:'+i,name:`AI ${i+1} · Lv.${level}`,bot:true,level,alive:true,inRound:false,connected:true,engine:null,ack:0,target:null,soft:false,lastInput:0,lastHard:0,lastSeen:0,eliminatedAt:null,nextAI:0})));
      // Free practice still requires each human's explicit zero vote.
      this.proposals={};this.stake=0;this.invalidate();
    }
    vote(id,amount){
      if(!['lobby','results'].includes(this.phase)||!this.humans.some(m=>m.id===id)||this.humans.length<2||!Number.isSafeInteger(amount)||amount<0||amount>this.limit)throw Error('提案金額超出可用餘額，或單人練習不需加碼提案');
      if(this.proposals[id]===amount)return;
      this.proposals[id]=amount;const counts=new Map();for(const value of Object.values(this.proposals))counts.set(value,(counts.get(value)||0)+1);
      this.stake=[...counts].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0]?.[0]||0;this.invalidate();
    }
    consent(id,epoch,stake,now=Date.now()){if(!['lobby','results'].includes(this.phase)||epoch!==this.epoch||stake!==this.stake||!this.humans.some(m=>m.id===id)||!this.humans.every(m=>Object.hasOwn(this.proposals,m.id)))throw Error('金額或設定已變更，或尚未全員投票，請重新確認');if(!this.ready.includes(id))this.ready.push(id);this.readyAt??={};this.readyAt[id]=now;}
    canStart(){
      if(!['lobby','results'].includes(this.phase)||!this.humans.length||this.humans.some(m=>m.forfeited||!m.connected))return false;
      // One real player starts a free server-authoritative challenge directly;
      // configured AI seats remain optional opponents and never vote or pay.
      if(this.humans.length===1)return this.stake===0;
      return this.humans.every(m=>this.ready.includes(m.id)&&Object.hasOwn(this.proposals,m.id))&&(!this.stake||this.humans.length>=2);
    }
    begin(now){
      if(!this.canStart())throw Error('須全員投票並確認同一金額與 AI 設定');this.round++;this.phase='countdown';this.startAt=now+3000;this.endAt=this.startAt+180000;this.at=now;this.results=[];this.settlement=null;this.abortReason='';this.ready=[];
      const seed=(this.seed+Math.imul(this.round,2654435761))>>>0;
      for(const m of this.members){m.engine=new rules.Engine({seed,mode:'battle'});m.ack=0;m.alive=true;m.inRound=true;m.eliminatedAt=null;m.soft=false;m.lastSeen=now;m.lastInput=0;m.lastHard=0;m.nextAI=this.startAt+ai.delay(m.level);m.target=null;}
    }
    garbage(from,lines,target){
      const sender=this.members.find(m=>m.id===from),candidates=this.members.filter(m=>m.id!==from&&m.alive&&m.inRound);
      const choice=sender.bot?((this.seed^Math.imul(sender.engine.pieces,31)^this.members.indexOf(sender))>>>0)%candidates.length:0;
      const to=candidates.find(m=>m.id===target)||candidates[choice];if(!to)return;
      const hole=((this.seed^Math.imul(this.round,97)^Math.imul(sender.engine.pieces,31)^this.members.indexOf(sender))>>>0)%10;
      to.engine.receiveGarbage(Math.min(20,lines),hole);
    }
    drain(m,now){for(const event of m.engine.drainEvents())if(event.kind==='lock'&&event.damage)this.garbage(m.id,event.damage,m.target);if(m.engine.status!=='playing'&&m.alive){m.alive=false;m.eliminatedAt=now;}}
    command(id,c,now){
      const m=this.humans.find(p=>p.id===id);if(!m)return false;m.lastSeen=now;
      if(c.kind==='PING')return true;
      if(c.kind==='EXIT'){
        m.forfeited=true;
        if(['countdown','playing'].includes(this.phase)&&m.alive){m.engine.finish('forfeit');this.drain(m,now);}
        else if(['lobby','results'].includes(this.phase)&&(Object.hasOwn(this.proposals,id)||this.ready.includes(id))){this.proposals={};this.stake=0;this.invalidate();}
        return true;
      }
      if(this.phase!=='playing'||!m.alive||c.round!==this.round||!Number.isSafeInteger(c.seq)||c.seq<1||c.seq>1000000)return false;
      if(c.seq<=m.ack)return true;if(c.seq!==m.ack+1)return false;
      if(c.kind==='target'){if(!this.members.some(p=>p.id===String(c.target)&&p.id!==id&&p.alive))return false;m.target=String(c.target);m.ack=c.seq;return true;}
      if(c.kind==='forfeit'){m.forfeited=true;m.engine.finish('forfeit');m.ack=c.seq;this.drain(m,now);return true;}
      if(c.kind==='softOn'||c.kind==='softOff'){m.soft=c.kind==='softOn';m.ack=c.seq;return true;}
      if(!['left','right','cw','ccw','hold','hard','soft'].includes(c.kind)||c.pieces!==m.engine.pieces)return false;
      if(c.kind==='hard'&&now-m.lastHard<80)return false;
      const accepted=ai.apply(m.engine,c.kind);if(!accepted)return false;
      m.ack=c.seq;m.lastInput=now;if(c.kind==='hard')m.lastHard=now;this.drain(m,now);return true;
    }
    advance(now,exclude=null){
      if(!['countdown','playing'].includes(this.phase))return;
      if(now<this.at)return;
      if(now-this.at>10000){this.phase='interrupted';this.abortReason='伺服器同步中斷，加碼銀幣退還';return;}
      while(this.at<now&&['countdown','playing'].includes(this.phase)){
        const next=Math.min(now,this.at+25),dt=next-Math.max(this.at,this.startAt);this.at=next;
        if(this.phase==='countdown'){if(next>=this.startAt)this.phase='playing';else continue;}
        for(const m of this.members){
          if(!m.alive||m.id===exclude)continue;
          m.engine.advance(dt,m.soft);this.drain(m,next);
          if(m.bot&&m.alive&&next>=m.nextAI){for(const kind of ai.plan(m.engine,m.level))ai.apply(m.engine,kind);this.drain(m,next);m.nextAI=next+ai.delay(m.level);}
          if(!m.bot&&m.alive&&next-m.lastSeen>25000){m.engine.finish('disconnected');this.drain(m,next);}
        }
        const competitors=this.members.filter(m=>m.inRound),alive=this.members.filter(m=>m.alive);
        if(next>=this.endAt||(this.humans.length===1&&!this.humans[0].alive)||(competitors.length>1&&alive.length<=1))this.finish();
      }
    }
    finish(){
      const values=m=>[m.forfeited?-1:m.alive?1:0,m.alive?m.engine.attack:m.eliminatedAt||0,m.engine.score,m.engine.lines];
      const sorted=this.members.filter(m=>m.inRound).sort((a,b)=>{const av=values(a),bv=values(b);for(let i=0;i<4;i++)if(av[i]!==bv[i])return bv[i]-av[i];return a.id.localeCompare(b.id);});let rank=1;
      this.results=sorted.map((m,i)=>{if(i&&JSON.stringify(values(m))!==JSON.stringify(values(sorted[i-1])))rank=i+1;return {id:m.id,rank,alive:m.alive,bot:m.bot,forfeited:!!m.forfeited,score:m.engine.score,lines:m.engine.lines,attack:m.engine.attack};});this.phase='results';this.ready=[];
    }
    client(id){const own=this.members.find(m=>m.id===id),{walletBalances,...state}=this.save();return {...state,ownBalance:walletBalances?.[id]??null,members:this.members.map(m=>({id:m.id,name:m.name,bot:m.bot,level:m.level,alive:m.alive,inRound:m.inRound,connected:m.connected,ack:m.ack,soft:m.id===id?m.soft:false,target:m.id===id?m.target:null,view:m.engine?.view()||null,engine:m.id===id?m.engine?.save()||null:null,eliminatedAt:m.eliminatedAt})),ownAck:own?.ack||0};}
  }
  function payouts(results,stake){
    const humans=results.filter(r=>!r.bot),valid=humans.filter(r=>!r.forfeited),pot=humans.length*stake,weights=humans.length===2?[100,0]:[70,20,10];const out=[];
    if(!valid.length)return [];
    const totalWeight=weights.slice(0,valid.length).reduce((a,b)=>a+b,0);
    for(let i=0;i<valid.length;){let end=i+1;while(end<valid.length&&valid[end].rank===valid[i].rank)end++;const share=weights.slice(i,end).reduce((a,b)=>a+b,0);for(const r of valid.slice(i,end))out.push({id:r.id,rank:r.rank,payout:Math.floor(pot*share/totalWeight/(end-i))});i=end;}
    let remainder=pot-out.reduce((a,b)=>a+b.payout,0);for(const r of out.filter(r=>r.rank<=3)){if(remainder<=0)break;r.payout++;remainder--;}
    // Only rounding cents remain; cycle over eligible positions deterministically.
    for(let i=0;remainder>0;i++,remainder--)out[i%out.length].payout++;
    for(const r of humans.filter(r=>r.forfeited))out.push({id:r.id,rank:r.rank,payout:0});
    return out;
  }
  return {Arena,payouts};
});
