/* Deterministic legal-move AI; never writes cells or invents scores. */
(function(root,factory){
  const rules=typeof module==='object'&&module.exports?require('./engine.js'):root.TetrisBattleEngine;
  const api=factory(rules);if(typeof module==='object'&&module.exports)module.exports=api;else root.TetrisBattleAI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(rules){
  'use strict';
  const delays=[1800,1450,1150,900,700,510,350,220,130];
  function evaluate(engine, before) {
    const heights=[],board=engine.board;let holes=0,covered=0,wells=0;
    for(let x=0;x<10;x++){let top=22;for(let y=0;y<22;y++){if(board[y][x])top=Math.min(top,y);else if(top<y){holes++;covered+=y-top;}}heights.push(22-top);}
    let bump=0;for(let x=1;x<10;x++)bump+=Math.abs(heights[x]-heights[x-1]);
    for(let x=0;x<10;x++)wells+=Math.max(0,Math.min(heights[x-1]??22,heights[x+1]??22)-heights[x]-1);
    return (engine.lines-before.lines)*9+(engine.attack-before.attack)*5-heights.reduce((a,b)=>a+b,0)*.48-holes*8-covered*.2-bump*.65-Math.max(...heights)*.8-wells*.25-(engine.status!=='playing'?10000:0);
  }
  function candidates(engine, allowHold=true) {
    // A look-ahead landing may top out and have no restorable active piece.
    if(!engine||engine.status!=='playing'||!engine.active)return [];
    const starts=[{engine,path:[]}];
    if(allowHold&&engine.canHold){const held=rules.Engine.restore(engine.save());if(held.swapHold()&&held.status==='playing')starts.push({engine:held,path:['hold']});}
    const out=[];
    for(const start of starts){
      const queue=[{piece:{...start.engine.active},path:start.path}],visited=new Set(),landings=new Set();
      // Horizontal moves and SRS rotations at the current height. Each chosen
      // landing is reached by actual Engine methods, including its wall kicks.
      for(let i=0;i<queue.length&&i<160;i++){
        const node=queue[i],key=[node.piece.x,node.piece.y,node.piece.rotation].join(':');if(visited.has(key))continue;visited.add(key);
        const probe=Object.create(rules.Engine.prototype);Object.assign(probe,start.engine,{active:{...node.piece},events:[]});
        const ghost=probe.ghost(),landing=[ghost.x,ghost.y,ghost.rotation].join(':');
        if(!landings.has(landing)){
          landings.add(landing);const result=rules.Engine.restore(start.engine.save());
          if(!result)continue;
          for(const move of node.path.slice(start.path.length))apply(result,move);
          result.hardDrop();out.push({path:[...node.path,'hard'],score:evaluate(result,engine),result});
        }
        for(const move of ['left','right','cw','ccw']){
          probe.active={...node.piece};probe.events=[];if(apply(probe,move))queue.push({piece:{...probe.active},path:[...node.path,move]});
        }
      }
    }
    return out.sort((a,b)=>b.score-a.score||a.path.length-b.path.length);
  }
  function apply(engine,kind){return kind==='left'?engine.move(-1):kind==='right'?engine.move(1):kind==='cw'?engine.rotate(1):kind==='ccw'?engine.rotate(-1):kind==='hold'?engine.swapHold():kind==='hard'?engine.hardDrop():engine.drop(true);}
  function plan(engine,level=5){
    if(!engine||engine.status!=='playing'||!engine.active)return [];
    level=Math.max(1,Math.min(9,Math.round(level)));const options=candidates(engine,level>=4);if(!options.length)return ['hard'];
    if(level>=7){for(const option of options.slice(0,level===9?4:2)){const next=candidates(option.result,false)[0];if(next)option.score+=next.score*.5;}options.sort((a,b)=>b.score-a.score);}
    // Low levels choose a less promising legal placement at a deterministic
    // frequency. Board/queue RNG is untouched, preserving the common bag.
    const noise=((Math.imul(engine.seed,31)^Math.imul(engine.pieces+1,2654435761))>>>0)/4294967296;
    const mistake=noise<(9-level)*.065;
    return options[mistake?Math.min(options.length-1,1+Math.floor(noise*12)+(9-level)):0].path;
  }
  return {plan,apply,delay:level=>delays[Math.max(0,Math.min(8,Math.round(level)-1))],evaluate};
});
