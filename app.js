const $=s=>document.querySelector(s);
let H=[],R=[],I={},meta={},filtered=[];
const DB_NAME='CustomerCodeDashboardDB';
const DB_VERSION=1;
const STORE='master';
const STORE_KEY='current';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n||0).toLocaleString('ko-KR');
const clean=v=>v==null?'':String(v).trim();
const key=v=>clean(v);
const val=(r,k)=>r[I[k]]??'';
const uniq=a=>[...new Set(a.filter(v=>clean(v)!=='') )];

function setStatus(text,state=''){
  const el=$('.status');
  el.className='status '+state;
  $('#loadStatus').textContent=text;
}

function fillSelect(el,items,labeler=v=>v){
  const first=el.options[0]?.outerHTML||'<option value="">전체</option>';
  el.innerHTML=first;
  items.filter(Boolean).forEach(v=>{
    const o=document.createElement('option');
    o.value=v;
    o.textContent=labeler(v);
    el.appendChild(o);
  });
}

function serialToDate(v){
  if(v instanceof Date)return v.toISOString().slice(0,10);
  if(typeof v==='number'&&window.XLSX?.SSF){
    const d=XLSX.SSF.parse_date_code(v);
    if(d)return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  return clean(v);
}

function normalizeCell(v,header){
  if(v==null)return '';
  if(header==='유효시작일'||header==='생성일')return serialToDate(v);
  return clean(v);
}

function modeFor(channel,guide){
  const explicit=clean(guide?.['온/오프라인']);
  if(explicit)return explicit;
  if(String(channel||'').startsWith('DW'))return '오프라인';
  return '기타';
}

function typeFor(guide){
  return clean(guide?.['유형'])||'기타';
}

function openDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE);
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}

async function saveMaster(name,arrayBuffer){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put({
      name,
      data:arrayBuffer,
      savedAt:new Date().toISOString()
    },STORE_KEY);
    tx.oncomplete=()=>{db.close();resolve();};
    tx.onerror=()=>{db.close();reject(tx.error);};
  });
}

async function getMaster(){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readonly');
    const req=tx.objectStore(STORE).get(STORE_KEY);
    req.onsuccess=()=>{db.close();resolve(req.result||null);};
    req.onerror=()=>{db.close();reject(req.error);};
  });
}

async function deleteMaster(){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).delete(STORE_KEY);
    tx.oncomplete=()=>{db.close();resolve();};
    tx.onerror=()=>{db.close();reject(tx.error);};
  });
}

function parseWorkbook(arrayBuffer,fileName){
  if(!window.XLSX)throw new Error('엑셀 처리 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.');

  const wb=XLSX.read(arrayBuffer,{type:'array',cellDates:true});
  if(!wb.SheetNames.includes('Data'))throw new Error('Data 시트를 찾을 수 없습니다.');
  if(!wb.SheetNames.includes('조견표'))throw new Error('조견표 시트를 찾을 수 없습니다.');

  const data=XLSX.utils.sheet_to_json(wb.Sheets['Data'],{header:1,defval:'',raw:true});
  const guideRows=XLSX.utils.sheet_to_json(wb.Sheets['조견표'],{defval:'',raw:true});
  if(data.length<2)throw new Error('Data 시트에 조회할 데이터가 없습니다.');

  const baseHeaders=data[0].map(clean);
  const required=['사업자번호','판매처','판매처명','채널','채널명','사원명','주소','상세주소','대표자명'];
  const missing=required.filter(x=>!baseHeaders.includes(x));
  if(missing.length)throw new Error(`필수 컬럼이 없습니다: ${missing.join(', ')}`);

  const lookup={};
  guideRows.forEach(g=>{
    const ch=key(g['채널']);
    if(ch){
      lookup[ch]={
        '채널명':clean(g['채널명']),
        '유형':clean(g['유형']),
        '온/오프라인':clean(g['온/오프라인']),
        '비고':clean(g['비고'])
      };
    }
  });

  H=[...baseHeaders,'유형','영업방식','통합주소'];
  I=Object.fromEntries(H.map((h,i)=>[h,i]));
  const idx=Object.fromEntries(baseHeaders.map((h,i)=>[h,i]));

  R=data.slice(1).filter(row=>row.some(v=>clean(v)!=='')).map(row=>{
    const base=baseHeaders.map((h,i)=>normalizeCell(row[i],h));
    const ch=clean(row[idx['채널']]);
    const g=lookup[ch]||{};
    const address=[clean(row[idx['주소']]),clean(row[idx['상세주소']])].filter(Boolean).join(' ');
    return [...base,typeFor(g),modeFor(ch,g),address];
  });

  const typeCounts={},modeCounts={};
  R.forEach(r=>{
    const t=val(r,'유형'),m=val(r,'영업방식');
    typeCounts[t]=(typeCounts[t]||0)+1;
    modeCounts[m]=(modeCounts[m]||0)+1;
  });

  meta={
    source_file:fileName,
    record_count:R.length,
    unique_sales:new Set(R.map(r=>key(val(r,'판매처'))).filter(Boolean)).size,
    unique_business_numbers:new Set(R.map(r=>key(val(r,'사업자번호'))).filter(Boolean)).size,
    type_counts:typeCounts,
    mode_counts:modeCounts,
    lookup,
    derived_rule:'조견표 유형/온라인 지정값을 우선 적용하고, 온라인 지정이 없는 DW 채널은 오프라인으로 분류'
  };
}

