(()=>{'use strict';
const el=id=>document.getElementById(id),E=window.TeamEngine,labels={pts:'Sayı',threes:'Üçlük',reb:'Ribaund',ast:'Asist',stl:'Top çalma',blk:'Blok',to:'Top kaybı ↓',fg:'FG%',ft:'FT%'};
const cols=[['gp','GP'],['mpg','ORT. DK'],['rank','Sıra'],['fg','FG%'],['ft','FT%'],['threes','ORT. 3PTM'],['pts','ORT. PTS'],['reb','ORT. REB'],['ast','ORT. AST'],['stl','ORT. ST'],['blk','ORT. BLK'],['to','ORT. TO']];
let catalog=null,league=null,locks=new Set(),state={team:'',query:'',list:'roster',sort:'pts'},busy=false;
let saved;try{saved=JSON.parse(localStorage.getItem('chaxini-team-state')||'null')}catch{}
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const format=(x,pct=false)=>Number.isFinite(x)?pct?(x*100).toFixed(1)+'%':Number.isInteger(x)?String(x):x.toFixed(1):'—';
const cache={async get(key){try{return await new Promise(resolve=>{const r=indexedDB.open('chaxini-players',1);r.onupgradeneeded=()=>r.result.createObjectStore('data');r.onerror=()=>resolve(null);r.onsuccess=()=>{const db=r.result,q=db.transaction('data').objectStore('data').get(key);q.onsuccess=()=>{resolve(q.result);db.close()};q.onerror=()=>{resolve(null);db.close()}}})}catch{return null}},async put(key,value){try{await new Promise(resolve=>{const r=indexedDB.open('chaxini-players',1);r.onupgradeneeded=()=>r.result.createObjectStore('data');r.onerror=()=>resolve();r.onsuccess=()=>{const db=r.result,t=db.transaction('data','readwrite');t.objectStore('data').put(value,key);t.oncomplete=()=>{db.close();resolve()};t.onerror=()=>{db.close();resolve()}}})}catch{}}};
function status(t){el('teamStatus').textContent=t}
let liveDay={date:'',states:null,checkedAt:0},dayLoading=false;
async function updateDayStatus(){
 if(dayLoading||liveDay.date===today()&&Date.now()-liveDay.checkedAt<60000)return;dayLoading=true;
 const date=today(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{const r=await fetch(`${apiBase}/api/game-status?date=${date}`,{cache:'no-store',signal:controller.signal});if(!r.ok)throw Error('status');const payload=await r.json();if(payload.date!==date||!payload.states)throw Error('status');liveDay={date,states:payload.states,checkedAt:Date.now()}}catch{liveDay={date,states:null,checkedAt:Date.now()}}finally{clearTimeout(timer);dayLoading=false;if(catalog)drawEfficiency()}
}
function schedule(){return Object.fromEntries(data.teams.map(t=>[t,[...new Set(data.weeks.flatMap(w=>w.games[t].map(g=>g.date)))].sort()]))}
function roster(){const t=league?.teams.find(t=>t.id===state.team);return (t?.playerIds||[]).map(id=>{const p=catalog.players.find(x=>x.id===id);return p?{...p,slot:league.lineups?.[t.id]?.[id]||'BN'}:null}).filter(p=>p&&E.inScope(p))}
function persist(){try{localStorage.setItem('chaxini-team-state',JSON.stringify({team:state.team,locks:[...locks]}))}catch{}}
async function accept(payload,fromSnapshot=false){
 if(!payload?.catalog?.players?.length||!payload?.league?.teams?.length)throw Error('Geçerli lig ve oyuncu verisi bulunamadı.');
 catalog={...payload.catalog,players:payload.catalog.players.map(E.normalize)};league=payload.league;el('leagueUrl').value='https://basketball.fantasysports.yahoo.com/nba/'+league.id;
 await cache.put('catalog-'+catalog.season,catalog);await cache.put('league-'+league.id,league);await cache.put('lastLeague',league.id);
 if(!league.teams.some(t=>t.id===state.team))state.team=league.teams.some(t=>t.id===saved?.team)?saved.team:league.teams[0].id;
 locks=new Set(saved?.locks||[]);el('myTeam').innerHTML=league.teams.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');el('myTeam').value=state.team;el('teamWorkspace').hidden=false;
 const stamp=new Date(league.updatedAt).toLocaleString(window.ChaxiniI18n?.locale()||'tr-TR');status(`${league.name} · ${league.teams.length} takım · ${catalog.players.length} oyuncu · ${stamp}${fromSnapshot?' · Kayıtlı kopya':''}`);
 el('catalogStamp').textContent=`Oyuncu istatistikleri: ${new Date(catalog.updatedAt).toLocaleString(window.ChaxiniI18n?.locale()||'tr-TR')} · Ortalamalar oyuncunun süre aldığı maçlardan hesaplanır. FG/FT yüzdeleri isabet/deneme oranıdır. Yahoo sırası kaynak sıralamasıdır. Günlük eklenme yüzdesi kaynaktan alınamadı; öneri puanında kullanılmıyor.`;
 render();
}
function leagueId(url){let u;try{u=new URL(url)}catch{throw Error('Tam Yahoo NBA lig bağlantısını yapıştır.')}if(u.protocol!=='https:'||u.hostname!=='basketball.fantasysports.yahoo.com')throw Error('Yalnızca https://basketball.fantasysports.yahoo.com/nba/… bağlantıları kabul edilir.');const m=u.pathname.match(/^\/nba\/(\d+)(?:\/|$)/);if(!m)throw Error('Lig numarası bağlantıda bulunamadı.');return m[1]}
async function loadLeague(){if(busy)return;let id;try{id=leagueId(el('leagueUrl').value.trim())}catch(e){status(e.message);return}busy=true;el('loadLeague').disabled=true;status('Lig kadroları ve oyuncu havuzu yükleniyor… İlk yükleme birkaç dakika sürebilir.');try{
 const base=apiBase;if(base&&!/^https:\/\//.test(base)&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base))throw Error('Veri servisi adresi HTTPS olmalı.');try{localStorage.setItem('chaxini-team-api',base)}catch{}
 const deadline=Date.now()+480000;let job='',payload;
 while(true){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);let response;
  try{response=await fetch(`${base}/api/league?id=${encodeURIComponent(id)}&refresh=1&async=1${job?'&job='+encodeURIComponent(job):''}`,{signal:controller.signal,cache:'no-store'});payload=await response.json()}finally{clearTimeout(timer)}
  if(!response.ok)throw Error(payload.error||`Veri servisi yanıtı: ${response.status}`);
  if(response.status!==202){await accept(payload);break}
  if(!payload.job)throw Error('Sunucu yükleme numarasını döndürmedi.');job=payload.job;
  if(Date.now()>deadline)throw Error('Yahoo verilerinin indirilmesi beklenenden uzun sürdü. Biraz sonra tekrar yenile.');
  status('Yahoo verileri sunucuda indiriliyor… Tamamlandığında kadro otomatik güncellenecek.');
  await new Promise(resolve=>setTimeout(resolve,2500));
 }

 }catch(e){const l=await cache.get('league-'+id),c=l?await cache.get('catalog-'+(new Date().getMonth()>=7?new Date().getFullYear():new Date().getFullYear()-1)):null;
 if(l&&c){await accept({league:l,catalog:c},true);status(el('teamStatus').textContent+' · Yenileme başarısız; son kayıt gösteriliyor. '+(e.name==='AbortError'?'Sunucu yanıtı zaman aşımına uğradı; biraz sonra tekrar dene.':e.message))}else status('Lig yüklenemedi. GitHub Pages üzerinde canlı yükleme için veri servisi bağlantısı gerekir. Kayıtlı örnek ligi açabilir veya bağlantı ayarını yapabilirsin. '+(e.name==='AbortError'?'İstek zaman aşımına uğradı.':e.message));
 }finally{busy=false;el('loadLeague').disabled=false}}
function needs(){const a=[...document.querySelectorAll('#needs input:checked')].map(e=>e.value);return a.length?a:['pts']}
function badge(p){const c=colors[p.nba]||'#506070';return `<span class="monogram" style="--tc:${esc(c)}" title="${esc(names[p.nba]||p.nba)}">${esc(p.nba||'?')}</span>`}
function playerName(p){return `<div class="ta-player">${badge(p)}<div><strong>${esc(p.name)}</strong><small>${esc(p.positions.join(' / '))}${p.slot?' · '+esc(p.slot):''}${p.injury?' · <b class="ta-injury">'+esc(p.injury)+'</b>':''}</small></div></div>`}
function playerRows(players){return `<table class="ta-stats"><thead><tr><th>OYUNCU</th>${cols.map(([k,v])=>`<th>${v}</th>`).join('')}<th>KATILIM</th><th>KORU</th></tr></thead><tbody>${players.map(p=>`<tr><td>${playerName(p)}</td>${cols.map(([k])=>`<td>${format(['gp','mpg','rank'].includes(k)?p[k]:p.stats?.[k],k==='fg'||k==='ft')}</td>`).join('')}<td title="Oyuncu GP / NBA takımının tamamlanan maçları">${format(p.participation,true)}</td><td>${state.list==='roster'?`<input type="checkbox" data-lock="${esc(p.id)}" ${locks.has(p.id)||E.protectedPlayer(p,new Set())?'checked':''} ${E.protectedPlayer(p,new Set())?'disabled':''} aria-label="${esc(p.name)} kadroda koru">`:'—'}</td></tr>`).join('')}</tbody></table>`}
function render(){if(!catalog||!league||!window.data&&typeof data==='undefined')return;
 let list=state.list==='roster'?roster():state.list==='available'?catalog.players.filter(p=>['FA','W'].includes(league.availability[p.id])):catalog.players;
 list=list.filter(E.inScope).filter(p=>`${p.name} ${p.nba} ${p.positions.join(' ')}`.toLocaleLowerCase('tr').includes(state.query.toLocaleLowerCase('tr'))).sort((a,b)=>{const value=p=>['rank','mpg'].includes(state.sort)?p[state.sort]:p.stats?.[state.sort];const av=value(a),bv=value(b);if(!Number.isFinite(av))return Number.isFinite(bv)?1:0;if(!Number.isFinite(bv))return -1;return (['rank','to'].includes(state.sort)?av-bv:bv-av)||(a.rank??9999)-(b.rank??9999)});
 el('playerTable').innerHTML=playerRows(list);el('playerCount').textContent=`${list.length} oyuncu`;
 el('poolNote').textContent=state.list==='available'?'FA: serbest oyuncu. W: waiver sürecinde; hemen alınabileceği varsayılmaz.':'İstatistikler ortak oyuncu havuzundan gelir; lig değişince oyuncunun ortalaması değil, kadro ve müsaitlik bilgisi değişir.';
 drawRecommendations();drawEfficiency();persist();
}
function drawRecommendations() {
 const categories = needs();
 const recommendations = E.recommend(catalog.players, league.availability, roster(), categories, el('includeWaiver').checked);
 const container = el('recommendations');
 if (!recommendations.length) {
  container.innerHTML = '<p class="ta-empty">Seçilen kategorilerde katılım, dakika ve sağlık koşullarını karşılayan müsait oyuncu bulunamadı.</p>';
  return;
 }
 const headers = categories.map(category => `<th scope="col">${labels[category]}</th>`).join('');
 const rows = recommendations.map(({player}, index) => {
  const values = categories.map(category => `<td>${format(player.stats[category], category === 'fg' || category === 'ft')}</td>`).join('');
  const availability = league.availability[player.id] === 'W'
   ? '<abbr title="Waiver: talep sonucu ve uygunluk tarihi kontrol edilmeli.">W</abbr>'
   : '<abbr title="Serbest oyuncu.">FA</abbr>';
  const teammates = catalog.players.filter(teammate => {
   const injury = String(teammate.injury || '').trim().toUpperCase();
   return teammate.id !== player.id && teammate.nba === player.nba &&
    ['Q','QUESTIONABLE','D','DOUBTFUL','P','PROBABLE','O','OUT'].includes(injury) &&
    teammate.positions.some(position => player.positions.includes(position));
  }).slice(0, 3);
  const context = teammates.length
   ? `<details><summary>Rotasyon bilgisi</summary><p>Aynı NBA takımında benzer pozisyonda ${teammates.map(teammate => `${esc(teammate.name)} (${esc(teammate.injury)})`).join(', ')} var. Bu bir rotasyon fırsatı olabilir; dakika artışı doğrulanmadığından puana eklenmedi.</p></details>`
   : '';
  return `<tr>
   <td>${playerName(player)}</td><td>${index + 1}</td>${values}
   <td>${format(player.mpg)}</td><td>${player.gp}/${player.teamGp}</td><td>${format(player.participation, true)}</td>
   <td>${format(player.rank)}</td><td>${availability}</td>
   <td class="ta-rec-context"><a href="${esc(player.newsUrl)}" target="_blank" rel="noopener noreferrer">Yahoo oyuncu haberleri ↗</a>${context}</td>
  </tr>`;
 }).join('');
 container.innerHTML = `<div class="ta-table-wrap"><table class="ta-stats ta-recommend-table" aria-label="Oyuncu önerileri">
  <thead><tr><th scope="col">OYUNCU</th><th scope="col">ÖNERİ</th>${headers}<th scope="col">ORT. DK</th>
   <th scope="col">MAÇ</th><th scope="col">KATILIM</th><th scope="col">YAHOO SIRASI</th><th scope="col">DURUM</th><th scope="col">BİLGİ</th></tr></thead>
  <tbody>${rows}</tbody></table></div>`;
}
function comparisonTable(plan,dates,s){
 const keys=['mpg',...E.cats];
 const value=(player,key)=>key==='mpg'?player.mpg:player.stats?.[key];
 const dayNames=window.ChaxiniI18n?.lang()==='en'?['Sun','Mon','Tue','Wed','Thu','Fri','Sat']:['Paz','Pzt','Sal','Çar','Per','Cum','Cmt'];
 const games=player=>(s[player.nba]||[]).filter(d=>dates.includes(d)).map(d=>dayNames[new Date(d+'T12:00:00Z').getUTCDay()]).join(' · ')||'—';
 const stat=(player,key,compare)=>{const v=value(player,key),base=value(plan.drop,key),up=Number.isFinite(v)&&Number.isFinite(base)&&v>base,down=Number.isFinite(v)&&Number.isFinite(base)&&v<base;
  const arrow=compare&&(up||down)?` <span class="ta-stat-arrow ${(key==='to'?down:up)?'positive':'negative'}" aria-label="${up?'Daha yüksek':'Daha düşük'}">${up?'↑':'↓'}</span>`:'';
  return `<td>${format(v,key==='fg'||key==='ft')}${arrow}</td>`};
 return `<article class="ta-comparison"><div class="ta-table-wrap"><table class="ta-stats ta-compare-table"><thead><tr><th>OYUNCU</th><th>İŞLEM</th><th>MAÇ GÜNLERİ</th><th>NET MAÇ</th>${keys.map(k=>`<th>${k==='mpg'?'ORT. DK':k==='fg'?'FG%':k==='ft'?'FT%':'ORT. '+({pts:'PTS',threes:'3PTM',reb:'REB',ast:'AST',stl:'ST',blk:'BLK',to:'TO'}[k])}</th>`).join('')}</tr></thead><tbody><tr><td>${playerName(plan.drop)}</td><td>Kadrodaki</td><td class="ta-game-days">${games(plan.drop)}</td><td>—</td>${keys.map(k=>stat(plan.drop,k,false)).join('')}</tr><tr class="ta-add-row"><td>${playerName(plan.add)}</td><td>Önerilen</td><td class="ta-game-days">${games(plan.add)}</td><td class="positive">+${plan.gain}</td>${keys.map(k=>stat(plan.add,k,true)).join('')}</tr></tbody></table></div></article>`;
}
function drawEfficiency(){if(typeof data==='undefined'||!data)return; const selected=el('effDate').value,current=today(),date=selected<current?current:selected,w=data.weeks.find(w=>date>=w.start&&date<=w.end);if(!w){el('effSummary').textContent='Seçilen tarih kayıtlı NBA takviminin dışında.';el('effDays').innerHTML='';el('effPlans').innerHTML='';return}
 const dates=[];for(let d=date;d<=w.end;d=shiftDate(d,1))dates.push(d);
 const r=roster(),t=league.teams.find(t=>t.id===state.team),s=schedule(),slots=t.slots.length?t.slots:['PG','SG','G','SF','PF','F','C','C','Util','Util'];
 // Today's started/completed games are excluded. If unavailable, today's games
 // are withheld rather than presenting completed games as upcoming.
 for(const nba of Object.keys(s))s[nba]=s[nba].filter(d=>d!==current||(liveDay.date===current&&liveDay.states?.[nba]==='pre'));
 const result=E.optimize(r,catalog.players,league.availability,slots,dates,s,locks,needs());
 el('effSummary').textContent=`${w.number}. hafta · ${fmt(date)} – ${fmt(w.end)} · ${slots.length} aktif kadro yeri · ${result.baseline.games} oynatılabilir oyuncu-maçı. Bir ekleme / bir bırakma senaryosu; henüz başlamamış maç varsayımıyla.`;
 el('effDays').innerHTML='<table class="ta-stats"><thead><tr><th>GÜN</th><th>MAÇI OLAN</th><th>OYNATILABİLEN</th><th>YEDEKTE KALAN</th>'+['pts','threes','reb','ast','stl','blk','to','fg','ft'].map(k=>'<th>'+labels[k]+'</th>').join('')+'</tr></thead><tbody>'+result.baseline.days.map(d=>`<tr><td>${fmt(d.date,{weekday:'short',day:'numeric',month:'short'})}</td><td>${d.scheduled}</td><td>${d.players.length}</td><td>${d.benched}</td>${E.cats.map(k=>`<td>${format(d.stats[k],k==='fg'||k==='ft')}</td>`).join('')}</tr>`).join('')+'</tbody></table>';
 el('effPlans').innerHTML=result.plans.length?result.plans.map(plan=>comparisonTable(plan,dates,s)).join(''):'<p class="ta-empty">Korunan oyuncuları bırakmadan ve %65 şartını bozmadan kalan haftada net maç kazandıran bir değişiklik bulunamadı.</p>';
 if(dates.includes(current)&&!(liveDay.date===current&&liveDay.states))el('effSummary').textContent+=' Bugünkü maçların durumu doğrulanana kadar yalnızca sonraki günler hesaba katılır.';
 if(!dayLoading&&(liveDay.date!==current||Date.now()-liveDay.checkedAt>=60000))updateDayStatus();

}
el('loadLeague').onclick=loadLeague;el('myTeam').onchange=()=>{state.team=el('myTeam').value;render()};el('taSearch').oninput=()=>{state.query=el('taSearch').value;render()};el('taSort').onchange=()=>{state.sort=el('taSort').value;render()};el('taList').onchange=()=>{state.list=el('taList').value;render()};el('needs').innerHTML=Object.entries(labels).map(([k,v])=>`<label><input type="checkbox" value="${k}" ${k==='threes'?'checked':''}>${v}</label>`).join('');el('needs').onchange=()=>render();el('includeWaiver').onchange=()=>drawRecommendations();el('effDate').value=today();el('effDate').onchange=()=>{drawEfficiency();updateDayStatus()};
el('playerTable').onclick=e=>{const id=e.target.dataset.lock;if(id){e.target.checked?locks.add(id):locks.delete(id);drawEfficiency();persist()}};
el('sampleLeague').onclick=async()=>{try{await accept(await (await fetch('./team-snapshot.json')).json(),true)}catch(e){status('Kayıtlı lig kopyası açılamadı: '+e.message)}};
let apiBase=location.hostname==='tankosedag.github.io'?'https://chaxini-fantasy-basketbol-takvim.onrender.com':'';try{apiBase=(localStorage.getItem('chaxini-team-api')||apiBase).trim().replace(/\/$/,'')}catch{}
(async()=>{const id=await cache.get('lastLeague');if(id){const l=await cache.get('league-'+id),c=l?await cache.get('catalog-'+(new Date().getMonth()>=7?new Date().getFullYear():new Date().getFullYear()-1)):null;if(l&&c){await accept({league:l,catalog:c},true);return}}try{await accept(await (await fetch('./team-snapshot.json')).json(),true)}catch{status('Kayıtlı veri açılamadı. Siteyi bir web sunucusu üzerinden aç.')}})();
window.addEventListener('chaxini-language',()=>{if(catalog)render()});
window.addEventListener('focus',()=>{if(catalog)updateDayStatus()});
window.addEventListener('hashchange',()=>{if(location.hash==='#takim-analizi'&&catalog)render()});
})();
