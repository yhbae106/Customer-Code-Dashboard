/* Cache the available values used by the existing cascading-filter controls. */
(()=>{
 'use strict';
 let lastRows,lastRelations,lastQuery,lastOptions;
 getAvailableValues=function(filter,selections,query,fieldQueries=currentFieldQueries()){
  const key=JSON.stringify([query,selections,fieldQueries]);
  if(R===lastRows&&relByBiz===lastRelations&&key===lastQuery)return lastOptions[filter.id];
  const active=FILTERS.filter(item=>selections[item.id]);
  const hasFieldQuery=Object.values(fieldQueries).some(Boolean);
  const values=Object.fromEntries(FILTERS.map(item=>[item.id,new Set()]));
  for(let i=0;i<R.length;i++){
   const row=R[i];
   if(query&&!searchIndex[i].includes(query))continue;
   if(hasFieldQuery&&!rowMatchesFieldQueries(row,fieldQueries))continue;
   let missing;
   for(const item of active){
    if(includesToken(val(row,item.key),selections[item.id]))continue;
    if(missing){missing=false;break;}
    missing=item;
   }
   if(missing===false)continue;
   if(missing)values[missing.id].add(val(row,missing.key));
   else for(const item of FILTERS)values[item.id].add(val(row,item.key));
  }
  for(const item of FILTERS){
   const tokens=new Set();
   for(const value of values[item.id])for(const token of splitMulti(value))tokens.add(token);
   values[item.id]=[...tokens].sort(collator.compare);
  }
  lastRows=R;lastRelations=relByBiz;lastQuery=key;lastOptions=values;
  return values[filter.id];
 };
})();
