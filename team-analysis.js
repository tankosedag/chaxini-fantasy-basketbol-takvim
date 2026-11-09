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
function roster(t=league?.teams.find(t=>t.id===state.team)){return (t?.playerIds||[]).map(id=>{const p=catalog.players.find(x=>x.id===id);return p?{...p,slot:league.lineups?.[t.id]?.[id]||'BN'}:null}).filter(p=>p&&E.inScope(p))}
function persist(){try{localStorage.setItem('chaxini-team-state',JSON.stringify({team:state.team,locks:[...locks]}))}catch{}}
async function accept(payload,fromSnapshot=false){
 if(!payload?.catalog?.players?.length||!payload?.league?.teams?.length)throw Error('Geçerli lig ve oyuncu verisi bulunamadı.');
 catalog={...payload.catalog,players:payload.catalog.players.map(E.normalize)};league=payload.league;matchupRequests.clear();el('leagueUrl').value='https://basketball.fantasysports.yahoo.com/nba/'+league.id;
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
 const columns = [
  ['ÖNERİ', (_, index) => index + 1],
  ...categories.map(category => [labels[category], player => format(player.stats[category], category === 'fg' || category === 'ft')]),
  ['ORT. DK', player => format(player.mpg)],
  ['MAÇ', player => `${player.gp}/${player.teamGp}`]
 ];
 const statusCodes = {Q:'Q', QUESTIONABLE:'Q', D:'D', DOUBTFUL:'D', P:'P', PROBABLE:'P', O:'O', OUT:'O'};
 const headers = columns.map(([label]) => `<th scope="col">${label}</th>`).join('');
 const rows = recommendations.map(({player}, index) => {
  const values = columns.map(([label, value]) => `<td><span class="ta-rec-label" aria-hidden="true">${label}</span>${value(player, index)}</td>`).join('');
  const teammates = catalog.players.filter(teammate => {
   const injury = String(teammate.injury || '').trim().toUpperCase();
   return teammate.id !== player.id && teammate.nba === player.nba &&
    Object.hasOwn(statusCodes, injury) && teammate.positions.some(position => player.positions.includes(position));
  }).slice(0, 3);
  const context = teammates.length ? `<details><summary>Rotasyon bilgisi</summary>${teammates.map(teammate => {
   const code = statusCodes[String(teammate.injury).trim().toUpperCase()];
   return `<div>${esc(teammate.name)} (<span class="ta-rec-injury">${code}</span>)</div>`;
  }).join('')}</details>` : '';
  return `<tr role="row">
   <td class="ta-rec-player-cell">${playerName(player)}</td>${values}
   <td class="ta-rec-context"><a href="${esc(player.newsUrl)}" target="_blank" rel="noopener noreferrer">Yahoo oyuncu haberleri ↗</a>${context}</td>
  </tr>`;
 }).join('');
 container.innerHTML = `<div class="ta-recommend-wrap"><table class="ta-stats ta-recommend-table" role="table" aria-label="Oyuncu önerileri">
  <thead><tr role="row"><th scope="col">OYUNCU</th>${headers}<th scope="col">BİLGİ</th></tr></thead>
  <tbody role="rowgroup">${rows}</tbody></table></div>`;
}
const matchupRequests = new Map();
function getMatchup(week, team) {
 const id = league.id;
 const key = `${id}/${week.number}/${team.id}`;
 const cached = matchupRequests.get(key);
 if (cached && (cached.pending || Date.now() - cached.checkedAt < 300000)) return cached;
 const entry = {pending: true, checkedAt: Date.now(), data: null};
 matchupRequests.set(key, entry);
 if (matchupRequests.size > 64) matchupRequests.delete(matchupRequests.keys().next().value);
 const params = new URLSearchParams({id, team: team.id, week: week.number});
 const controller = new AbortController();
 const timer = setTimeout(() => controller.abort(), 35000);
 fetch(`${apiBase}/api/matchup?${params}`, {cache: 'no-store', signal: controller.signal})
  .then(async response => {
   if (!response.ok) return;
   const match = await response.json();
   if (match.team === team.id && match.week === week.number && match.start === week.start && match.end === week.end) {
    entry.data = match;
   }
  }).catch(() => {}).finally(() => {
   clearTimeout(timer);
   entry.pending = false;
   entry.checkedAt = Date.now();
   if (catalog && league.id === id && state.team === team.id) drawEfficiency();
  });
 return entry;
}

function activeSlots(team) {
 return team.slots?.length ? team.slots : ['PG','SG','G','SF','PF','F','C','C','Util','Util'];
}

function statText(value, category) {
 return format(value, category === 'fg' || category === 'ft');
}

