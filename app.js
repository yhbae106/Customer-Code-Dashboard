const $=s=>document.querySelector(s);
let H=[],R=[],I={},meta={},filtered=[],searchIndex=[];
let sortState={key:null,dir:null};
let renderedCount=0;
const RENDER_CHUNK=500;
const SEP=' | ';

const FILTERS=[
  {id:'typeFilter',key:'유형',label:'유형 전체'},
  {id:'modeFilter',key:'영업방식',label:'온라인/오프라인 전체'},
  {id:'channelFilter',key:'채널',label:'채널 전체'},
  {id:'officeFilter',key:'사무소명',label:'사무소 전체'},
  {id:'staffFilter',key:'사원명',label:'영업담당 전체'}
];

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n||0).toLocaleString('ko-KR');
const clean=v=>v==null?'':String(v).trim();
const val=(r,k)=>r[I[k]]??'';
const collator=new Intl.Collator('ko-KR',{numeric:true,sensitivity:'base'});

function splitMulti(v){
  const s=clean(v);
  if(!s)return [];
  return s.split(/\s+\|\s+/).map(x=>x.trim()).filter(Boolean);
}
function joinUnique(values){
  return [...new Set(values.filter(Boolean))].join(SEP);
}
function includesToken(v,target){
  return splitMulti(v).includes(target);
}
function setStatus(text,state=''){
  const el=$('.status');
  el.className='status '+state;
  $('#loadStatus').textContent=text;
}
function enableControls(enabled){
  ['q','clearBtn','typeFilter','modeFilter','channelFilter','officeFilter','staffFilter','resetFilters']
    .forEach(id=>$('#'+id).disabled=!enabled);
}
function b64ToBytes(s){
  const bin=atob(s.trim());
  const out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
  return out;
}
function concatBytes(parts){
  const total=parts.reduce((n,p)=>n+p.length,0);
  const out=new Uint8Array(total);
  let offset=0;
  for(const p of parts){out.set(p,offset);offset+=p.length;}
  return out;
}
async function gunzip(bytes){
  if('DecompressionStream' in window){
    const ds=new DecompressionStream('gzip');
    return await new Response(new Blob([bytes]).stream().pipeThrough(ds)).text();
  }
  if(window.pako){
    return new TextDecoder('utf-8').decode(window.pako.ungzip(bytes));
  }
  throw new Error('이 브라우저에서 압축 DB를 해제할 수 없습니다.');
}
function guideMaps(guide){
  const lookup={};
  for(const g of guide||[]){
    const ch=clean(g['채널']);
    if(!ch)continue;
    lookup[ch]={
      '채널명':clean(g['채널명']),
      '유형':clean(g['유형']),
      '온/오프라인':clean(g['온/오프라인']),
      '비고':clean(g['비고'])
    };
  }
  return lookup;
}
function modeForChannel(ch,lookup){
  const explicit=clean(lookup[ch]?.['온/오프라인']);
  if(explicit)return explicit;
  if(ch.startsWith('DW'))return '오프라인';
  return '기타';
}
function typeForChannel(ch,lookup){
  return clean(lookup[ch]?.['유형'])||'기타';
}
function parseCsvRows(text){
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){
      if(c==='"'){
        if(text[i+1]==='"'){field+='"';i++;}
        else quoted=false;
      }else field+=c;
    }else if(c==='"')quoted=true;
    else if(c===','){row.push(field);field='';}
    else if(c==='\n'){row.push(field);rows.push(row);row=[];field='';}
    else if(c!=='\r')field+=c;
  }
  if(field.length||row.length){row.push(field);rows.push(row);}
  return rows;
}
function parseEmbeddedCsv(csvText,manifest){
  const data=parseCsvRows(csvText);
  if(data.length<2)throw new Error('기본 DB에 조회할 데이터가 없습니다.');

  const baseHeaders=data[0].map(clean);
  const required=['사업자번호','판매처','판매처명','채널','채널명','사원명','주소','상세주소','대표자명'];
  const missing=required.filter(x=>!baseHeaders.includes(x));
  if(missing.length)throw new Error('기본 DB 필수 컬럼 누락: '+missing.join(', '));

  const lookup=guideMaps(manifest.guide);
  H=[...baseHeaders,'유형','영업방식','통합주소'];
  I=Object.fromEntries(H.map((h,i)=>[h,i]));
  const idx=Object.fromEntries(baseHeaders.map((h,i)=>[h,i]));

  R=data.slice(1).filter(row=>row.some(v=>clean(v)!=='')).map(row=>{
    const base=baseHeaders.map((h,i)=>clean(row[i]));
    const channels=splitMulti(base[idx['채널']]);
    const types=joinUnique(channels.map(ch=>typeForChannel(ch,lookup)));
    const modes=joinUnique(channels.map(ch=>modeForChannel(ch,lookup)));
    const address=[clean(base[idx['주소']]),clean(base[idx['상세주소']])].filter(Boolean).join(' ');
    return [...base,types||'기타',modes||'기타',address];
  });

  searchIndex=R.map(r=>
    ['사업자번호','판매처','판매처명','실납처','실납처명','채널','채널명','사원명','영업담당','대표자명','사무소명','통합주소','CSO업체명','위탁재고관리처명']
      .map(k=>val(r,k)).join(' ').toLowerCase()
  );

  meta={
    source_file:manifest.source_file||'261104 코드.xlsx',
    original_record_count:Number(manifest.original_record_count||205507),
    business_count:R.length,
    lookup,
    guide:manifest.guide||[],
    derived_rule:'조견표 유형/온라인 지정값을 우선 적용하고, 온라인 지정이 없는 DW 채널은 오프라인으로 분류'
  };
}
async function fetchEmbeddedDb(){
  setStatus('기본 DB 정보 확인 중','loading');
  const manifestRes=await fetch('data/manifest.json?v=3',{cache:'no-store'});
  if(!manifestRes.ok)throw new Error('기본 DB 매니페스트를 불러오지 못했습니다.');
  const manifest=await manifestRes.json();

  const chunks=[];
  const paths=manifest.chunks||[];
  const batchSize=6;
  for(let start=0;start<paths.length;start+=batchSize){
    const batch=paths.slice(start,start+batchSize);
    const results=await Promise.all(batch.map(async path=>{
      const res=await fetch(path+'?v=3',{cache:'force-cache'});
      if(!res.ok)throw new Error('기본 DB 조각 로드 실패: '+path);
      return b64ToBytes(await res.text());
    }));
    chunks.push(...results);
    setStatus(`기본 DB 로드 중 ${Math.min(start+batch.length,paths.length)}/${paths.length}`,'loading');
  }

  setStatus('기본 DB 압축 해제 중','loading');
  const csvText=await gunzip(concatBytes(chunks));
  setStatus('기본 DB 인덱스 생성 중','loading');
  parseEmbeddedCsv(csvText,manifest);
}
function renderGuide(){
  const items=Object.entries(meta.lookup||{});
  $('#guide').innerHTML=items.map(([ch,x])=>`
    <div class="guide-card">
      <div class="g1"><strong>${esc(ch)} · ${esc(x['채널명'])}</strong><span class="badge">${esc(x['유형']||'기타')}</span></div>
      <div class="g2">${esc(x['온/오프라인']||modeForChannel(ch,meta.lookup))}</div>
      <div class="g3">${esc(x['비고']||'비고 없음')}</div>
    </div>
  `).join('');
}
function uniqueTokenCount(rows,keyName,predicate=()=>true){
  const set=new Set();
  for(const r of rows){
    if(!predicate(r))continue;
    for(const x of splitMulti(val(r,keyName)))set.add(x);
  }
  return set.size;
}
function businessCount(rows,predicate=()=>true){
  let n=0;
  for(const r of rows)if(predicate(r))n++;
  return n;
}
function renderKpis(rows=R){
  const cards=[
    ['전체 레코드',meta.original_record_count,'원본 행 기준','accent'],
    ['판매처 코드',uniqueTokenCount(rows,'판매처'),'현재 조건 · 고유 판매처',''],
    ['사업자번호',rows.length,'현재 조건 · 고유 사업자',''],
    ['간납',businessCount(rows,r=>includesToken(val(r,'유형'),'간납')),'고유 사업자 기준',''],
    ['종합도매',businessCount(rows,r=>includesToken(val(r,'유형'),'종합')),'고유 사업자 기준',''],
    ['온라인',businessCount(rows,r=>includesToken(val(r,'영업방식'),'온라인')),'고유 사업자 기준','']
  ];
  $('#kpis').innerHTML=cards.map(c=>`
    <div class="kpi ${c[3]}">
      <div class="label">${c[0]}</div>
      <div class="value">${fmt(c[1])}</div>
      <div class="hint">${c[2]}</div>
    </div>
  `).join('');
}
function currentSelections(){
  return Object.fromEntries(FILTERS.map(f=>[f.id,$('#'+f.id).value]));
}
function rowHasFilterValue(r,key,target){
  return includesToken(val(r,key),target);
}
function matchesRow(r,index,selections,excludeId=null,query=''){
  if(query && !searchIndex[index].includes(query))return false;
  for(const f of FILTERS){
    if(f.id===excludeId)continue;
    const selected=selections[f.id];
    if(selected && !rowHasFilterValue(r,f.key,selected))return false;
  }
  return true;
}
function getAvailableValues(filter,selections,query){
  const set=new Set();
  for(let i=0;i<R.length;i++){
    if(!matchesRow(R[i],i,selections,filter.id,query))continue;
    for(const v of splitMulti(val(R[i],filter.key)))set.add(v);
  }
  return [...set].sort(collator.compare);
}
function refreshCascadingFilters(query){
  let selections=currentSelections();
  let changed=true,guard=0;
  while(changed&&guard<6){
    changed=false;guard++;
    for(const f of FILTERS){
      const allowed=getAvailableValues(f,selections,query);
      const current=selections[f.id];
      if(current&&!allowed.includes(current)){
        selections[f.id]='';
        $('#'+f.id).value='';
        changed=true;
      }
    }
  }
  for(const f of FILTERS){
    const el=$('#'+f.id);
    const current=selections[f.id];
    const allowed=getAvailableValues(f,selections,query);
    el.innerHTML=`<option value="">${f.label}</option>`;
    for(const v of allowed){
      const o=document.createElement('option');
      o.value=v;
      o.textContent=f.id==='channelFilter' ? `${v} · ${meta.lookup?.[v]?.['채널명']||''}` : v;
      el.appendChild(o);
    }
    if(current&&allowed.includes(current))el.value=current;
  }
}
function setupFilters(){
  const empty=Object.fromEntries(FILTERS.map(f=>[f.id,'']));
  for(const f of FILTERS){
    const el=$('#'+f.id);
    const values=getAvailableValues(f,empty,'');
    el.innerHTML=`<option value="">${f.label}</option>`;
    for(const v of values){
      const o=document.createElement('option');
      o.value=v;
      o.textContent=f.id==='channelFilter' ? `${v} · ${meta.lookup?.[v]?.['채널명']||''}` : v;
      el.appendChild(o);
    }
  }
}
function updateSortMarks(){
  document.querySelectorAll('th.sortable').forEach(th=>{
    const mark=th.querySelector('.sort-mark');
    if(th.dataset.sort!==sortState.key){
      th.classList.remove('sorted'); mark.textContent='↕';
    }else{
      th.classList.add('sorted'); mark.textContent=sortState.dir==='asc'?'▲':'▼';
    }
  });
}
function sortFiltered(){
  if(!sortState.key||!sortState.dir)return;
  const dir=sortState.dir==='asc'?1:-1;
  const k=sortState.key;
  filtered.sort((a,b)=>collator.compare(clean(val(a,k)),clean(val(b,k)))*dir);
}
function apply(){
  if(!R.length)return;
  const query=$('#q').value.trim().toLowerCase();
  refreshCascadingFilters(query);
  const selections=currentSelections();
  const out=[];
  for(let i=0;i<R.length;i++)if(matchesRow(R[i],i,selections,null,query))out.push(R[i]);
  filtered=out;
  sortFiltered();
  renderKpis(filtered);
  $('#resultCount').textContent=`${fmt(filtered.length)}개 사업자`;
  renderedCount=0;
  $('#rows').innerHTML='';
  $('#tableWrap').scrollTop=0;
  renderNextChunk();
  updateSortMarks();
}
function multiDisplay(v){
  const arr=splitMulti(v);
  return arr.length>1 ? arr.slice(0,3).map(esc).join('<br>')+(arr.length>3?`<div class="more">외 ${arr.length-3}개</div>`:'') : esc(v);
}
function rowHtml(r,n){
  const saleNames=splitMulti(val(r,'판매처명'));
  const saleCodes=splitMulti(val(r,'판매처'));
  return `
    <tr data-i="${n}">
      <td><div class="name">${saleNames.slice(0,2).map(esc).join('<br>')||'-'}</div><div class="code">${saleCodes.slice(0,3).map(esc).join(' · ')} · 사업자 ${esc(val(r,'사업자번호'))}</div></td>
      <td><strong>${multiDisplay(val(r,'채널'))}</strong><div class="code">${multiDisplay(val(r,'채널명'))}</div></td>
      <td>${splitMulti(val(r,'유형')).map(x=>`<span class="badge">${esc(x)}</span>`).join(' ')}</td>
      <td>${splitMulti(val(r,'영업방식')).map(x=>`<span class="badge ${x==='온라인'?'online':x==='오프라인'?'offline':''}">${esc(x)}</span>`).join(' ')}</td>
      <td>${multiDisplay(val(r,'사원명'))}<div class="code">${multiDisplay(val(r,'사무소명'))}</div></td>
      <td class="addr">${multiDisplay(val(r,'통합주소'))}</td>
    </tr>
  `;
}
function renderNextChunk(){
  const tb=$('#rows');
  if(!filtered.length){
    tb.innerHTML='<tr><td colspan="6" class="loading-cell">조회 결과가 없습니다.</td></tr>';
    return;
  }
  if(renderedCount>=filtered.length)return;
  const end=Math.min(renderedCount+RENDER_CHUNK,filtered.length);
  let html='';
  for(let i=renderedCount;i<end;i++)html+=rowHtml(filtered[i],i);
  tb.insertAdjacentHTML('beforeend',html);
  for(let i=renderedCount;i<end;i++){
    const tr=tb.querySelector(`tr[data-i="${i}"]`);
    if(tr)tr.onclick=()=>showDetail(filtered[i]);
  }
  renderedCount=end;
}
function info(k,v,wide=false){
  const parts=splitMulti(v);
  const display=parts.length>1 ? parts.map(x=>`<div class="detail-item">${esc(x)}</div>`).join('') : esc(v||'-');
  return `<div class="info ${wide?'wide':''}"><div class="k">${esc(k)}</div><div class="v">${display}</div></div>`;
}
function showDetail(r){
  const groups=[
    ['기본 정보',['사업자번호','판매처','판매처명','실납처','실납처명','대표자명']],
    ['채널 / 영업',['채널','채널명','유형','영업방식','사무소명','영업담당','사원명']],
    ['주소',['주소','상세주소','통합주소']],
    ['관리 정보',['위탁재고관리처','위탁재고관리처명','CSO업체','CSO업체명','가격그룹','기준회전일','약정회전일','예외회전일','수금할인 그룹','유효시작일']],
    ['기타',['비고','생성자','생성일']]
  ];
  $('#detailPanel').innerHTML=`
    <div class="detail-head">
      <div class="channel">${esc(val(r,'사업자번호'))}</div>
      <h2>${esc(splitMulti(val(r,'판매처명'))[0]||'사업자 상세')}</h2>
      <div class="meta">${fmt(splitMulti(val(r,'판매처')).length)}개 판매처 · ${fmt(splitMulti(val(r,'채널')).length)}개 채널</div>
    </div>
    <div class="detail-body">
      ${groups.map(([t,ks])=>`
        <div class="section-title">${t}</div>
        <div class="info-grid">${ks.map(k=>info(k,val(r,k),k==='통합주소'||k==='비고'||splitMulti(val(r,k)).length>2)).join('')}</div>
      `).join('')}
    </div>
  `;
}
async function init(){
  try{
    enableControls(false);
    await fetchEmbeddedDb();
    $('#rawCount').textContent=fmt(meta.original_record_count);
    $('#bizCount').textContent=fmt(meta.business_count);
    $('#sourceFile').textContent=meta.source_file;
    $('#sourceName').textContent=meta.source_file;
    $('#dataGuide').textContent=`기본 DB 연결 완료 · ${fmt(meta.business_count)}개 사업자 자동 조회`;
    $('#ruleNote').textContent=meta.derived_rule;
    renderGuide();
    setupFilters();
    enableControls(true);
    setStatus(`${fmt(meta.business_count)}개 사업자 DB 연결 완료`,'ready');
    apply();
  }catch(e){
    console.error(e);
    setStatus('기본 DB 연결 실패','error');
    $('#dataGuide').textContent='기본 DB를 불러오지 못했습니다. 새로고침 후 다시 확인해 주세요.';
    $('#rows').innerHTML=`<tr><td colspan="6" class="loading-cell">기본 DB 연결 실패<br><small>${esc(e.message)}</small></td></tr>`;
  }
}

let timer;
$('#q').addEventListener('input',()=>{
  clearTimeout(timer); timer=setTimeout(apply,180);
});
FILTERS.forEach(f=>$('#'+f.id).addEventListener('change',apply));
$('#clearBtn').onclick=()=>{$('#q').value='';apply();};
$('#resetFilters').onclick=()=>{
  FILTERS.forEach(f=>$('#'+f.id).value='');
  $('#q').value='';
  sortState={key:null,dir:null};
  apply();
};
document.querySelectorAll('th.sortable').forEach(th=>{
  th.addEventListener('click',()=>{
    const k=th.dataset.sort;
    if(sortState.key!==k)sortState={key:k,dir:'asc'};
    else if(sortState.dir==='asc')sortState={key:k,dir:'desc'};
    else sortState={key:null,dir:null};
    apply();
  });
});
$('#tableWrap').addEventListener('scroll',e=>{
  const el=e.currentTarget;
  if(el.scrollTop+el.clientHeight>=el.scrollHeight-300)renderNextChunk();
});

init();
