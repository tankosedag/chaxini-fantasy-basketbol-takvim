"""Chaxini public Yahoo league adapter. Run: pip install -r requirements.txt; python server.py.
Only reads public pages; never asks for Yahoo credentials or performs roster transactions.
"""
import concurrent.futures, datetime as dt, json, os, re, threading, time, uuid, traceback
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from urllib.request import Request, urlopen
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from lxml import html
ROOT=Path(__file__).resolve().parent
CACHE=ROOT/'cache';CACHE.mkdir(exist_ok=True)
LOCK=threading.Lock()
ALIASES={'NOP':'NO','NY':'NYK','GS':'GSW','SA':'SAS','UTAH':'UTA','WSH':'WAS','PHO':'PHX'}
def canon(x):return ALIASES.get(x,x)
def now():return dt.datetime.now(dt.timezone.utc).isoformat()
def season():
 d=dt.datetime.now(dt.timezone.utc);return d.year if d.month>=8 else d.year-1
def get(url):
 req=Request(url,headers={'User-Agent':'Mozilla/5.0 (compatible; Chaxini public league reader)'})
 with urlopen(req,timeout=30) as r:
  if urlparse(r.url).hostname not in {'basketball.fantasysports.yahoo.com','site.api.espn.com'}:raise ValueError('Kaynak giriş veya yönlendirme istiyor. Yalnızca herkese açık ligler okunabilir.')
  raw=r.read(8_000_000)
 return raw.decode('utf-8','replace')
def text(n):return ' '.join(n.text_content().split())
def num(v):
 try:return float(v.replace('%',''))
 except (ValueError,AttributeError):return None
def identity(cell):
 a=cell.xpath('.//a[@data-ys-playerid and @title]')
 if not a:return None
 a=a[0];label=text(a);sub=cell.xpath('.//div[contains(@class,"ysf-player-name")]//span[contains(@class,"Fz-xxs")]')
 m=re.search(r'\b([A-Z]{2,4})\s*-\s*([A-Z,]+)',' '.join(text(x) for x in sub) if sub else text(cell))
 status=cell.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," injury-status ")]')
 if not status:status=cell.xpath('.//span[contains(@class,"player-status")]//abbr')
 # Yahoo uses an abbreviation element or a specific status label, not notes text.
 st=''
 for el in cell.xpath('.//*[@title or @class]'):
  c=el.get('class','');v=text(el)
  if ('status' in c or 'injury' in c) and v in {'O','Q','P','GTD','D','INJ','IL','NA','OFS','SUSP'}:st=v;break
 return {'id':a.get('data-ys-playerid'),'name':label,'nba':canon(m.group(1)) if m else '', 'positions':m.group(2).split(',') if m else [],'injury':st,'newsUrl':f'https://sports.yahoo.com/nba/players/{a.get("data-ys-playerid")}/news'}
def parse_players(source):
 d=html.fromstring(source);result=[]
 for row in d.xpath('//table//tr[td[contains(concat(" ",normalize-space(@class)," ")," player ")]]'):
  cells=row.xpath('./td');pc=row.xpath('./td[contains(concat(" ",normalize-space(@class)," ")," player ")]')[0];p=identity(pc)
  if not p or len(cells)<21:continue
  vals=[text(c) for c in cells]
  p.update(gp=num(vals[5]),preRank=num(vals[6]),rank=num(vals[7]),rosteredPct=num(vals[8]))
  try:mm,ss=vals[9].split(':');p['mpg']=float(mm)+float(ss)/60
  except ValueError:p['mpg']=None
  stats={}
  for key,idx in [('fgm',10),('ftm',12)]:
   pair=vals[idx].split('/');stats[key]=num(pair[0]);stats[key.replace('m','a')]=num(pair[1]) if len(pair)==2 else None
  for key,idx in [('fg',11),('ft',13),('threes',14),('pts',15),('reb',16),('ast',17),('stl',18),('blk',19),('to',20)]:stats[key]=num(vals[idx])
  p['seasonTotals']=dict(stats);p['stats']={k:(v if k in {'fg','ft'} else v/p['gp'] if v is not None and p['gp'] else 0 if p['gp']==0 else None) for k,v in stats.items()};p['_availability']='FA' if vals[4]=='FA' else 'W' if re.match(r'^W\b',vals[4]) else 'owned';result.append(p)
 return result

