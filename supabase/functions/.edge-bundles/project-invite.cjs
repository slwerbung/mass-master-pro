var I=require("https://esm.sh/@supabase/supabase-js@2");var R="https://captfix.app";function O(e){return String(e||"").toLowerCase().replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue").replace(/ß/g,"ss").normalize("NFKD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,40).replace(/-$/g,"")}function T(e){let t=(e.slug||"").trim()||O(e.companyName||"")||"firma",n=((e.baseUrl||"").trim()||R).replace(/\/+$/,"");return{slug:t,baseUrl:n}}async function w(e){let{data:t}=await e.from("app_config").select("key, value").in("key",["public_link_slug","public_base_url","legal_info"]),n=new Map((t||
[]).map(a=>[a.key,a.value])),r=null;try{r=JSON.parse(n.get("legal_info")||"null")?.companyName??null}catch{r=null}return T({slug:n.get("public_link_slug"),baseUrl:n.get("public_base_url"),companyName:r})}function x(e,t){let n=t.startsWith("/")?t:`/${t}`;return`${e.baseUrl.replace(/\/+$/,"")}/${e.slug.
replace(/^\/+|\/+$/g,"")}${n}`}var $=new TextEncoder;function U(e){let t="";for(let n=0;n<e.length;n++)t+=String.fromCharCode(e[n]);return btoa(t).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}function L(e){let t=e.replace(/-/g,"+").replace(/_/g,"/"),n=t+"=".repeat((4-(t.length%4||4))%4),r=atob(n),a=new Uint8Array(r.length);
for(let o=0;o<r.length;o++)a[o]=r.charCodeAt(o);return a}async function q(e,t){let n=await crypto.subtle.importKey("raw",$.encode(t),{name:"HMAC",hash:"SHA-256"},!1,["sign"]),r=await crypto.subtle.sign("HMAC",n,$.encode(e));return U(new Uint8Array(r))}function D(e,t){if(e.length!==t.length)return!1;
let n=0;for(let r=0;r<e.length;r++)n|=e.charCodeAt(r)^t.charCodeAt(r);return n===0}async function E(e,t){let[n,r]=e.split(".");if(!n||!r)return null;let a=await q(n,t);if(!D(a,r))return null;try{let o=new TextDecoder().decode(L(n)),i=JSON.parse(o);return!i.exp||i.exp*1e3<=Date.now()?null:i}catch{return null}}function N(){let e=Deno.env.get("SESSION_SIGNING_SECRET");if(!e||e.length<
32)throw new Error("SESSION_SIGNING_SECRET environment variable is not set or too short (min 32 chars). Generate one with: openssl rand -hex 32");return e}var P={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};function l(e,t=200){return new Response(JSON.stringify(e),{status:t,headers:{...P,"Content-Type":"application/json"}})}var z="h\
ttps://login.hero-software.de/api/external/v7/graphql";async function _(e,t,n){try{let r=await fetch(z,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${e}`},body:JSON.stringify({query:t,variables:n})}),a=await r.text();if(!r.ok)return{error:`HTTP ${r.status}: ${a.slice(
0,200)}`};let o=JSON.parse(a);return o.errors?.length?{error:o.errors[0]?.message||"GraphQL-Fehler"}:{data:o.data}}catch(r){return{error:r.message}}}async function j(e,t){let n=[],r=[{q:"query($ids:[Int]){ project_matches(ids:$ids){ id contact{ id email } } }",pick:o=>o?.contact?.email},{q:"query($i\
ds:[Int]){ project_matches(ids:$ids){ id customer{ contact_person{ email } } } }",pick:o=>o?.customer?.contact_person?.email},{q:"query($ids:[Int]){ project_matches(ids:$ids){ id customer{ id email } } }",pick:o=>o?.customer?.email}];for(let o of r){let i=await _(e,o.q,{ids:[t]});if(i.error){n.push(
i.error);continue}let s=i.data?.project_matches?.[0],c=o.pick(s);if(c)return{email:c,debug:n}}let a=["query($ids:[Int]){ project_matches(ids:$ids){ id contact_id } }","query($ids:[Int]){ project_matches(ids:$ids){ id customer_id } }"];for(let o of a){let i=await _(e,o,{ids:[t]});if(i.error){n.push(i.
error);continue}let s=i.data?.project_matches?.[0],c=s?.contact_id??s?.customer_id;if(c){let u=await _(e,"query($ids:[Int]){ contacts(ids:$ids){ id email } }",{ids:[Number(c)]});if(u.error){n.push(u.error);continue}let g=u.data?.contacts?.[0]?.email;if(g)return{email:g,debug:n}}}return{email:null,debug:n}}
function m(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}var B="https://login.hero-software.de/api/external/v9/graphql";async function S(e,t){let{data:n}=await e.from("app_config").select("key,value").in("key",["hero_api_key","hero_enabled"]),r=new Map(
(n||[]).map(u=>[u.key,u.value])),a=r.get("hero_api_key");if(!(r.get("hero_enabled")==="true"||r.get("hero_enabled")===!0)||!a)return null;let{data:i}=await e.from("projects").select("custom_fields").eq("id",t).maybeSingle(),s=i?.custom_fields?.__hero_project_id,c=Number(s);return!Number.isFinite(c)||
c<=0?null:{apiKey:a,heroId:c}}async function v(e,t,n,r){let a="mutation($entry: LogbookEntryInput!) { add_logbook_entry(logbook_entry: $entry) { id } }",o=([n,r].filter(Boolean).join(`

`)||n).slice(0,5e3);try{let i=await fetch(B,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${e}`},body:JSON.stringify({query:a,variables:{entry:{target:"project_match",target_id:t,custom_text:o}}})}),s=await i.text();if(!i.ok)return{ok:!1,error:`HTTP ${i.status}: ${s.
slice(0,200)}`};let c=JSON.parse(s);return c.errors?.length?{ok:!1,error:c.errors[0]?.message}:{ok:!0}}catch(i){return{ok:!1,error:i.message}}}function K(e,t,n,r){let a=r.trim()?`<p style="margin:16px 0;white-space:pre-wrap">${m(r.trim())}</p>`:"",o=`Korrektur / Freigabe – Einladung von ${e} · Pro\
jekt ${t}`,i=`
    <div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:560px;line-height:1.5">
      <p>Guten Tag,</p>
      <p><strong>${m(e)}</strong> hat für Ihr Projekt <strong>${m(t)}</strong> die Standorte zur Freigabe bereitgestellt. Die Prüfung läuft bequem online – ohne Registrierung.</p>
      ${a}
      <p style="margin:16px 0"><strong>So geht's:</strong> Link öffnen, Ihren Namen eingeben, dann Standorte freigeben oder Korrekturen hinterlassen.</p>
      <p style="margin:24px 0">
        <a href="${n}" style="background:#0E73E8;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600">Standorte ansehen &amp; freigeben</a>
      </p>
      <p style="font-size:13px;color:#666">Link: ${n}</p>
      <p style="margin-top:20px">Mit freundlichen Grüßen<br>${m(e)}</p>
    </div>`;return{subject:o,html:i}}function G(e,t){let n=[],r=[],a=()=>{r.length!==0&&(n.push(`<ul style="margin:8px 0;padding-left:20px">${r.map(o=>`<li style="margin:2px 0">${o}</li>`).join("")}</ul>`),r=[])};for(let o of t.split(`
`)){let i=o.trim();if(!i){a();continue}let s=i.match(/^[-*•]\s+(.*)$/);if(s){r.push(m(s[1]));continue}a(),n.push(`<p style="margin:12px 0">${m(i)}</p>`)}return a(),`
    <div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:600px;line-height:1.5">
      ${n.join(`
`)}
      <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
      <p style="font-size:13px;color:#666;margin:0">Mit freundlichen Grüßen<br>${m(e)}</p>
    </div>`}Deno.serve(async e=>{if(e.method==="OPTIONS")return new Response(null,{headers:P});try{let t=await e.json(),{action:n,token:r}=t,a=r?await E(r,N()):null;if(!a||a.role!=="employee"&&a.role!=="admin")return l({error:"Unauthorized"},401);let o=(0,I.createClient)(Deno.env.get("SUPABASE_URL"),
Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));if(n==="lookup_email"){let i=Number(t.heroProjectId);if(!i)return l({email:null});let{data:s}=await o.from("app_config").select("value").eq("key","hero_api_key").maybeSingle(),c=s?.value;if(!c)return l({email:null});let{email:u,debug:g}=await j(c,i);return l(
{email:u,...t.debug?{debug:g}:{}})}if(n==="protocol_lookup_email"){let i=String(t.projectId||"").trim();if(!i)return l({email:null});let s=await S(o,i);if(!s)return l({email:null});let{email:c}=await j(s.apiKey,s.heroId);return l({email:c})}if(n==="send_protocol"){let i=String(t.email||"").trim(),s=String(
t.subject||"").trim()||"Protokoll",c=String(t.bodyText||""),u=String(t.projectId||"").trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i))return l({error:"Ungültige E-Mail-Adresse"},400);if(!c.trim())return l({error:"Kein Inhalt"},400);let g="SL WERBUNG",{data:f}=await o.from("app_config").select("valu\
e").eq("key","legal_info").maybeSingle();if(f?.value)try{let p=JSON.parse(f.value);p?.companyName&&String(p.companyName).trim()&&(g=String(p.companyName).trim())}catch{}let h=Deno.env.get("RESEND_API_KEY");if(!h)return l({error:"RESEND_API_KEY not configured"},500);let b=G(g,c),y=await fetch("https:\
//api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${h}`,"Content-Type":"application/json"},body:JSON.stringify({from:"Captfix <notifications@captfix.app>",to:[i],subject:s,html:b})});if(!y.ok){let p=await y.text();return l({error:`Mailversand fehlgeschlagen: ${p.slice(0,200)}`},
502)}if(u)try{let p=await S(o,u);p&&await v(p.apiKey,p.heroId,"Captfix: Protokoll an Kunde gesendet",`An: ${i}
Betreff: ${s}

${c}`.slice(0,5e3))}catch{}return l({success:!0})}if(n==="send"){let i=String(t.projectId||"").trim(),s=String(t.email||"").trim(),c=String(t.note||"");if(!i)return l({error:"projectId fehlt"},400);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))return l({error:"Ungültige E-Mail-Adresse"},400);let{data:u}=await o.
from("projects").select("project_number").eq("id",i).maybeSingle(),g=u?.project_number||i.slice(0,8),f="SL WERBUNG",{data:h}=await o.from("app_config").select("value").eq("key","legal_info").maybeSingle();if(h?.value)try{let d=JSON.parse(h.value);d?.companyName&&String(d.companyName).trim()&&(f=String(
d.companyName).trim())}catch{}let b=Deno.env.get("RESEND_API_KEY");if(!b)return l({error:"RESEND_API_KEY not configured"},500);let y=x(await w(o),`/freigabe/${i}`),{subject:p,html:A}=K(f,g,y,c),k=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${b}`,"Content\
-Type":"application/json"},body:JSON.stringify({from:"Captfix <notifications@captfix.app>",to:[s],subject:p,html:A})});if(!k.ok){let d=await k.text();return l({error:`Mailversand fehlgeschlagen: ${d.slice(0,200)}`},502)}try{await o.from("project_invites").insert({project_id:i,project_number:g,email:s,
sent_at:new Date().toISOString()})}catch{}try{let d=await S(o,i);if(d){let C=`Einladung zur Korrektur/Freigabe an ${s} versendet.

Betreff: ${p}
Link: ${y}`+(c.trim()?`

Persönliche Nachricht:
${c.trim()}`:"");await v(d.apiKey,d.heroId,"Captfix: Einladung versendet",C)}}catch{}return l({success:!0})}return l({error:`Unknown action: ${n}`},400)}catch(t){return l({error:t.message},500)}});