function renderKpis(){
  const t=meta.type_counts||{},m=meta.mode_counts||{};
  const cards=[
    ['전체 레코드',meta.record_count,'원본 행 기준','accent'],
    ['판매처 코드',meta.unique_sales,'고유 판매처',''],
    ['사업자번호',meta.unique_business_numbers,'고유 사업자',''],
    ['간납',t['간납']||0,'조견표 유형',''],
    ['종합도매',t['종합']||0,'조견표 유형',''],
    ['온라인',m['온라인']||0,'조견표 기준','']
  ];
  $('#kpis').innerHTML=cards.map(c=>`<div class="kpi ${c[3]}"><div class="label">${c[0]}</div><div class="value">${fmt(c[1])}</div><div class="hint">${c[2]}</div></div>`).join('');
}

function renderGuide(){
  const items=Object.entries(meta.lookup||{});
  $('#guide').innerHTML=items.map(([ch,x])=>`
    <div class="guide-card">
      <div class="g1"><strong>${esc(ch)} · ${esc(x['채널명'])}</strong><span class="badge">${esc(x['유형']||'기타')}</span></div>
      <div class="g2">${esc(x['온/오프라인']||modeFor(ch,x))}</div>
      <div class="g3">${esc(x['비고']||'비고 없음')}</div>
    </div>
  `).join('');
}

function rowText(r){
  return ['사업자번호','판매처','판매처명','실납처','실납처명','채널','채널명','사원명','대표자명','사무소명','통합주소','CSO업체명','위탁재고관리처명']
    .map(k=>val(r,k)).join(' ').toLowerCase();
}

function apply(){
  if(!R.length)return;

  const q=$('#q').value.trim().toLowerCase();
  const type=$('#typeFilter').value;
  const mode=$('#modeFilter').value;
  const ch=$('#channelFilter').value;
  const office=$('#officeFilter').value;
  const staff=$('#staffFilter').value;

  let total=0,out=[];
  for(const r of R){
    if(type&&val(r,'유형')!==type)continue;
    if(mode&&val(r,'영업방식')!==mode)continue;
    if(ch&&val(r,'채널')!==ch)continue;
    if(office&&val(r,'사무소명')!==office)continue;
    if(staff&&val(r,'사원명')!==staff)continue;
    if(q&&!rowText(r).includes(q))continue;
    total++;
    if(out.length<300)out.push(r);
  }

  filtered=out;
  $('#resultCount').textContent=`${fmt(total)}건${total>300?' · 300건 표시':''}`;
  renderRows();
}

function renderRows(){
  const tb=$('#rows');

  if(!filtered.length){
    tb.innerHTML='<tr><td colspan="6" style="text-align:center;padding:44px;color:#8a95a6">조회 결과가 없습니다.</td></tr>';
    return;
  }

  tb.innerHTML=filtered.map((r,n)=>`
    <tr data-i="${n}">
      <td><div class="name">${esc(val(r,'판매처명'))}</div><div class="code">${esc(val(r,'판매처'))} · 사업자 ${esc(val(r,'사업자번호'))}</div></td>
      <td><strong>${esc(val(r,'채널'))}</strong><div class="code">${esc(val(r,'채널명'))}</div></td>
      <td><span class="badge">${esc(val(r,'유형'))}</span></td>
      <td><span class="badge ${val(r,'영업방식')==='온라인'?'online':val(r,'영업방식')==='오프라인'?'offline':''}">${esc(val(r,'영업방식'))}</span></td>
      <td>${esc(val(r,'사원명'))}<div class="code">${esc(val(r,'사무소명'))}</div></td>
      <td class="addr">${esc(val(r,'통합주소'))}</td>
    </tr>
  `).join('');

  tb.querySelectorAll('tr[data-i]').forEach(tr=>tr.onclick=()=>showDetail(filtered[+tr.dataset.i]));
}

