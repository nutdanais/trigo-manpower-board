"use strict";
const fs=require("fs"),path=require("path");
const {chromium}=require("playwright"), QRCode=require("qrcode");
const h=require("../../tests/e2e/harness");
const ROOT=path.resolve(__dirname,"../.."),OUT=path.join(ROOT,"docs/user-manual"),SHOTS=path.join(OUT,"screens");
const config=JSON.parse(fs.readFileSync(path.join(__dirname,"content.json"),"utf8"));
fs.mkdirSync(SHOTS,{recursive:true});
const registry={};
const ADMIN={id:"00000000-0000-0000-0000-0000000000ad",email:"demo.admin@example.com",role:"admin"};
function data(file){return "data:image/png;base64,"+fs.readFileSync(file).toString("base64");}
function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
async function shot(p,name,selector,highlight){
 await p.waitForTimeout(250);await p.evaluate(()=>document.fonts.ready);
 const root=selector?p.locator(selector).first():null;
 let box=root?await root.boundingBox():{x:0,y:0,...p.viewportSize()};
 if(!box)throw new Error("No visible screenshot target "+name);
 const marks=[];
 for(const sel of highlight||[]){
  const l=p.locator(sel).first();if(await l.count()&&await l.isVisible()){
   const b=await l.boundingBox();marks.push({x:b.x-box.x,y:b.y-box.y,w:b.width,h:b.height});
  }
 }
 const file=path.join(SHOTS,name+".png");
 if(root)await root.screenshot({path:file});else await p.screenshot({path:file});
 registry[name]={w:box.width,h:box.height,marks,file:"screens/"+name+".png"};
 console.log("SCREEN "+name);
 fs.writeFileSync(path.join(OUT,"screens.json"),JSON.stringify(registry,null,2));
}
async function close(p){await p.evaluate(()=>{closeModal();hideContextMenu();});await p.keyboard.press("Escape");}
async function view(p,id){await close(p);await p.evaluate(async id=>{D().activeBoardId=id;clearSelection();await refreshAndRender();window.scrollTo(0,0);},id);}
async function date(p,d){await close(p);await p.evaluate(async d=>{state.date=d;clearSelection();await refreshAndRender();window.scrollTo(0,0);},d);}
async function capture(){
 const env=await h.launch();try{
 const db=new h.FakeDb(),today=h.iso(new Date()),day=h.nextWorking(today),future=h.nextWorking(day);
 h.seedBase(db,{src:today});
 db.seed("profiles",[{id:ADMIN.id,email:ADMIN.email,full_name:"Demo Admin",display_name:"Demo.Admin",role_key:"admin",status:"active"}]);
 const th=["สมชาย ใจดี","สมศรี มีสุข","อนันต์ เก่งงาน","มาลี แสงทอง","วิชัย รักดี","พรทิพย์ ยิ้มแย้ม","กิตติ ตั้งใจ","นภา สุขใจ","ณัฐพล มั่นคง","ปวีณา สายชล"];
 const en=["Somchai Jaidee","Somsri Meesuk","Anan Kengngan","Malee Saengthong","Wichai Rakdee","Porntip Yimyaem","Kitti Tangjai","Napa Sukjai","Nattapon Mankong","Paweena Saichon"];
 db.t("employees").forEach((e,i)=>Object.assign(e,{name_th:th[i],name_en:en[i],trigo_id:"T"+(101+i),position:"inspector",start_date:i===7?null:"2023-01-09"}));
 db.t("boards")[0].name="Non-Rayong";db.t("boards")[1].name="Rayong";
 db.t("hosts").forEach(x=>Object.assign(x,{location:"Chonburi, Thailand",area_id:"area-1",note:"Example: safety shoes and helmet",map_url:"https://www.google.com/maps/search/?api=1&query=Chonburi+Thailand"}));
 db.seed("missions",[{id:"s104",board_id:"b1",plan_date:today,number:"104",host:"Host Beta",customer:"Example customer",shift:"day",engineer_id:"eng-2"},{id:"s105",board_id:"b1",plan_date:today,number:"105",host:"Host Gamma",customer:"Example customer",shift:"day",engineer_id:"eng-1",hidden:true}]);
 const a=await env.openAs(db,ADMIN,{viewport:{width:1440,height:900}}),p=a.page;p.setDefaultTimeout(14000);
 await shot(p,"empty",null,["#btn-reset-board"]);
 await p.click("#btn-reset-board");await p.waitForSelector("#missions-grid .mission-card");
 await shot(p,"board",null,["#btn-board-dd","#mode-pill","#btn-date"]);
 await p.click("#btn-board-dd");await shot(p,"board-menu",null,["#board-menu"]);await p.keyboard.press("Escape");
 await p.click("#btn-filter-pop");await shot(p,"filter",null,["#filter-pop"]);await p.keyboard.press("Escape");await p.mouse.click(700,400);
 await p.click("#btn-new-mission");
 await p.fill("#form-mission [name=number]","DEMO.26.0006");await p.fill("#form-mission [name=host]","Host Alpha");await p.fill("#form-mission [name=customer]","Example customer");await p.fill("#form-mission [name=ppe]","Safety shoes, helmet");await p.fill("#form-mission [name=engineer]","Eng One");
 await shot(p,"mission","#modal-mission",["#form-mission [name=shift]","#form-mission button[type=submit]"]);await close(p);
 await p.locator(".mission-header").first().click();await shot(p,"mission-edit","#modal-mission",["#btn-hide-mission","#btn-delete-mission"]);await close(p);
 await p.click("#btn-hide-missions");await shot(p,"hide","#modal-hide-missions",["#hide-missions-summary"]);await close(p);
 await p.evaluate(()=>showContextMenu(D().employees.find(e=>e.id==="e6"),900,260));
 await p.locator("#context-menu .ctx-item").filter({hasText:"Assign to mission"}).click();await shot(p,"assign",null,["#context-menu"]);await close(p);
 await shot(p,"leave",null,["#leave-tabs"]);
 await p.click("#btn-new-employee");await p.fill("#form-employee [name=name]","ชาญชัย ตัวอย่าง");await p.fill("#form-employee [name=nameEn]","Chanchai Example");
 await shot(p,"employee","#modal-employee",["#form-employee [name=trigoId]"]);await close(p);
 await p.click("#board-tabs .tab-emplist");await shot(p,"manpower",null,["#emplist-area-bar"]);
 await p.click("#btn-emplist-bulk");await shot(p,"bulk","#modal-bulk");await close(p);
 await p.click("#board-tabs .tab-hostlist");await shot(p,"hosts",null);
 await p.click("#board-tabs .tab-overview");await shot(p,"overview",null,["#btn-ov-board"]);
 const hist=p.locator(".ov-history-controls").first();if(await hist.count()){await hist.scrollIntoViewIfNeeded();await shot(p,"overview-history",null);}else throw new Error("History controls missing");
 await p.click("#board-tabs .tab-orgchart");await p.selectOption("#oc-level","all");await shot(p,"orgchart",null);
 await p.click("#btn-export");await p.check('#board-export-type input[value="pptx"]');await shot(p,"orgchart-export","#modal-xlsx");await close(p);
 await view(p,"b1");
 await p.click("#btn-lock");if(await p.locator("#modal-confirm:not(.hidden)").count())await p.click("#btn-confirm-yes");
 await shot(p,"locked",null,["#mode-pill","#btn-lock"]);
 await p.click("#btn-lock");if(await p.locator("#modal-confirm:not(.hidden)").count())await p.click("#btn-confirm-yes");
 await date(p,future);await p.click("#btn-reset-board");await p.waitForSelector("#missions-grid .mission-card");await shot(p,"forecast",null,["#mode-pill","#btn-forecast-copy"]);
 await date(p,day);
 db.seed("forecast_missions",[{id:"f101",board_id:"b1",plan_date:day,number:"101",host:"Host Alpha",customer:"Cust Alpha",shift:"day",engineer_id:"eng-1",created_by:h.USERS.b.email}]);
 db.seed("forecast_assignments",[{employee_id:"e3",plan_date:day,forecast_mission_id:"f101",zone:null,held_by:h.USERS.b.email}]);
 await p.evaluate(()=>refreshAndRender());await p.locator(".plan-banner-forecast button").filter({hasText:/Review/}).click();await shot(p,"merge","#modal-merge");await close(p);
 await p.click("#board-tabs .tab-capacity");await p.click("#btn-cap-seed");if(await p.locator("#modal-confirm:not(.hidden)").count())await p.click("#btn-confirm-yes");await p.waitForSelector(".cap-hostrow");
 await shot(p,"capacity",null,["#cap-board-switch","#cap-range"]);
 await p.locator(".cap-avail-btn").first().click();await shot(p,"capacity-details",null,[".cap-pop"]);await p.keyboard.press("Escape");
 await view(p,"b1");await p.click("#btn-export");await p.check('#board-export-type input[value="pdf"]');await shot(p,"export-pdf","#modal-xlsx");await p.check('#board-export-type input[value="xlsx"]');await shot(p,"export-excel","#modal-xlsx");await close(p);
 await p.click("#btn-settings");await p.click('.settings-tab[data-tab="account"]');await shot(p,"settings",null,["#settings-tabs","#btn-change-password"]);
 await p.fill("#acct-display-name","Demo.Planner");await shot(p,"settings-draft",null,["#btn-sv-save","#btn-sv-discard"]);await p.click("#btn-sv-discard");
 for(const [tab,name] of [["boards","settings-boards"],["users","settings-users"],["roles","settings-roles"]]){await p.click('.settings-tab[data-tab="'+tab+'"]');await shot(p,name,null);}
 await p.click("#btn-settings-back");
 const browser=p.context().browser();
 const loginCtx=await browser.newContext({viewport:{width:390,height:844}}),login=await loginCtx.newPage();
 await login.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",r=>r.fulfill({contentType:"text/javascript",body:fs.readFileSync(path.join(ROOT,"tests/fake/fake-client.js"),"utf8")}));
 await login.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.fulfill({contentType:"text/css",body:""}));
 await login.goto(env.base);await login.waitForSelector("#form-login");await shot(login,"login",".login-box");await login.click("#btn-request-access");await shot(login,"request",".login-box");await loginCtx.close();
 const mc=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),mp=await mc.newPage();
 await mp.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",r=>r.fulfill({contentType:"text/javascript",body:fs.readFileSync(path.join(ROOT,"tests/fake/fake-client.js"),"utf8")}));
 await mp.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.fulfill({contentType:"text/css",body:""}));
 await mp.exposeFunction("__fakeSupabaseExec",q=>db.exec(q,ADMIN));
 await mp.addInitScript(u=>{window.__fakeSession={user:{id:u.id,email:u.email},access_token:"fake"};localStorage.setItem("mpm-last-view",JSON.stringify({boardId:"b1"}));},ADMIN);
 await mp.goto(env.base);await mp.waitForSelector("#bottom-nav .bn-item");await shot(mp,"phone-board");
 await mp.click("#m-more");await shot(mp,"phone-more");await mp.evaluate(()=>document.body.click());
 await mp.click("#btn-bn-more");await shot(mp,"phone-me");await mp.evaluate(()=>closeMoreMenu());
 await mp.click("#fp-drawer-handle");await mp.locator('#float-pool [data-emp-id="e6"]').first().tap();await shot(mp,"phone-drawer");
 await mp.click("#fp-drawer-handle");await mp.evaluate(()=>clearSelection());
 await mp.locator("#bottom-nav .bn-item").filter({hasText:"Manpower"}).click();await shot(mp,"phone-manpower");
 await mp.click("#btn-bn-more");await mp.locator("#bn-more .tb-item").filter({hasText:"Capacity"}).click();await shot(mp,"phone-capacity");
 await mc.close();
 fs.writeFileSync(path.join(OUT,"capture-info.json"),JSON.stringify({appVersion:config.version,appCommit:config.appCommit,date:day,screenshots:Object.keys(registry).length,source:"Real repository app, synthetic demonstration records; desktop 1440x900 and emulated phone 390x844"},null,2));
 }finally{await env.close();}
}
function getFont(bold){
 const dir="/usr/share/fonts/truetype/noto";
 const f=path.join(dir,"NotoSansThai-"+(bold?"Bold":"Regular")+".ttf");
 if(!fs.existsSync(f))throw new Error("Thai font unavailable: "+f);
 return "data:font/ttf;base64,"+fs.readFileSync(f).toString("base64");
}
const CSS=[
"@font-face{font-family:Thai;src:url(FONT)}@font-face{font-family:Thai;src:url(BOLD);font-weight:700}",
"*{box-sizing:border-box}body{margin:0;font-family:Thai,Arial,sans-serif;color:#13222F;background:#D8E0E7}@page{size:1600px 900px;margin:0}",
".slide{position:relative;width:1600px;height:900px;background:white;overflow:hidden;break-after:page}.slide:last-child{break-after:auto}",
".rail{position:absolute;inset:0 auto 0 0;width:350px;background:#062A44;color:white;padding:40px 28px}.logo{width:190px;height:48px;object-fit:contain;object-position:left center}.rail h2{font-size:25px;line-height:1.4;margin:30px 0 24px}",
".step{display:flex;gap:13px;margin-bottom:25px}.num{width:36px;height:36px;flex:none;border-radius:50%;background:white;color:#062A44;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700}.step h3{margin:0 0 7px;font-size:21px;line-height:1.45}.step p{margin:0;font-size:18px;line-height:1.6;color:#D8E0E7}.role{position:absolute;bottom:32px;left:28px;right:28px;border-top:1px solid #5C707F;padding-top:14px;color:#D8E0E7;font-size:13px}",
".main{position:absolute;left:404px;right:54px;top:42px;bottom:60px}.top{display:flex;justify-content:space-between;font-size:15px;color:#5C707F;line-height:1.5}.lang{border:1px solid #D8E0E7;padding:3px 14px;border-radius:999px}.main h1{font-size:39px;line-height:1.35;margin:21px 0 0;letter-spacing:-.4px}",
".visual{position:absolute;left:0;right:0;top:146px;height:536px;border:1px solid #D8E0E7;border-radius:13px;background:#F2F5F8;overflow:hidden;display:flex;align-items:flex-start;justify-content:center}.visual.contain{align-items:center}.wrap{position:relative;flex:none}.wrap img{width:100%;display:block}.wrap svg{position:absolute;inset:0;width:100%;height:100%}.tip{position:absolute;left:0;right:0;top:699px;padding:14px 18px;border:1px solid #F0D77E;background:#FFF3CC;color:#7A5B00;border-radius:10px;font-size:18px;line-height:1.6}",
".footer{position:absolute;left:404px;right:54px;bottom:20px;display:flex;justify-content:space-between;border-top:1px solid #D8E0E7;padding-top:10px;font-size:12px;color:#5C707F}.footer a{color:#5C707F;text-decoration:none}",
".cover h1{font-size:62px;line-height:1.3;margin-top:42px}.cover p{font-size:26px;color:#5C707F;line-height:1.7}.cover .hero{margin-top:30px;height:395px;border:1px solid #D8E0E7;border-radius:13px;overflow:hidden}.hero img{width:100%}.cover .rail p{font-size:20px;color:#D8E0E7;line-height:1.65}.toc{position:absolute;top:150px;left:0;right:0;display:grid;grid-template-columns:1fr 1fr;gap:20px}.toc section{padding:20px;border:1px solid #D8E0E7;border-radius:12px;background:#F2F5F8}.toc h3{font-size:23px;margin:0 0 12px}.toc p{font-size:18px;line-height:1.8;margin:0}.toc a{color:#062A44;text-decoration:none}",
".qrline{position:absolute;top:572px;left:0;right:0;height:120px;display:flex;align-items:center;gap:22px;border:1px solid #D8E0E7;border-radius:12px;padding:10px 20px}.qrline img{width:100px;height:100px}.qrline a{font-size:24px;color:#062A44;text-decoration:none}.qrline p{font-size:17px;color:#5C707F;margin:0 0 4px}.access .visual{height:408px;align-items:center}.phoneframe{height:490px;width:228px;border:3px solid #062A44;border-radius:18px;overflow:hidden;background:white;flex:none}.phoneframe img{width:100%;display:block}.phonegrid{width:100%;height:100%;display:flex;align-items:center;justify-content:center;gap:35px;padding:18px}.flow{width:620px}.flow h3{font-size:26px;margin:0 0 18px}.flow div{background:white;border:1px solid #D8E0E7;border-radius:10px;padding:14px 22px;margin-bottom:17px;font-size:23px}.flow p{font-size:15px;color:#5C707F;line-height:1.6}",
".phone-label{font-size:16px;color:#5C707F;text-align:center;margin-top:9px}"
].join("\n");
function frame(key){
 const r=registry[key];if(!r)throw new Error("Missing screenshot "+key);
 const small=r.w<1200,width=small?Math.min(1138,532*r.w/r.h):1138,height=width*r.h/r.w;
 const boxes=r.marks.filter(b=>b.w<r.w*.95&&b.h<r.h*.8).map(b=>'<rect x="'+b.x+'" y="'+b.y+'" width="'+b.w+'" height="'+b.h+'" rx="6" fill="none" stroke="#E8960C" stroke-width="3"/>').join("");
 return '<div class="visual '+(small?'contain':'')+'"><div class="wrap" style="width:'+width+'px;height:'+height+'px"><img src="'+data(path.join(OUT,r.file))+'"><svg viewBox="0 0 '+r.w+' '+r.h+'">'+boxes+'</svg></div></div>';
}
function rail(lang,group,steps,role){
 const label=lang==="en"?(role==="admin"?"ADMINISTRATORS":role==="edit"?"EDIT ACCESS REQUIRED":"ALL USERS · SUBJECT TO ROLE"):(role==="admin"?"ผู้ดูแลระบบ":role==="edit"?"ต้องมีสิทธิ์แก้ไข":"ผู้ใช้ทุกคน · ตามสิทธิ์");
 return '<aside class="rail"><img class="logo" src="'+data(path.join(ROOT,"trigo-design-system/logo.png"))+'"><h2>'+esc(group)+'</h2>'+steps.map((s,i)=>{const parts=s.split("|");return '<div class="step"><div class="num">'+(i+1)+'</div><div><h3>'+esc(parts[0])+'</h3><p>'+esc(parts[1]||"")+'</p></div></div>';}).join("")+'<div class="role">'+label+'</div></aside>';
}
function footer(lang,i,n,extra){
 return '<div class="footer"><span>TRIGO · '+config.version+' · '+(lang==="en"?"Real app / example data":"ภาพแอปจริง / ข้อมูลตัวอย่าง")+(extra||"")+'</span><span>'+lang.toUpperCase()+" "+String(i).padStart(2,"0")+"/"+n+'</span></div>';
}
function phoneVisual(l,lang){
 const img=data(path.join(SHOTS,l.image+".png"));
 if(l.kind==="android"||l.kind==="iphone"){
  const android=l.kind==="android",flow=android?["Chrome · ⋮","Install and create shortcut","Install / Create shortcut → Add"]:["Safari · Share","Add to Home Screen","Open as Web App → Add"];
  const cap=lang==="en"?"Menu flow diagram, not a browser screenshot. Labels vary by browser version.":"แผนภาพลำดับเมนู ไม่ใช่ภาพหน้าจอเบราว์เซอร์ ชื่ออาจต่างตามรุ่น";
  return '<div class="visual contain"><div class="phonegrid"><div class="phoneframe"><img src="'+img+'"></div><div class="flow"><h3>'+ (android?"Android Chrome":"iPhone Safari")+'</h3>'+flow.map(t=>'<div>'+esc(t)+'</div>').join("")+'<p>'+cap+'</p></div></div></div>';
 }
 const second=l.key==="phone-nav"?"phone-me":l.key==="phone-place"?"phone-more":l.key==="phone-lists"?"phone-board":null;
 return '<div class="visual contain"><div class="phonegrid"><div><div class="phoneframe"><img src="'+img+'"></div></div>'+(second?'<div><div class="phoneframe"><img src="'+data(path.join(SHOTS,second+".png"))+'"></div></div>':'')+'<div class="flow" style="width:380px"><h3>'+(lang==="en"?"Use the phone controls":"ใช้ปุ่มสำหรับมือถือ")+'</h3><p style="font-size:23px">'+esc(l[lang][3])+'</p><p>'+(lang==="en"?"Real app in a 390px emulated phone viewport.":"ภาพแอปจริงในขนาดหน้าจอมือถือจำลอง 390px")+'</p></div></div></div>';
}
async function render(){
 const browser=await chromium.launch();try{
 const p=await browser.newPage({viewport:{width:1600,height:900}});
 const qr=await QRCode.toDataURL(config.url,{errorCorrectionLevel:"M",margin:4,width:370});
 const css=CSS.replace("FONT",getFont(false)).replace("BOLD",getFont(true));
 const n=config.lessons.length+2;const validations=[];
 for(const lang of ["en","th"]){
  const pages=[],brand=data(path.join(ROOT,"trigo-design-system/logo.png")),welcome=lang==="en"?"WELCOME":"ยินดีต้อนรับ",title=lang==="en"?"New user manual":"คู่มือสำหรับผู้ใช้ใหม่";
  const intro=lang==="en"?"Follow the numbered steps beside the screenshots. English button names match the app.":"ทำตามขั้นตอนข้างภาพหน้าจอ ชื่อปุ่มภาษาอังกฤษตรงกับปุ่มในแอป";
  pages.push('<section class="slide cover"><aside class="rail"><img class="logo" src="'+brand+'"><h2>'+welcome+'</h2><p>'+intro+'</p><div class="role">'+(lang==="en"?"Direction B · English":"รูปแบบ B · ภาษาไทย")+'</div></aside><div class="main"><div class="top"><span>UPDATED '+config.updated+' · '+config.version+'</span><span class="lang">'+lang.toUpperCase()+'</span></div><h1>'+title+'</h1><p>TRIGO Manpower Board<br>'+(lang==="en"?"Access. Plan. Assign. Share.":"เข้าใช้งาน วางแผน จัดคน และแชร์")+'</p><div class="hero"><img src="'+data(path.join(SHOTS,"board.png"))+'"></div></div>'+footer(lang,1,n)+'</section>');
  const groups=lang==="en"?[["Get started & new design",["access","android","design","phone-nav"]],["Daily planning & people",["carry","mission","hide","phone-place"]],["Lists & reading the plan",["manpower","bulk","overview","orgchart"]],["Advanced, export & settings",["capacity","pptx","settings","settings-save"]]]:[["เริ่มต้นและรูปแบบใหม่",["access","android","design","phone-nav"]],["วางแผนและจัดคน",["carry","mission","hide","phone-place"]],["รายการและการอ่านแผน",["manpower","bulk","overview","orgchart"]],["แผนล่วงหน้า ส่งออก และตั้งค่า",["capacity","pptx","settings","settings-save"]]];
  const toc=groups.map(g=>'<section><h3>'+esc(g[0])+'</h3><p>'+g[1].map(key=>{const i=config.lessons.findIndex(l=>l.key===key);return '<a href="#'+key+'">'+esc(config.lessons[i][lang][0])+' · '+(i+3)+'</a><br>';}).join("")+'</p></section>').join("");
  const guide=lang==="en"?["First-time user|Start with access, mobile setup and the updated navigation.","Viewer|Read permitted views and export; editing commands require permission.","Planner / admin|Continue to assignments, forecasting, Settings and administration."]:["ผู้ใช้ครั้งแรก|เริ่มจากเข้าระบบ ตั้งค่ามือถือ และการนำทางใหม่","Viewer|อ่านและส่งออกหน้าที่ได้รับสิทธิ์ คำสั่งแก้ไขต้องมีสิทธิ์","ผู้วางแผน / ผู้ดูแล|ดูการจัดคน Forecast Settings และการจัดการผู้ใช้"];
  pages.push('<section class="slide">'+rail(lang,lang==="en"?"START HERE":"เริ่มที่นี่",guide,"all")+'<div class="main"><div class="top"><span>QUICK NAVIGATION</span><span class="lang">'+lang.toUpperCase()+'</span></div><h1>'+(lang==="en"?"Find the steps you need":"เลือกขั้นตอนที่ต้องการ")+'</h1><div class="toc">'+toc+'</div><div class="tip">'+(lang==="en"?"Your admin controls permissions. Chapters for editors and administrators are marked.":"ผู้ดูแลกำหนดสิทธิ์ บทสำหรับผู้แก้ไขและผู้ดูแลมีป้ายระบุ")+'</div></div>'+footer(lang,2,n)+'</section>');
  config.lessons.forEach((l,j)=>{
   const t=l[lang],isAccess=l.kind==="access";let visual,extra="";
   if(isAccess){
    visual='<div class="visual contain"><img style="height:388px;width:auto" src="'+data(path.join(SHOTS,"login.png"))+'"></div><div class="qrline"><img src="'+qr+'"><div><p>'+(lang==="en"?"Scan with your phone camera or tap the link":"สแกนด้วยกล้องมือถือ หรือแตะลิงก์")+'</p><a href="'+config.url+'">'+config.url+'</a></div></div>';
   }else if(["phone","android","iphone"].includes(l.kind)){
    visual=phoneVisual(l,lang);
    if(l.kind==="android")extra=' · <a href="https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid">Chrome Help</a>';
    if(l.kind==="iphone")extra=' · <a href="https://support.apple.com/guide/iphone/iphea86e5236/ios">Apple Support</a>';
   }else visual=frame(l.image);
   pages.push('<section class="slide '+(isAccess?"access":"")+'" id="'+l.key+'">'+rail(lang,t[1],t[2],l.role)+'<div class="main"><div class="top"><span>TRIGO MANPOWER BOARD / '+(j+1)+'</span><span class="lang">'+lang.toUpperCase()+'</span></div><h1>'+esc(t[0])+'</h1>'+visual+'<div class="tip">'+esc(t[3])+'</div></div>'+footer(lang,j+3,n,extra)+'</section>');
  });
  const html='<!doctype html><html lang="'+lang+'"><head><meta charset="utf-8"><title>TRIGO User Manual '+lang.toUpperCase()+'</title><style>'+css+'</style></head><body>'+pages.join("")+'</body></html>';
  fs.writeFileSync(path.join(OUT,"TRIGO-User-Manual-"+lang.toUpperCase()+".html"),html);
  await p.setContent(html,{waitUntil:"load"});await p.evaluate(()=>document.fonts.ready);
  const issues=await p.evaluate(()=>[...document.querySelectorAll(".slide")].flatMap((s,i)=>{
   const r=s.getBoundingClientRect(),steps=s.querySelectorAll(".step"),tip=s.querySelector(".tip"),foot=s.querySelector(".footer"),heading=s.querySelector(".main h1"),vis=s.querySelector(".visual");
   let warnings=[];
   if(steps.length&&steps[steps.length-1].getBoundingClientRect().bottom>r.top+795)warnings.push("sidebar text too long");
   if(tip&&tip.getBoundingClientRect().bottom>foot.getBoundingClientRect().top)warnings.push("tip overlaps footer");
   if(heading&&vis&&heading.getBoundingClientRect().bottom>vis.getBoundingClientRect().top)warnings.push("title overlaps image");
   return warnings.length?[{slide:i+1,id:s.id,warnings}]:[];
  }));
  if(issues.length){console.log("LAYOUT "+lang+" "+JSON.stringify(issues));await p.addStyleTag({content:".step p{font-size:17px;line-height:1.5}.step{margin-bottom:20px}.rail h2{margin-top:25px}.tip{font-size:17px;padding:12px 16px}"});}
  const finalIssues=await p.evaluate(()=>[...document.querySelectorAll(".slide")].flatMap((s,i)=>{
   const steps=s.querySelectorAll(".step"),top=s.getBoundingClientRect().top,tip=s.querySelector(".tip"),foot=s.querySelector(".footer"),h=s.querySelector(".main h1"),v=s.querySelector(".visual");
   return (steps.length&&steps[steps.length-1].getBoundingClientRect().bottom>top+798)||(tip&&tip.getBoundingClientRect().bottom>foot.getBoundingClientRect().top)||(h&&v&&h.getBoundingClientRect().bottom>v.getBoundingClientRect().top)?[{slide:i+1,id:s.id}]:[];
  }));
  if(finalIssues.length)throw new Error("Unresolved layout overflow "+lang+" "+JSON.stringify(finalIssues));
  await p.pdf({path:path.join(OUT,"TRIGO-User-Manual-"+lang.toUpperCase()+".pdf"),printBackground:true,preferCSSPageSize:true,outline:true});
  validations.push({language:lang,slides:n,layoutIssues:finalIssues});
  for(const key of ["design","phone-nav","phone-place","settings-save","capacity","pptx"])await p.locator("#"+key).screenshot({path:path.join(OUT,"preview-"+lang+"-"+key+".png")});
  console.log("PDF "+lang+" "+n+" slides");
 }
 fs.writeFileSync(path.join(OUT,"layout-validation.json"),JSON.stringify(validations,null,2));
 const previews=["en-design","en-phone-place","en-settings-save","th-design","th-phone-place","th-settings-save"];
 await p.setViewportSize({width:1700,height:820});
 await p.setContent('<html><head><style>body{margin:0;padding:24px;background:#F2F5F8;color:#062A44;font-family:Arial}h1{font-size:28px;margin:0 0 20px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}img{width:100%;border:1px solid #D8E0E7;border-radius:8px}p{font-size:16px;margin:8px 0}</style></head><body><h1>Updated TRIGO user manuals · '+config.version+' · English and Thai</h1><div class="grid">'+previews.map(n=>'<div><img src="'+data(path.join(OUT,"preview-"+n+".png"))+'"><p>'+n+'</p></div>').join("")+'</div></body></html>');
 await p.evaluate(()=>window.scrollTo(0,0));await p.screenshot({path:path.join(OUT,"manual-preview.png")});
 }finally{await browser.close();}
}
(async()=>{
 const v=fs.readFileSync(path.join(ROOT,"version.js"),"utf8");
 if(!v.includes('"'+config.version+'"'))throw new Error("Release mismatch: update content.json before recapturing");
 await capture();await render();
})().catch(e=>{console.error(e);process.exit(1);});
