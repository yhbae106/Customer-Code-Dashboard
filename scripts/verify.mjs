import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const fail=m=>{console.error('HARNESS FAIL:',m);process.exitCode=1;};
const ok=m=>console.log('HARNESS OK:',m);

const manifest=JSON.parse(fs.readFileSync(path.join(root,'data/manifest.json'),'utf8'));
if(manifest.chunk_count!==manifest.chunks.length)fail('manifest chunk_count mismatch');

const parts=[];
for(const rel of manifest.chunks){
  const p=path.join(root,rel);
  if(!fs.existsSync(p)){fail('missing chunk '+rel);continue;}
  parts.push(Buffer.from(fs.readFileSync(p,'utf8').trim(),'base64'));
}
const gz=Buffer.concat(parts);
const sha=crypto.createHash('sha256').update(gz).digest('hex');
if(sha!==manifest.sha256)fail('embedded DB sha256 mismatch');
else ok('embedded DB checksum verified');

let csv;
try{csv=zlib.gunzipSync(gz).toString('utf8');}
catch(e){fail('gzip decompression failed: '+e.message);csv='';}

function parseCsvRows(text){
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){
      if(c==='"'){
        if(text[i+1]==='"'){field+='"';i++;} else quoted=false;
      }else field+=c;
    }else if(c==='"')quoted=true;
    else if(c===','){row.push(field);field='';}
    else if(c==='\n'){row.push(field);rows.push(row);row=[];field='';}
    else if(c!=='\r')field+=c;
  }
  if(field.length||row.length){row.push(field);rows.push(row);}
  return rows;
}
const rows=parseCsvRows(csv);
const header=rows[0]||[];
const dataRows=rows.slice(1).filter(r=>r.some(v=>String(v).trim()!==''));
const required=['사업자번호','판매처','판매처명','채널','채널명','사원명','주소','상세주소','대표자명','전화번호','팩스번호','휴대폰번호','이메일','연락처출처','연락처출처URL'];
for(const h of required)if(!header.includes(h))fail('missing required column '+h);
if(header.length!==32)fail('expected 32 columns, got '+header.length);
if(dataRows.length!==manifest.business_count)fail('expected '+manifest.business_count+' business rows, got '+dataRows.length);
else ok('business row count '+dataRows.length);
if(manifest.original_record_count!==205507)fail('unexpected source row count');
else ok('source row count metadata 205507');
if(Number(manifest.contact_coverage?.['전화번호']||0)!==70351)fail('unexpected phone coverage');
else ok('phone coverage 70351 businesses');
if(Number(manifest.web_verified_count||0)!==15)fail('unexpected web-verified contact count');
else ok('web-verified contact count 15');

const relManifest=JSON.parse(fs.readFileSync(path.join(root,'data/relations-manifest.json'),'utf8'));
if(relManifest.chunk_count!==relManifest.chunks.length)fail('relation manifest chunk_count mismatch');
const relParts=[];
for(const rel of relManifest.chunks){
  const p=path.join(root,rel);
  if(!fs.existsSync(p)){fail('missing relation chunk '+rel);continue;}
  relParts.push(Buffer.from(fs.readFileSync(p,'utf8').trim(),'base64'));
}
const relGz=Buffer.concat(relParts);
const relSha=crypto.createHash('sha256').update(relGz).digest('hex');
if(relSha!==relManifest.sha256)fail('relation DB sha256 mismatch');
else ok('relation DB checksum verified');
let relation;
try{relation=JSON.parse(zlib.gunzipSync(relGz).toString('utf8'));}
catch(e){fail('relation DB decompression/JSON parse failed: '+e.message);relation={h:[],r:[]};}
if(!Array.isArray(relation.h)||!Array.isArray(relation.r))fail('relation DB structure invalid');
if(relation.r.length!==202673)fail('expected 202673 relationship rows, got '+relation.r.length);
else ok('relationship row count 202673');
const relIdx=Object.fromEntries((relation.h||[]).map((h,i)=>[h,i]));
for(const h of ['사업자번호','판매처명','실납처','실납처명','채널','채널명','사무소명','사원명'])if(relIdx[h]===undefined)fail('relation DB missing field '+h);
const yong=(relation.r||[]).filter(r=>r[relIdx['실납처명']]==='용인세브란스병원');
if(!yong.some(r=>r[relIdx['채널']]==='DW24'&&r[relIdx['사원명']]==='최종인'))fail('용인세브란스병원 DW24/최종인 relation missing');
if(!yong.some(r=>r[relIdx['채널']]==='ZCSO'&&r[relIdx['사원명']]==='권봉기'))fail('용인세브란스병원 ZCSO/권봉기 relation missing');
if(!yong.some(r=>r[relIdx['채널']]==='ZOCS'&&r[relIdx['사원명']]==='홍정표'))fail('용인세브란스병원 ZOCS/홍정표 relation missing');
else ok('용인세브란스병원 channel-owner relation guards present');

const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const deploy=fs.readFileSync(path.join(root,'.github/workflows/deploy-pages.yml'),'utf8');
if(!app.includes('function parseCsvRows'))fail('native CSV parser missing');
if(!app.includes("new DecompressionStream('gzip')"))fail('native gzip loader missing');
if(app.includes('XLSX.read(')||html.includes('xlsx.full.min.js'))fail('external XLSX runtime dependency still present');
if(html.includes('cdn.jsdelivr.net'))fail('external CDN dependency still present');
if(app.includes("c==='\\\\n'")||app.includes("c!=='\\\\r'"))fail('browser CSV parser contains literal backslash newline bug');
if(!app.includes("c==='\\n'")||!app.includes("c!=='\\r'"))fail('browser CSV parser newline handling missing');
if(!html.includes('app.js?v=20261104-master9'))fail('cache-busted app asset missing');
if(!app.includes("'연락처',['전화번호','휴대폰번호','팩스번호','이메일'"))fail('contact detail group missing');
if(!html.includes('data-sort="전화번호"'))fail('contact result column missing');
if(!html.includes('id="shiptoPanel"'))fail('ship-to owner panel missing');
if(!html.includes('실납처/담당'))fail('ship-to owner result column missing');
if(!app.includes('async function fetchRelationDb'))fail('relation DB loader missing');
if(!app.includes('function businessRelationsHtml'))fail('business relationship detail renderer missing');
if(!app.includes('function relationSummaryForBusiness'))fail('relationship result summary missing');
if(!app.includes("data/customer-master.gz"))fail('single-file customer master loader missing');
if(!app.includes("data/relations-master.gz"))fail('single-file relation master loader missing');
if(!app.includes("{cache:'force-cache'}"))fail('versioned master cache policy missing');
if(!deploy.includes("data/customer-master.gz")||!deploy.includes("data/relations-master.gz"))fail('Pages master database build step missing');
ok('runtime dependency and single-file database guards verified');

if(process.exitCode)process.exit(process.exitCode);
console.log('CUSTOMER DB HARNESS PASS');