function info(k,v,wide=false){
  return `<div class="info ${wide?'wide':''}"><div class="k">${esc(k)}</div><div class="v">${esc(v||'-')}</div></div>`;
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
      <div class="channel">${esc(val(r,'채널'))} · ${esc(val(r,'채널명'))}</div>
      <h2>${esc(val(r,'판매처명'))}</h2>
      <div class="meta">${esc(val(r,'판매처'))} · ${esc(val(r,'사원명'))} · ${esc(val(r,'영업방식'))}</div>
    </div>
    <div class="detail-body">
      ${groups.map(([t,ks])=>`
        <div class="section-title">${t}</div>
        <div class="info-grid">${ks.map(k=>info(k,val(r,k),k==='통합주소'||k==='비고')).join('')}</div>
      `).join('')}
    </div>
  `;
}

function enableControls(enabled){
  ['q','clearBtn','typeFilter','modeFilter','channelFilter','officeFilter','staffFilter','resetFilters']
    .forEach(id=>$('#'+id).disabled=!enabled);
}

function setupFilters(){
  fillSelect($('#typeFilter'),uniq(R.map(r=>val(r,'유형'))).sort());
  fillSelect($('#modeFilter'),uniq(R.map(r=>val(r,'영업방식'))).sort());
  fillSelect($('#channelFilter'),uniq(R.map(r=>val(r,'채널'))).sort(),v=>`${v} · ${meta.lookup?.[v]?.['채널명']||''}`);
  fillSelect($('#officeFilter'),uniq(R.map(r=>val(r,'사무소명'))).sort());
  fillSelect($('#staffFilter'),uniq(R.map(r=>val(r,'사원명'))).sort());
}

function finishLoad(fileName,storedAt){
  renderKpis();
  renderGuide();
  $('#ruleNote').textContent=meta.derived_rule;
  $('#sourceName').textContent=meta.source_file;
  $('#fileName').textContent=fileName;
  $('#dataGuide').textContent=storedAt
    ? `브라우저 기본 데이터 · 저장일 ${new Date(storedAt).toLocaleString('ko-KR')}`
    : '현재 브라우저에 기본 데이터로 저장됨';
  setupFilters();
  enableControls(true);
  setStatus(`${fmt(R.length)}건 자동 조회 가능`,'ready');
  apply();
}

async function importFile(file){
  try{
    setStatus('엑셀 분석 중','loading');
    enableControls(false);
    $('#fileName').textContent=file.name;

    const buf=await file.arrayBuffer();
    parseWorkbook(buf,file.name);

    setStatus('기본 데이터 저장 중','loading');
    await saveMaster(file.name,buf.slice(0));

    finishLoad(file.name,new Date().toISOString());
  }catch(e){
    console.error(e);
    setStatus('데이터 등록 실패','error');
    alert(e.message);
  }
}

async function loadStoredMaster(){
  try{
    setStatus('기본 데이터 확인 중','loading');
    const stored=await getMaster();

    if(!stored?.data){
      setStatus('기본 데이터 최초 등록 필요');
      $('#rows').innerHTML='<tr><td colspan="6" style="text-align:center;padding:44px;color:#8a95a6">처음 한 번만 “데이터 등록/교체”에서 엑셀을 선택하세요. 이후에는 자동으로 불러옵니다.</td></tr>';
      $('#dataGuide').textContent='최초 1회 엑셀을 등록하면 이 브라우저에 저장되어 다음 접속부터 자동으로 불러옵니다.';
      return;
    }

    setStatus('저장된 기본 데이터 분석 중','loading');
    parseWorkbook(stored.data,stored.name||'저장된 기본 데이터');
    finishLoad(stored.name||'저장된 기본 데이터',stored.savedAt);
  }catch(e){
    console.error(e);
    setStatus('기본 데이터 로드 실패','error');
    $('#dataGuide').textContent='저장된 데이터를 불러오지 못했습니다. 데이터 등록/교체에서 엑셀을 다시 선택하세요.';
  }
}

let timer;
$('#fileInput').addEventListener('change',e=>{
  const f=e.target.files?.[0];
  if(f)importFile(f);
});

$('#q').addEventListener('input',()=>{
  clearTimeout(timer);
  timer=setTimeout(apply,180);
});

['typeFilter','modeFilter','channelFilter','officeFilter','staffFilter']
  .forEach(id=>$('#'+id).addEventListener('change',apply));

$('#clearBtn').onclick=()=>{
  $('#q').value='';
  apply();
};

$('#resetFilters').onclick=()=>{
  ['typeFilter','modeFilter','channelFilter','officeFilter','staffFilter'].forEach(id=>$('#'+id).value='');
  $('#q').value='';
  apply();
};

$('#clearStored').onclick=async()=>{
  if(!confirm('이 브라우저에 저장된 기본 데이터를 삭제하시겠습니까?'))return;
  try{
    await deleteMaster();
    location.reload();
  }catch(e){
    console.error(e);
    alert('저장 데이터 삭제에 실패했습니다.');
  }
};

loadStoredMaster();
