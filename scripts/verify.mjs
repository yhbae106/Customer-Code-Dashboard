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
const required=['사업자번호','판매처','판매처명','채널','채널명','사원명','주소','상세주소','대표자명'];
for(const h of required)if(!header.includes(h))fail('missing required column '+h);
if(header.length!==26)fail('expected 26 columns, got '+header.length);
if(dataRows.length!==manifest.business_count)fail('expected '+manifest.business_count+' business rows, got '+dataRows.length);
else ok('business row count '+dataRows.length);
if(manifest.original_record_count!==205507)fail('unexpected source row count');
else ok('source row count metadata 205507');

const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
if(!app.includes('function parseCsvRows'))fail('native CSV parser missing');
if(!app.includes("new DecompressionStream('gzip')"))fail('native gzip loader missing');
if(app.includes('XLSX.read(')||html.includes('xlsx.full.min.js'))fail('external XLSX runtime dependency still present');
if(html.includes('cdn.jsdelivr.net'))fail('external CDN dependency still present');
if(!html.includes('app.js?v=20261104-harness2'))fail('cache-busted app asset missing');
ok('runtime dependency and cache guards verified');

if(process.exitCode)process.exit(process.exitCode);
console.log('CUSTOMER DB HARNESS PASS');
