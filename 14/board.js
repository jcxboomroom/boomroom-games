(function(root){
  function buildHuntBoard(mode,seed,shapes,colors){
    let value=seed>>>0;
    const random=()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;};
    const targetIndex=Math.floor(random()*12),tiles=[];
    if(mode==='color'){
      const target=Math.floor(random()*colors.length),others=colors.filter((_,i)=>i!==target);
      for(let i=0;i<12;i++){
        const color=i===targetIndex?colors[target]:others[Math.floor(random()*others.length)];
        tiles.push({name:color.name+'色',symbol:'●',color:color.hex});
      }
      return {targetIndex,tiles,title:'找同色：'+colors[target].name+'色',symbol:'●',color:colors[target].hex};
    }
    if(mode==='number'){
      const used=new Set();
      while(tiles.length<12){const number=10+Math.floor(random()*90);if(used.has(number))continue;used.add(number);tiles.push({name:'數字 '+number,symbol:String(number)});}
      return {targetIndex,tiles,title:'找數字：'+tiles[targetIndex].symbol,symbol:tiles[targetIndex].symbol};
    }
    const shuffled=[...shapes];
    for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
    return {targetIndex,tiles:shuffled.slice(0,12),title:'找同形：'+shuffled[targetIndex].symbol+' '+shuffled[targetIndex].name,symbol:shuffled[targetIndex].symbol};
  }
  if(typeof module!=='undefined')module.exports={buildHuntBoard};
  else root.buildHuntBoard=buildHuntBoard;
})(typeof window==='undefined'?null:window);
