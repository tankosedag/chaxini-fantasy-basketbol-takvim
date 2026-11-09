(function(root){
'use strict';
const cats=['pts','threes','reb','ast','stl','blk','to','fg','ft'];
const unavailable=new Set(['O','INJ','IL','NA','OFS','SUSP','D']);
const n=(p,k)=>Number.isFinite(p.stats?.[k])?p.stats[k]:null;

function normalize(player) {
 const rawStats = player.rawStats || player.stats || {};
 const rawMpg = Object.hasOwn(player, 'rawMpg') ? player.rawMpg : player.mpg;
 const played = Number.isFinite(player.gp) && player.gp > 0;
 const validParticipation = Number.isFinite(player.gp) && player.gp >= 0 &&
  Number.isFinite(player.teamGp) && player.teamGp > 0 && player.gp <= player.teamGp;
 const stats = {...rawStats};
 for (const category of ['fgm','fga','ftm','fta','threes','pts','reb','ast','stl','blk','to']) {
  const total = player.seasonTotals?.[category];
  if (!played) stats[category] = null;
  else if (Number.isFinite(total)) stats[category] = total / player.gp;
  else stats[category] = Number.isFinite(rawStats[category]) ? rawStats[category] : null;
 }
 return {
  ...player, rawStats, rawMpg, stats,
  mpg: played && Number.isFinite(rawMpg) ? rawMpg : null,
  participation: validParticipation ? player.gp / player.teamGp : null,
  averagesBasis: 'player-games',
  averagePrecision: player.seasonTotals ? 'season-totals' : 'rounded-yahoo-averages'
 };
}

function inScope(p){return p.injury!=='NA'&&Number.isFinite(p.mpg)&&p.mpg>=10}
function healthy(p){return !unavailable.has(p.injury)}
function inactiveSlot(slot) {
 return ['IL','IL+','IR','IR+','NA'].includes(String(slot ?? '').replace(/\s+/g,'').toUpperCase());
}
function eligible(p){return inScope(p)&&healthy(p)&&Number.isFinite(p.participation)&&p.participation>=.45&&p.gp>0&&p.positions?.length&&Number.isFinite(p.rank)}
function skill(p,k,base){if(k==='fg')return n(p,'fgm')!==null&&n(p,'fga')!==null?n(p,'fgm')-base.fg*n(p,'fga'):null;if(k==='ft')return n(p,'ftm')!==null&&n(p,'fta')!==null?n(p,'ftm')-base.ft*n(p,'fta'):null;let x=n(p,k);return x===null?null:k==='to'?-x:x}
function rates(players){const sum=k=>players.reduce((s,p)=>s+(n(p,k)||0),0);return {fg:sum('fga')?sum('fgm')/sum('fga'):.46,ft:sum('fta')?sum('ftm')/sum('fta'):.78}}
function recommend(players,availability,roster,needs,allowWaiver=false,limit=10){
 const base=rates(roster),pool=players.filter(p=>eligible(p)&&(availability[p.id]==='FA'||allowWaiver&&availability[p.id]==='W')&&needs.every(k=>skill(p,k,base)!==null));
 if(!pool.length)return [];
 const distributions=Object.fromEntries(needs.map(k=>{const a=pool.map(p=>skill(p,k,base)),mean=a.reduce((a,b)=>a+b,0)/a.length,sd=Math.sqrt(a.reduce((a,b)=>a+(b-mean)**2,0)/a.length)||1;return [k,{mean,sd}]}));
 return pool.map(p=>{const z=needs.reduce((s,k)=>s+(skill(p,k,base)-distributions[k].mean)/distributions[k].sd,0)/needs.length;return {player:p,score:z*.85+Math.max(0,(300-p.rank)/300)*.1+(p.participation||0)*.05-(p.injury==='Q'||p.injury==='GTD'?.3:0)}}).sort((a,b)=>b.score-a.score||a.player.rank-b.player.rank).slice(0,limit);
}
function fits(p,slot){if(slot==='Util')return true;if(slot==='G')return p.positions.some(x=>x==='PG'||x==='SG');if(slot==='F')return p.positions.some(x=>x==='SF'||x==='PF');return p.positions.includes(slot)}
function lineup(players,slots,date,schedule){
 const active=players.filter(p=>inScope(p)&&healthy(p)&&schedule[p.nba]?.includes(date)&&!inactiveSlot(p.slot)).sort((a,b)=>(a.rank??9999)-(b.rank??9999));
 const match=new Array(slots.length).fill(null);
 function assign(p,seen){for(let i=0;i<slots.length;i++){if(seen.has(i)||!fits(p,slots[i]))continue;seen.add(i);if(!match[i]||assign(match[i],seen)){match[i]=p;return true}}return false}
 active.forEach(p=>assign(p,new Set()));return {players:match.filter(Boolean),scheduled:active.length,benched:active.length-match.filter(Boolean).length};
}
function estimate(players){const sum={};for(const k of ['fgm','fga','ftm','fta','threes','pts','reb','ast','stl','blk','to'])sum[k]=players.every(p=>n(p,k)!==null)?players.reduce((s,p)=>s+n(p,k),0):null;sum.fg=sum.fga?sum.fgm/sum.fga:null;sum.ft=sum.fta?sum.ftm/sum.fta:null;return sum}
function totals(roster,slots,dates,schedule){const days=dates.map(d=>{const x=lineup(roster,slots,d,schedule);return {date:d,...x,stats:estimate(x.players)}});return {days,games:days.reduce((s,x)=>s+x.players.length,0)}}
function protectedPlayer(p,locks){return locks.has(p.id)||(p.rank!==null&&p.rank<=75)||(p.preRank!==null&&p.preRank<=50)}

function compareCategory(category, own, opponent) {
 if (!Number.isFinite(own) || !Number.isFinite(opponent)) return null;
 const margin = category === 'to' ? opponent - own : own - opponent;
 return Math.abs(margin) < 1e-9 ? 0 : Math.sign(margin);
}

function matchupScore(own, opponent) {
 const outcomes = Object.fromEntries(cats.map(category => [
  category, compareCategory(category, own[category], opponent[category])
 ]));
 const results = Object.values(outcomes);
 return {
  outcomes,
  wins: results.filter(result => result === 1).length,
  losses: results.filter(result => result === -1).length,
  known: results.some(result => result !== null)
 };
}

function matchupUpgrades({roster, players, availability, slots, dates, schedule, locks, own, opponent, selectedCategory}) {
 const score = matchupScore(own, opponent);
 const groups = cats.filter(category => {
  if (selectedCategory && category !== selectedCategory) return false;
  const outcome = score.outcomes[category];
  if (outcome === null || outcome > 0) return false;
  const sum = own[category] + opponent[category];
  return sum === 0 || Math.abs(own[category] - opponent[category]) <= sum * .035 + 1e-9;
 }).map(category => ({category, options: new Map()}));
 if (!groups.length) return [];

 const rosterIds = new Set(roster.map(player => player.id));
 const adds = players.filter(player => eligible(player) && availability[player.id] === 'FA' &&
  !rosterIds.has(player.id) && dates.some(date => schedule[player.nba]?.includes(date)));
 const drops = roster.filter(player => !protectedPlayer(player, locks) && !inactiveSlot(player.slot));
 for (const drop of drops) {
  const remaining = roster.filter(player => player.id !== drop.id);
  for (const add of adds) {
   const swapped = [...remaining, {...add, slot: drop.slot}];
   const appearances = dates.flatMap(date => lineup(swapped, slots, date, schedule).players);
   if (!appearances.some(player => player.id === add.id)) continue;
   const projected = estimate(appearances);
   const after = matchupScore(projected, opponent);
   for (const {category, options} of groups) {
    if (after.outcomes[category] !== 1) continue;
    const value = projected[category];
    const margin = category === 'to' ? opponent[category] - value : value - opponent[category];
    const previous = options.get(add.id);
    if (!previous || after.wins - after.losses > previous.score.wins - previous.score.losses ||
        (after.wins - after.losses === previous.score.wins - previous.score.losses && margin > previous.margin)) {
     options.set(add.id, {add, drop, value, margin, score: after});
    }
   }
  }
 }
 return groups.map(({category, options}) => ({
  category,
  options: [...options.values()].sort((a,b) =>
   (b.score.wins - b.score.losses) - (a.score.wins - a.score.losses) || b.margin - a.margin)
 }));
}

function optimize(roster,players,availability,slots,dates,schedule,locks,needs){
 const baseline=totals(roster,slots,dates,schedule),drops=roster.filter(p=>!protectedPlayer(p,locks)&&!inactiveSlot(p.slot)).sort((a,b)=>(b.rank??9999)-(a.rank??9999)).slice(0,4);
 const adds=recommend(players,availability,roster,needs,false,6).filter((entry,index)=>index===0||entry.score>=.25).map(entry=>entry.player);
 // Also inspect low-cost players with the largest remaining schedule, independent of category rank.
 players.filter(p=>eligible(p)&&availability[p.id]==='FA').sort((a,b)=>(schedule[b.nba]?.filter(d=>dates.includes(d)).length||0)-(schedule[a.nba]?.filter(d=>dates.includes(d)).length||0)||(a.rank??9999)-(b.rank??9999)).slice(0,18).forEach(p=>{if(!adds.some(a=>a.id===p.id))adds.push(p)});
 const plans=[];
 for(const drop of drops)for(const add of adds){
  if(roster.some(p=>p.id===add.id))continue;
  const projected=totals([...roster.filter(p=>p.id!==drop.id),{...add,slot:drop.slot}],slots,dates,schedule),gain=projected.games-baseline.games;
  if(gain<=0)continue;
  const before=estimate(baseline.days.flatMap(d=>d.players)),after=estimate(projected.days.flatMap(d=>d.players));
  const delta=Object.fromEntries(cats.map(k=>[k,before[k]===null||after[k]===null?null:after[k]-before[k]]));
  plans.push({drop,add,gain,delta,days:projected.days.map((d,i)=>({date:d.date,gain:d.players.length-baseline.days[i].players.length,delta:Object.fromEntries(cats.map(k=>[k,d.stats[k]===null||baseline.days[i].stats[k]===null?null:d.stats[k]-baseline.days[i].stats[k]]))})),rankCost:Math.max(0,(add.rank??999)-(drop.rank??999))});
 }
 return {baseline,plans:plans.sort((a,b)=>b.gain-a.gain||a.rankCost-b.rankCost).filter((p,i,a)=>a.findIndex(q=>q.add.id===p.add.id)===i).slice(0,6)};
}
const api={cats,normalize,inScope,healthy,eligible,recommend,rates,fits,lineup,estimate,totals,protectedPlayer,optimize,matchupScore,matchupUpgrades};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TeamEngine=api;
})(typeof window==='undefined'?{}:window);
