(()=>{
  'use strict';
  const $p=id=>document.getElementById(id);
  const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  const norm=v=>String(v??'').trim().toLocaleLowerCase('ko-KR');
  const collate=new Intl.Collator('ko-KR',{numeric:true,sensitivity:'base'});
  let catalog=null, limit=60;
  const status=$p('catalogStatus');
  const bitCount=mask=>{let n=0;while(mask){n+=mask&1;mask>>>=1;}return n;};
  function channelList(mask){
    return catalog.channels.filter((_,i)=>(mask & (1<<i))!==0);
  }
  function productChannelsHtml(mask){
    const channels=channelList(mask);
    return channels.map(([id,name])=>`<span class="catalog-channel-pill" title="${escapeHtml(name)}">${escapeHtml(id)} · ${escapeHtml(name)}</span>`).join('');
  }
  function render(){
    if(!catalog)return;
    const channelQuery=norm($p('catalogChannel').value);
    const productQuery=norm($p('catalogProduct').value);
    let matchesChannel=catalog.channels.map((c,i)=>[...c,i]).filter(([id,name])=>norm(id).includes(channelQuery)||norm(name).includes(channelQuery));
    if(channelQuery){
      const exact=matchesChannel.filter(([id,name])=>norm(id)===channelQuery||norm(name)===channelQuery);
      if(exact.length)matchesChannel=exact;
    }
    const mask=channelQuery?matchesChannel.reduce((acc,c)=>acc|(1<<c[2]),0):(2**catalog.channels.length-1);
    const matches=catalog.products.filter(([sku,group,name,flags])=>
      (flags & mask)!==0&&(!productQuery||[sku,group,name].some(v=>norm(v).includes(productQuery)))
    );
    const channelCounts=new Map();
    for(const [sku,group,name,flags] of matches){
      for(const [id,ch] of channelList(flags & mask))channelCounts.set(id,(channelCounts.get(id)||0)+1);
    }
    const activeChannels=matchesChannel.filter(c=>channelCounts.has(c[0]));
    const families=new Set(matches.map(x=>x[1]||'미분류'));
    $p('catalogStats').textContent=`채널 ${activeChannels.length.toLocaleString('ko-KR')}개 · 제품군 ${families.size.toLocaleString('ko-KR')}개 · 제품 ${matches.length.toLocaleString('ko-KR')}개`;
    $p('catalogChannels').innerHTML=productQuery
      ? `<div class="catalog-caption">검색한 품목을 주문할 수 있는 채널</div><div class="catalog-channel-list">${activeChannels.map(([id,name])=>`<span class="catalog-channel-pill">${escapeHtml(id)} · ${escapeHtml(name)} <b>${channelCounts.get(id)}개</b></span>`).join('')||'<span class="catalog-empty">일치하는 채널이 없습니다.</span>'}</div>`
      : channelQuery&&activeChannels.length>0
        ? `<div class="catalog-caption">선택된 채널</div><div class="catalog-channel-list">${activeChannels.map(([id,name])=>`<span class="catalog-channel-pill">${escapeHtml(id)} · ${escapeHtml(name)}</span>`).join('')}</div>`
        : '';
    if(!channelQuery&&!productQuery){
      $p('catalogResults').innerHTML='<p class="catalog-empty">채널(채널명) 또는 제품군·제품명을 입력하면 주문 가능 품목과 채널이 조회됩니다.</p>';
      $p('catalogMore').hidden=true;
      return;
    }
    if(!matches.length){
      $p('catalogResults').innerHTML='<p class="catalog-empty">첨부된 기준 데이터에서 일치하는 주문 가능 품목이 없습니다.</p>';
      $p('catalogMore').hidden=true;
      return;
    }
    const sorted=[...matches].sort((a,b)=>collate.compare(a[1]||'미분류',b[1]||'미분류')||collate.compare(a[2],b[2]));
    const page=sorted.slice(0,limit);
    let markup='',previous='';
    for(const [sku,group,name,flags] of page){
      const family=group||'미분류';
      if(family!==previous){if(previous)markup+='</div></section>';markup+=`<section class="catalog-family"><h3>${escapeHtml(family)}</h3><div class="catalog-family-items">`;previous=family;}
      markup+=`<div class="catalog-product"><div class="catalog-product-main"><strong>${escapeHtml(name)}</strong><span>자재 ${escapeHtml(sku)}</span></div><div class="catalog-product-channels">${productChannelsHtml(flags & mask)}</div></div>`;
    }
    if(previous)markup+='</div></section>';
    $p('catalogResults').innerHTML=markup;
    $p('catalogMore').hidden=limit>=sorted.length;
    $p('catalogMore').textContent=`더 보기 (${Math.min(limit,sorted.length)} / ${sorted.length})`;
  }
  function scheduleRender(){
    limit=60;
    render();
  }
  async function load(){
    try{
      status.textContent='기본 품목 DB 연결 중';
      const response=await fetch('data/channel-products.b64?v=20261106-1',{cache:'force-cache'});
      if(!response.ok)throw new Error('품목 데이터 HTTP '+response.status);
      const base64=(await response.text()).trim();
      const bytes=typeof b64ToBytes==='function'?b64ToBytes(base64):Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
      const json=typeof gunzip==='function'?await gunzip(bytes):await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
      catalog=JSON.parse(json);
      if(!Array.isArray(catalog.channels)||!Array.isArray(catalog.products)||catalog.channels.length>30)throw new Error('품목 DB 형식 오류');
      if(catalog.products.reduce((n,p)=>n+bitCount(p[3]),0)!==catalog.rows)throw new Error('품목 DB 무결성 오류');
      const datalist=$p('catalogChannelOptions');
      datalist.innerHTML=catalog.channels.map(([id,name])=>`<option value="${escapeHtml(id)}">${escapeHtml(name)}</option><option value="${escapeHtml(name)}">${escapeHtml(id)}</option>`).join('');
      $p('catalogChannel').disabled=false;
      $p('catalogProduct').disabled=false;
      $p('catalogReset').disabled=false;
      status.textContent=`기본 품목 DB 연결 완료 · ${catalog.rows.toLocaleString('ko-KR')}건 / ${catalog.channels.length}개 채널`;
      render();
    }catch(e){
      console.error('Channel product catalog:',e);
      status.textContent='품목 DB를 불러오지 못했습니다. 새로고침 후 다시 확인해 주세요.';
      $p('catalogResults').innerHTML='<p class="catalog-empty">품목 DB 연결 실패</p>';
    }
  }
  for(const id of ['catalogChannel','catalogProduct'])$p(id).addEventListener('input',scheduleRender);
  $p('catalogReset').addEventListener('click',()=>{
    $p('catalogChannel').value='';
    $p('catalogProduct').value='';
    scheduleRender();
  });
  const accountChannel=document.getElementById('channelFilter');
  if(accountChannel)accountChannel.addEventListener('change',()=>{
    if(accountChannel.value){
      $p('catalogChannel').value=accountChannel.value;
      scheduleRender();
    }
  });
  $p('catalogMore').addEventListener('click',()=>{limit+=60;render();});
  load();
})();