def parse_rosters(source,league):
 d=html.fromstring(source);teams=[];lineups={}
 for t in d.xpath('//table[starts-with(@id,"Tst-team-")]'):
  tid=t.get('id').split('-')[-1];prev=t.getprevious();links=prev.xpath('.//a') if prev is not None else []
  name=text(links[0]) if links else 'Takım '+tid;ids=[];slots=[];line={}
  for row in t.xpath('.//tr[td]'):
   cells=row.xpath('./td');p=identity(cells[-1]);slot=text(cells[0])
   if p:ids.append(p['id']);line[p['id']]={'slot':slot,**p}
   if slot not in {'BN','IL','IL+','NA'}:slots.append(slot)
  teams.append({'id':tid,'name':name,'playerIds':ids,'slots':slots});lineups[tid]=line
 if not teams:raise ValueError('Kadro verisi okunamadı. Lig özel olabilir veya Yahoo sayfa düzeni değişmiş olabilir.')
 return teams,lineups

def team_games():
 obj=json.loads(get('https://site.api.espn.com/apis/v2/sports/basketball/nba/standings'));out={}
 if int(obj.get('season',{}).get('year',season()+1))!=season()+1:raise ValueError('NBA sezonu uyuşmuyor')
 for conf in obj.get('children',[]):
  for e in conf.get('standings',{}).get('entries',[]):
   ss={s['name']:s['value'] for s in e.get('stats',[]) if 'value' in s};gp=ss.get('gamesPlayed',ss.get('wins',0)+ss.get('losses',0));out[canon(e['team']['abbreviation'])]=int(gp)
 if len(out)<30:raise ValueError('NBA takım maç sayıları eksik')
 return out

def fetch_catalog(lid):
 allp={};base=f'https://basketball.fantasysports.yahoo.com/nba/{lid}/players?status=ALL&pos=P&stat1=S_S_{season()}&sort=AR&sdir=1&count='
 # Bounded pagination; require an empty page rather than silently accepting a partial pool.
 complete=False
 for block in range(0,1000,100):
  offsets=list(range(block,block+100,25))
  with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:pages=list(pool.map(lambda offset:parse_players(get(base+str(offset))),offsets))
  for page in pages:
   for p in page:allp[p['id']]=p
  if any(len(page)<25 for page in pages):complete=True;break
 if not allp or not complete:raise ValueError('Oyuncu havuzu tamamlanamadı; eksik havuzla öneri üretilmedi.')
 return list(allp.values())

def atomic(path,obj):
 tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(obj,ensure_ascii=False));tmp.replace(path)
def refresh(lid):
 if not re.fullmatch(r'\d{1,10}',lid):raise ValueError('Geçersiz lig numarası')
 teams,lineups=parse_rosters(get(f'https://basketball.fantasysports.yahoo.com/nba/{lid}/startingrosters'),lid)
 players=fetch_catalog(lid);available={p['id']:p.pop('_availability') for p in players};warnings=[]
 try:games=team_games()
 except Exception as e:games={};warnings.append('NBA takım maç sayıları alınamadı. %65 şartı doğrulanamayan oyuncular önerilmez.')
 byid={p['id']:p for p in players}
 for team in teams:
  for pid,metadata in lineups[team['id']].items():
   if pid not in byid:byid[pid]={**metadata,'stats':{},'gp':None,'mpg':None,'rank':None,'preRank':None,'rosteredPct':None}
   available[pid]='owned'
 for p in byid.values():
  gp=games.get(p['nba']);p['teamGp']=gp;p['participation']=p['gp']/gp if gp and p.get('gp') is not None and p['gp']<=gp else None
 stamp=now();catalog={'season':season(),'updatedAt':stamp,'players':list(byid.values()),'teamGames':games,'sources':['Yahoo season totals and per-appearance minutes','ESPN NBA standings'],'warnings':warnings,'dailyAddsAvailable':False}
 league={'id':lid,'name':'Yahoo ligi '+lid,'updatedAt':stamp,'teams':teams,'availability':available,'lineups':{k:{pid:v['slot'] for pid,v in line.items()} for k,line in lineups.items()},'publicOnly':True}
 title=html.fromstring(get(f'https://basketball.fantasysports.yahoo.com/nba/{lid}')).xpath('string(//title)');league['name']=title.split('|')[0].strip() or league['name']
 with LOCK:atomic(CACHE/f'catalog-{season()}.json',catalog);atomic(CACHE/f'league-{lid}.json',league)
 return {'catalog':catalog,'league':league}
