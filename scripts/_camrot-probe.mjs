// 🎥 착석 중 카메라 회전 재현 — 합성 드래그 전후 방위각 비교 (서있음 vs 벤치 착석)
import http from 'http'; import fs from 'fs'; import path from 'path';
const REPO='/Users/mini/dev/super-agent-party-main';
const PORT=8926;
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.glb':'application/octet-stream'};
const server=http.createServer((req,res)=>{const url=decodeURIComponent(req.url.split('?')[0]);const base=url.startsWith('/vrm/')?REPO:path.join(REPO,'static');const fp=path.normalize(path.join(base,url));if(!fp.startsWith(base)||!fs.existsSync(fp)||!fs.statSync(fp).isFile()){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'application/octet-stream'});fs.createReadStream(fp).pipe(res);});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
const {chromium}=await import('playwright');
const b=await chromium.launch({headless:true,args:['--use-angle=metal']});
const pg=await (await b.newContext({viewport:{width:1100,height:700}})).newPage();
await pg.goto(`http://127.0.0.1:${PORT}/world.html?weather=clear&hour=12&stats=1`,{waitUntil:'load'});
await pg.waitForTimeout(9000);
const az=()=>pg.evaluate(async ()=>{const d=window.__worldDev;const c=d.camera||null;if(!c)return null;const t=d.controls?d.controls.target:null;if(!t)return null;return Math.atan2(c.position.x-t.x,c.position.z-t.z);});
const drag=async()=>{ await pg.mouse.move(550,250); await pg.mouse.down(); for(let i=1;i<=10;i++){await pg.mouse.move(550+i*18,250,{steps:1}); await pg.waitForTimeout(16);} await pg.mouse.up(); await pg.waitForTimeout(300); };
// 대조군: 조종+서있음
await pg.evaluate(()=>window.__worldDev.possessGo('chick', -3.1, -11.9, 0));
await pg.waitForTimeout(600);
const a0=await az(); await drag(); const a1=await az();
console.log('서있음 회전 Δ:', a0!==null?(a1-a0).toFixed(3):'(camera 훅 없음)');
// 실험군: 벤치 착석
await pg.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Control'})));
let st=null;
for(let i=0;i<24;i++){await pg.waitForTimeout(500);st=await pg.evaluate(()=>window.__worldDev.meadowState());if(st&&st.find(r=>r[0]==='chick'&&r[1]&&r[2]==='lying'))break;}
console.log('착석:',JSON.stringify(st));
const b0=await az(); await drag(); const b1=await az();
console.log('착석 회전 Δ:', b0!==null?(b1-b0).toFixed(3):'(camera 훅 없음)');
await b.close();server.close();
