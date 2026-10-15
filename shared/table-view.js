(function(){
 'use strict';
 window.BoomRoomOfficialTables={
  own(session,id){return session.engineState?.tables?.find(t=>t.roster.includes(String(id))&&t.state);},
  view(session,id){const root=session.engineState;if(!root?.tournament)return session;const table=this.own(session,id)||root.tables.find(t=>t.state);return table?{...session,engineState:{...table.state,tableId:table.id,tableEpoch:root.tournament.roundNo}}:null;},
  canPlay(session,id){const root=session.engineState;if(!root?.tournament)return true;const table=this.own(session,id);return !!table&&!table.finished&&table.state.members.some(p=>String(p.id)===String(id)&&p.alive!==false);}
 };
})();