# Long Yahoo downloads run outside HTTP requests. Clients poll a short job endpoint.
JOBS={}
JOB_LOCK=threading.Lock()
REFRESH_LOCK=threading.Lock()
def run_job(token,lid):
 try:
  with REFRESH_LOCK:result=refresh(lid)
  with JOB_LOCK:JOBS[token].update(state='done',result=result,finished=time.time())
 except Exception as e:
  traceback.print_exc()
  with JOB_LOCK:JOBS[token].update(state='error',error=str(e),finished=time.time())
def start_job(lid):
 with JOB_LOCK:
  for token,job in list(JOBS.items()):
   if job.get('finished',time.time())<time.time()-600:del JOBS[token]
  for token,job in JOBS.items():
   if job['lid']==lid and job['state']=='loading':return token
  if sum(j['state']=='loading' for j in JOBS.values())>=8:raise ValueError('Sunucu meşgul. Biraz sonra tekrar dene.')
  token=uuid.uuid4().hex;JOBS[token]={'lid':lid,'state':'loading'}
 threading.Thread(target=run_job,args=(token,lid),daemon=True).start()
 return token
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
 def end_headers(self):
  origin=self.headers.get('Origin','');allowed=os.getenv('ALLOWED_ORIGIN','')
  if origin and origin in [allowed,'http://localhost:8000','http://127.0.0.1:8000']:self.send_header('Access-Control-Allow-Origin',origin);self.send_header('Vary','Origin')
  super().end_headers()
 def do_GET(self):
  u=urlparse(self.path)
  if u.path=='/api/league':
   lid=parse_qs(u.query).get('id',[''])[0]
   force=parse_qs(u.query).get('refresh',['0'])[0]=='1'
   async_mode=parse_qs(u.query).get('async',['0'])[0]=='1'
   token=parse_qs(u.query).get('job',[''])[0]
   try:
    if not re.fullmatch(r'\d{1,10}',lid):raise ValueError('Geçerli Yahoo NBA lig bağlantısı gir.')
    if token:
     with JOB_LOCK:job=dict(JOBS.get(token,{}))
     if not job or job['lid']!=lid:self.reply(404,{'error':'Yükleme işlemi bulunamadı; sunucu yeniden başlamış olabilir. Tekrar yenile.'});return
     if job['state']=='done':self.reply(200,job['result'])
     elif job['state']=='error':self.reply(502,{'error':job['error']})
     else:self.reply(202,{'job':token,'state':'loading'})
     return
    if async_mode:
     token=start_job(lid);self.reply(202,{'job':token,'state':'loading'});return
    path=CACHE/f'league-{lid}.json';cp=CACHE/f'catalog-{season()}.json'
    if not force and path.exists() and cp.exists() and time.time()-path.stat().st_mtime<900 and time.time()-cp.stat().st_mtime<900:result={'league':json.loads(path.read_text()),'catalog':json.loads(cp.read_text())}
    else:result=refresh(lid)
    self.reply(200,result)
   except (BrokenPipeError,ConnectionResetError):return
   except Exception as e:
    traceback.print_exc();self.reply(502,{'error':str(e)})
  elif u.path.startswith('/cache/') or u.path.endswith(('.py','.txt')) and u.path!='/KURULUM.txt':self.send_error(404)
  else:super().do_GET()
 def reply(self,status,obj):
  b=json.dumps(obj,ensure_ascii=False).encode()
  try:
   self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
  except (BrokenPipeError,ConnectionResetError):
   self.close_connection=True

if __name__=='__main__':
 import argparse
 parser=argparse.ArgumentParser();parser.add_argument('--snapshot',help='Download a public league snapshot');args=parser.parse_args()
 if args.snapshot:
  result=refresh(args.snapshot);(ROOT/'team-snapshot.json').write_text(json.dumps(result,ensure_ascii=False));print('Snapshot:',len(result['catalog']['players']),'players;',len(result['league']['teams']),'teams')
 else:
  port=int(os.getenv('PORT','8000'));print(f'Chaxini: http://localhost:{port}',flush=True);ThreadingHTTPServer(('0.0.0.0',port),Handler).serve_forever()
