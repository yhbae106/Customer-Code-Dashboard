/* Lightweight interaction layer: discovery, navigation, accessible results and KPI filters. */
(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const navLinks=Array.from(document.querySelectorAll('.feature-link'));
  const searchIds=['q','typeFilter','modeFilter','channelFilter','officeFilter','staffFilter',
    'saleCodeFilter','saleNameFilter','shipCodeFilter','shipNameFilter'];
  const fieldNames={
    q:'전체 검색',typeFilter:'유형',modeFilter:'영업방식',channelFilter:'채널',
    officeFilter:'사무소',staffFilter:'영업담당',saleCodeFilter:'판매처 코드',
    saleNameFilter:'판매처명',shipCodeFilter:'실납처 코드',shipNameFilter:'실납처명'
  };
  const selectedFilterValues={
    '간납':{field:'typeFilter',value:'간납'},
    '종합도매':{field:'typeFilter',value:'종합'},
    '온라인':{field:'modeFilter',value:'온라인'}
  };
  const chipBar=$('activeFilters');
  const rows=$('rows');
  const results=$('tableWrap');
  const detail=$('detailPanel');
  const kpis=$('kpis');
  const emptyDetail=detail?detail.innerHTML:'';
  const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');

  function scrollToElement(el){
    if(el)el.scrollIntoView({behavior:reducedMotion.matches?'auto':'smooth',block:'start'});
  }
  function clearDetail(){
    if(!results||!detail)return;
    results.querySelectorAll('tr.is-selected').forEach(row=>row.classList.remove('is-selected'));
    if(detail.classList.contains('has-selection')){
      detail.innerHTML=emptyDetail;
      detail.classList.remove('has-selection');
    }
  }
  function renderActiveFilters(){
    if(!chipBar)return;
    const active=searchIds.map(id=>{
      const el=$(id);
      if(!el||!el.value)return null;
      const label=el.tagName==='SELECT'
        ?el.options[el.selectedIndex]?.textContent||el.value
        :el.value.trim();
      return label?{id,label:fieldNames[id]+': '+label}:null;
    }).filter(Boolean);
    chipBar.replaceChildren();
    chipBar.hidden=active.length===0;
    if(!active.length)return;
    const prefix=document.createElement('span');
    prefix.className='active-filter-label';
    prefix.textContent='적용 조건';
    chipBar.appendChild(prefix);
    active.forEach(entry=>{
      const button=document.createElement('button');
      button.type='button';
      button.className='active-filter-chip';
      button.dataset.clearFilter=entry.id;
      button.title=entry.label+' 해제';
      const name=document.createElement('span');
      name.textContent=entry.label;
      const x=document.createElement('b');
      x.className='chip-x';
      x.setAttribute('aria-hidden','true');
      x.textContent='×';
      button.append(name,x);
      chipBar.appendChild(button);
    });
  }

  chipBar?.addEventListener('click',event=>{
    const button=event.target.closest('button[data-clear-filter]');
    if(!button)return;
    const field=$(button.dataset.clearFilter);
    if(!field)return;
    field.value='';
    field.dispatchEvent(new Event(field.tagName==='SELECT'?'change':'input',{bubbles:true}));
    renderActiveFilters();
  });

  for(const id of searchIds){
    const el=$(id);
    if(!el)continue;
    const inputEvent=el.tagName==='SELECT'?'change':'input';
    el.addEventListener(inputEvent,()=>{
      clearDetail();
      renderActiveFilters();
    });
  }
  ['clearBtn','resetFilters'].forEach(id=>{
    $(id)?.addEventListener('click',()=>{
      clearDetail();
      queueMicrotask(renderActiveFilters);
    });
  });
  renderActiveFilters();

  navLinks.forEach(link=>{
    link.addEventListener('click',event=>{
      navLinks.forEach(node=>node.classList.toggle('is-active',node===link));
      const focusId=link.dataset.focus;
      if(focusId){
        event.preventDefault();
        scrollToElement($('accountSearch'));
        const field=$(focusId);
        if(field&&!field.disabled)requestAnimationFrame(()=>field.focus({preventScroll:true}));
      }
      if(link.hash==='#guidePanel'){
        const guide=$('guideDisclosure');
        if(guide)guide.open=true;
      }
    });
  });

  function decorateRows(){
    if(!rows)return;
    rows.querySelectorAll('tr[data-i]:not([data-accessible])').forEach(row=>{
      row.dataset.accessible='1';
      row.setAttribute('role','button');
      row.tabIndex=0;
      const name=row.querySelector('td .name')?.textContent?.trim()||'거래처';
      row.setAttribute('aria-label',name+' 상세 정보');
    });
  }
  decorateRows();
  if(rows)new MutationObserver(decorateRows).observe(rows,{childList:true});

  results?.addEventListener('keydown',event=>{
    const row=event.target.closest('tr[data-i]');
    if(!row||event.target!==row)return;
    if(event.key==='Enter'||event.key===' '){
      event.preventDefault();
      row.click();
    }
  });
  results?.addEventListener('click',event=>{
    const row=event.target.closest('tr[data-i]');
    if(!row)return;
    results.querySelectorAll('tr.is-selected').forEach(active=>{
      if(active!==row)active.classList.remove('is-selected');
    });
    row.classList.add('is-selected');
    detail.classList.add('has-selection');
    if(window.matchMedia('(max-width:900px)').matches){
      requestAnimationFrame(()=>scrollToElement(detail));
    }
  });

  document.querySelectorAll('th.sortable').forEach(th=>{
    th.tabIndex=0;
    th.setAttribute('role','button');
    th.setAttribute('aria-label',th.textContent.trim()+' 정렬');
    th.addEventListener('keydown',event=>{
      if(event.key==='Enter'||event.key===' '){
        event.preventDefault();
        th.click();
      }
    });
  });

  function decorateKpis(){
    if(!kpis)return;
    kpis.querySelectorAll('.kpi').forEach(card=>{
      const name=card.querySelector('.label')?.textContent?.trim();
      const spec=selectedFilterValues[name];
      if(!spec)return;
      const field=$(spec.field);
      const available=Array.from(field?.options||[]).some(o=>o.value===spec.value);
      card.classList.add('kpi-clickable');
      card.setAttribute('role','button');
      card.tabIndex=available?0:-1;
      card.dataset.kpiFilter=name;
      card.setAttribute('aria-pressed',String(field?.value===spec.value));
      card.setAttribute('aria-disabled',String(!available));
      card.title=name+' 거래처';
    });
  }
  decorateKpis();
  if(kpis)new MutationObserver(decorateKpis).observe(kpis,{childList:true});
  function activateKpi(card){
    const spec=selectedFilterValues[card?.dataset.kpiFilter];
    if(!spec||card.getAttribute('aria-disabled')==='true')return;
    const field=$(spec.field);
    if(!field)return;
    field.value=field.value===spec.value?'':spec.value;
    field.dispatchEvent(new Event('change',{bubbles:true}));
    scrollToElement($('accountResults'));
  }
  kpis?.addEventListener('click',event=>{
    const card=event.target.closest('.kpi-clickable');
    if(card)activateKpi(card);
  });
  kpis?.addEventListener('keydown',event=>{
    if(event.key!=='Enter'&&event.key!==' ')return;
    const card=event.target.closest('.kpi-clickable');
    if(card){
      event.preventDefault();
      activateKpi(card);
    }
  });

  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&document.activeElement?.id==='q'&&$('q').value){
      $('q').value='';
      $('q').dispatchEvent(new Event('input',{bubbles:true}));
    }
  });
})();