function efficiencyTable(baseline, own, opponent, rival, score) {
 const dailyRows = baseline.days.map(day => `<tr><td>${fmt(day.date, {weekday:'short',day:'numeric',month:'short'})}</td>
  <td>${day.scheduled}</td><td>${day.players.length}</td><td>${day.benched}</td>
  ${E.cats.map(category => `<td>${statText(day.stats[category], category)}</td>`).join('')}<td></td></tr>`).join('');
 const sumRow = (title, games, stats, name='') => `<tr class="ta-week-total">
  <td><strong>${title}</strong>${name ? `<small data-no-translate>${esc(name)}</small>` : ''}</td>
  <td></td><td>${games}</td><td></td>
  ${E.cats.map(category => `<td>${statText(stats[category], category)}</td>`).join('')}<td></td></tr>`;
 const scoreCells = score ? E.cats.map(category => {
  const result = score.outcomes[category];
  const icon = result === 1 ? '↑' : result === -1 ? '↓' : '—';
  const title = result === 1 ? 'Takımın önde' : result === -1 ? 'Rakip önde' : result === 0 ? 'Berabere' : 'Veri yok';
  return `<td class="${result === 1 ? 'positive' : result === -1 ? 'negative' : ''}" title="${title}">${icon}</td>`;
 }).join('') : '';
 const matchRows = opponent ? `<tr class="ta-match-arrows"><td colspan="4"></td>${scoreCells}
  <td class="ta-match-score">${score.known ? `${score.wins}-${score.losses}` : '—'}</td></tr>
  ${sumRow('Rakip toplamı', opponent.games, opponent.stats, rival.name)}` : '';
 return `<table class="ta-stats ta-eff-table"><thead><tr><th>GÜN</th><th>MAÇI OLAN</th><th>OYNATILABİLEN</th><th>YEDEKTE KALAN</th>
  ${E.cats.map(category => `<th>${labels[category]}</th>`).join('')}<th>TAHMİNİ SKOR</th></tr></thead>
  <tbody>${dailyRows}${sumRow('Takım toplamı', baseline.games, own)}${matchRows}</tbody></table>`;
}

function matchupSuggestions(groups, own, opponent) {
 if (!groups.length) return '<p class="ta-empty">%3,5 fark sınırında kazanılabilecek kategori yok.</p>';
 return groups.map(({category, options}) => `<section class="ta-match-category">
  <h3>${labels[category]}</h3>
  ${options.length ? `<ul>${options.map(({add, drop, value, score}) => `<li>
   <div><span>Ekle</span> <b data-no-translate>${esc(add.name)}</b> · <strong>${labels[category]}</strong> <strong>${statText(add.stats[category],category)}</strong> · <span>Bırak</span> <b data-no-translate>${esc(drop.name)}</b></div>
   <div><span>Takım tahmini</span> ${statText(own[category],category)} → <strong>${statText(value,category)}</strong>
    · <span>Rakip</span> ${statText(opponent[category],category)} · <span>Tahmini skor</span> <b>${score.wins}-${score.losses}</b></div>
  </li>`).join('')}</ul>` : '<p>Bu kategori için uygun oyuncu bulunamadı.</p>'}
 </section>`).join('');
}

function drawEfficiency() {
 if (typeof data === 'undefined' || !data || !league) return;
 const team = league.teams.find(item => item.id === state.team);
 if (!team) return;
 const selected = el('effDate').value;
 const current = today();
 const date = selected < current ? current : selected;
 const week = data.weeks.find(item => date >= item.start && date <= item.end);
 if (!week) {
  el('effSummary').textContent = 'Seçilen tarih kayıtlı NBA takviminin dışında.';
  el('effDays').innerHTML = '';
  el('effPlans').innerHTML = '';
  return;
 }
 const dates = [];
 for (let day = date; day <= week.end; day = shiftDate(day, 1)) dates.push(day);
 const games = schedule();
 for (const nba of Object.keys(games)) {
  games[nba] = games[nba].filter(day => day !== current || (liveDay.date === current && liveDay.states?.[nba] === 'pre'));
 }
 const players = roster(team);
 const slots = activeSlots(team);
 const baseline = E.totals(players, slots, dates, games);
 const own = E.estimate(baseline.days.flatMap(day => day.players));
 const match = el('teamPage').hidden ? null : getMatchup(week, team);
 const rival = match?.data && league.teams.find(item => item.id === match.data.opponent);
 let opponent = null;
 let score = null;
 let suggestions = '';
 if (rival) {
  const projection = E.totals(roster(rival), activeSlots(rival), dates, games);
  opponent = {games: projection.games, stats: E.estimate(projection.days.flatMap(day => day.players))};
  score = E.matchupScore(own, opponent.stats);
  const groups = E.matchupUpgrades({roster: players, players: catalog.players, availability: league.availability,
   slots, dates, schedule: games, locks, own, opponent: opponent.stats});
  suggestions = matchupSuggestions(groups, own, opponent.stats);
 } else if (match) {
  suggestions = `<p class="ta-empty">${match.pending ? 'Yahoo haftalık rakibi yükleniyor…' : 'Yahoo haftalık rakibi doğrulanamadı.'}</p>`;
 }
 el('effSummary').textContent = `${week.number}. hafta · ${fmt(date)} – ${fmt(week.end)} · Kalan maçların tahmini`;
 if (dates.includes(current) && !(liveDay.date === current && liveDay.states)) {
  el('effSummary').textContent += ' · Bugünkü maçların durumu doğrulanana kadar yalnızca sonraki günler hesaba katılır.';
 }
 el('effDays').innerHTML = efficiencyTable(baseline, own, opponent, rival, score);
 el('effPlans').innerHTML = suggestions ? `<h3>Eşleşme için takviyeler</h3>${suggestions}` : '';
 if (!dayLoading && dates.includes(current) && (liveDay.date !== current || Date.now() - liveDay.checkedAt >= 60000)) updateDayStatus();
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
