(function(root){
'use strict';
const cats=['pts','threes','reb','ast','stl','blk','to','fg','ft'];
const unavailable=new Set(['O','INJ','IL','NA','OFS','SUSP','D']);
const n=(p,k)=>Number.isFinite(p.stats?.[k])?p.stats[k]:null;

function normalize(p){
 const rawStats=p.rawStats||p.stats||{},rawMpg=Object.hasOwn(p,'rawMpg')?p.rawMpg:p.mpg;
 const valid=Number.isFinite(p.gp)&&Number.isFinite(p.teamGp)&&p.teamGp>0&&p.gp>=0&&p.gp<=p.teamGp;
 const ratio=valid?p.gp/p.teamGp:null,stats={...rawStats};
 for(const k of ['fgm','fga','ftm','fta','threes','pts','reb','ast','stl','blk','to'])stats[k]=valid?(Number.isFinite(p.seasonTotals?.[k])?p.seasonTotals[k]/p.teamGp:p.gp===0?0:Number.isFinite(rawStats[k])?rawStats[k]*ratio:null):null;
 return {...p,rawStats,rawMpg,stats,mpg:valid?(p.gp===0?0:Number.isFinite(rawMpg)?rawMpg*ratio:null):null,participation:ratio,averagesBasis:'nba-team-games',averagePrecision:p.seasonTotals?'season-totals':'rounded-yahoo-averages'};
}

function inScope(p){return p.injury!=='NA'&&Number.isFinite(p.mpg)&&p.mpg>=10}
function healthy(p){return !unavailable.has(p.injury)}
function eligible(p){return inScope(p)&&healthy(p)&&Number.isFinite(p.participation)&&p.participation>=.65&&p.gp>0&&p.positions?.length&&Number.isFinite(p.rank)}
function skill(p,k,base){if(k==='fg')return n(p,'fgm')!==null&&n(p,'fga')!==null?n(p,'fgm')-base.fg*n(p,'fga'):null;if(k==='ft')return n(p,'ftm')!==null&&n(p,'fta')!==null?n(p,'ftm')-base.ft*n(p,'fta'):null;let x=n(p,k);return x===null?null:k==='to'?-x:x}
function rates(players){const sum=k=>players.reduce((s,p)=>s+(n(p,k)||0),0);return {fg:sum('fga')?sum('fgm')/sum('fga'):.46,ft:sum('fta')?sum('ftm')/sum('fta'):.78}}
function recommend(players,availability,roster,needs,allowWaiver=false){
 const base=rates(roster),pool=players.filter(p=>eligible(p)&&(availability[p.id]==='FA'||allowWaiver&&availability[p.id]==='W')&&needs.every(k=>skill(p,k,base)!==null));
 if(!pool.length)return [];
 const distributions=Object.fromEntries(needs.map(k=>{const a=pool.map(p=>skill(p,k,base)),mean=a.reduce((a,b)=>a+b,0)/a.length,sd=Math.sqrt(a.reduce((a,b)=>a+(b-mean)**2,0)/a.length)||1;return [k,{mean,sd}]}));
 return pool.map(p=>{const z=needs.reduce((s,k)=>s+(skill(p,k,base)-distributions[k].mean)/distributions[k].sd,0)/needs.length;return {player:p,score:z*.85+Math.max(0,(300-p.rank)/300)*.1+(p.participation||0)*.05-(p.injury==='Q'||p.injury==='GTD'?.3:0)}}).sort((a,b)=>b.score-a.score||a.player.rank-b.player.rank).filter((x,i)=>i===0||x.score>=.25).slice(0,6);
}
function fits(p,slot){if(slot==='Util')return true;if(slot==='G')return p.positions.some(x=>x==='PG'||x==='SG');if(slot==='F')return p.positions.some(x=>x==='SF'||x==='PF');return p.positions.includes(slot)}
function lineup(players,slots,date,schedule){
 const active=players.filter(p=>inScope(p)&&healthy(p)&&schedule[p.nba]?.includes(date)&&!['IL','IL+','NA'].includes(p.slot)).sort((a,b)=>(a.rank??9999)-(b.rank??9999));
 const match=new Array(slots.length).fill(null);
 function assign(p,seen){for(let i=0;i<slots.length;i++){if(seen.has(i)||!fits(p,slots[i]))continue;seen.add(i);if(!match[i]||assign(match[i],seen)){match[i]=p;return true}}return false}
 active.forEach(p=>assign(p,new Set()));return {players:match.filter(Boolean),scheduled:active.length,benched:active.length-match.filter(Boolean).length};
}
function estimate(players){const sum={};for(const k of ['fgm','fga','ftm','fta','threes','pts','reb','ast','stl','blk','to'])sum[k]=players.every(p=>n(p,k)!==null)?players.reduce((s,p)=>s+n(p,k),0):null;sum.fg=sum.fga?sum.fgm/sum.fga:null;sum.ft=sum.fta?sum.ftm/sum.fta:null;return sum}
function totals(roster,slots,dates,schedule){const days=dates.map(d=>{const x=lineup(roster,slots,d,schedule);return {date:d,...x,stats:estimate(x.players)}});return {days,games:days.reduce((s,x)=>s+x.players.length,0)}}
function protectedPlayer(p,locks){return locks.has(p.id)||(p.rank!==null&&p.rank<=75)||(p.preRank!==null&&p.preRank<=50)}
function optimize(roster,players,availability,slots,dates,schedule,locks,needs){
 const baseline=totals(roster,slots,dates,schedule),drops=roster.filter(p=>!protectedPlayer(p,locks)&&!['IL','IL+','NA'].includes(p.slot)).sort((a,b)=>(b.rank??9999)-(a.rank??9999)).slice(0,4);
 const adds=recommend(players,availability,roster,needs,false).map(x=>x.player);
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
const api={cats,normalize,inScope,healthy,eligible,recommend,rates,fits,lineup,estimate,totals,protectedPlayer,optimize};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TeamEngine=api;
})(typeof window==='undefined'?{}:window);
