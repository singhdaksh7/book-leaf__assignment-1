const O=(process.env.BASE_URL ?? "https://bookleaf.77.37.45.177.sslip.io").replace(/\/+$/, ""),A=O+"/api/v1";
class C{jar={};cookie(){return Object.entries(this.jar).map(([k,v])=>`${k}=${v}`).join("; ")}
async req(m,p,{body,raw,headers={}}={}){const h={origin:O,cookie:this.cookie(),...headers};if(this.jar["XSRF-TOKEN"]&&m!=="GET")h["x-csrf-token"]=this.jar["XSRF-TOKEN"];if(body!==undefined)h["content-type"]="application/json";
const r=await fetch(A+p,{method:m,headers:h,body:raw??(body!==undefined?JSON.stringify(body):undefined)});this.sc=r.headers.getSetCookie();for(const c of this.sc){const[kv]=c.split(";");const i=kv.indexOf("=");this.jar[kv.slice(0,i)]=kv.slice(i+1)}let j;try{j=await r.json()}catch{};return{status:r.status,json:j}}}
const ok=(n,c,x="")=>console.log(`${c?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);
const a=new C(),ad=new C();const lg=await a.login?0:0;
let r=await a.req("POST","/auth/login",{body:{email:"synthetic.author1@example.test",password:process.env.BL_AUTHOR_PW}});
const exp=a.sc.map(c=>/expires=([^;]+)/i.exec(c)?.[1]).filter(Boolean).map(d=>(new Date(d)-Date.now())/3600000);
ok("session cookie Expires ~168h (7 days) from now",exp.length===2&&exp.every(h=>h>167&&h<169),exp.map(h=>h.toFixed(1)+"h").join(","));
await ad.req("POST","/auth/login",{body:{email:"admin@example.test",password:process.env.BL_ADMIN_PW}});
const b=(await a.req("GET","/author/books")).json.items[0];
const t=(await a.req("POST","/author/tickets",{body:{bookId:b.id,subject:"Closed-terminal audit",description:"Checking that CLOSED tickets are terminal."}})).json.ticket;
r=await ad.req("PATCH",`/admin/tickets/${t.id}`,{body:{status:"CLOSED"}});ok("admin closes ticket",r.status===200);
r=await ad.req("PATCH",`/admin/tickets/${t.id}`,{body:{status:"OPEN"}});ok("CLOSED cannot be reopened (409)",r.status===409,`status ${r.status}`);
r=await ad.req("POST",`/admin/tickets/${t.id}/replies`,{body:{body:"late reply"}});ok("admin cannot reply to CLOSED (409)",r.status===409,`status ${r.status}`);
r=await a.req("POST",`/author/tickets/${t.id}/messages`,{body:{body:"late author reply"}});ok("author cannot reply to CLOSED (409)",r.status===409,`status ${r.status}`);
r=await a.req("POST",`/author/tickets/${t.id}/attachments?filename=x.txt`,{raw:"x",headers:{"content-type":"text/plain"}});ok("no attachments on CLOSED (409)",r.status===409,`status ${r.status}`);
r=await a.req("GET",`/author/tickets/${t.id}`);ok("author payload exposes assigneeId (opaque id) - informational",("assigneeId" in (r.json.ticket??{})),`value=${r.json.ticket?.assigneeId}`);
