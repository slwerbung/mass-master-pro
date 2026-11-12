var q=require("https://esm.sh/@supabase/supabase-js@2");var B="https://captfix.app";function K(e){return String(e||"").toLowerCase().replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue").replace(/ß/g,"ss").normalize("NFKD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,40).replace(/-$/g,"")}function M(e){let t=(e.slug||"").trim()||K(e.companyName||"")||"firma",n=((e.baseUrl||"").trim()||B).replace(/\/+$/,"");return{slug:t,baseUrl:n}}async function E(e){let{data:t}=await e.from("app_config").select("key, value").in("key",["public_link_slug","public_base_url","legal_info"]),n=new Map((t||
[]).map(l=>[l.key,l.value])),o=null;try{o=JSON.parse(n.get("legal_info")||"null")?.companyName??null}catch{o=null}return M({slug:n.get("public_link_slug"),baseUrl:n.get("public_base_url"),companyName:o})}function I(e,t){let n=t.startsWith("/")?t:`/${t}`;return`${e.baseUrl.replace(/\/+$/,"")}/${e.slug.
replace(/^\/+|\/+$/g,"")}${n}`}var T=new TextEncoder;function V(e){let t="";for(let n=0;n<e.length;n++)t+=String.fromCharCode(e[n]);return btoa(t).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}function G(e){let t=e.replace(/-/g,"+").replace(/_/g,"/"),n=t+"=".repeat((4-(t.length%4||4))%4),o=atob(n),l=new Uint8Array(o.length);
for(let i=0;i<o.length;i++)l[i]=o.charCodeAt(i);return l}async function H(e,t){let n=await crypto.subtle.importKey("raw",T.encode(t),{name:"HMAC",hash:"SHA-256"},!1,["sign"]),o=await crypto.subtle.sign("HMAC",n,T.encode(e));return V(new Uint8Array(o))}function J(e,t){if(e.length!==t.length)return!1;
let n=0;for(let o=0;o<e.length;o++)n|=e.charCodeAt(o)^t.charCodeAt(o);return n===0}async function C(e,t){let[n,o]=e.split(".");if(!n||!o)return null;let l=await H(n,t);if(!J(l,o))return null;try{let i=new TextDecoder().decode(G(n)),r=JSON.parse(i);return!r.exp||r.exp*1e3<=Date.now()?null:r}catch{return null}}function O(){let e=Deno.env.get("SESSION_SIGNING_SECRET");if(!e||e.length<
32)throw new Error("SESSION_SIGNING_SECRET environment variable is not set or too short (min 32 chars). Generate one with: openssl rand -hex 32");return e}function $(e){return String(e??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function L(e){let t=`Neue Version zur Freigabe – Projekt ${e.projectNumber}`,n=e.items.length?e.items:[{label:"Ihre Dateien",version:null}],o=n.map(s=>`<li style="margin:2px 0"\
>${$(s.label)}${s.version?` <span style="color:#666">(Version ${s.version})</span>`:""}</li>`).join(""),l=e.note?.trim()?`<p style="margin:12px 0"><strong>Was wurde geändert?</strong><br><span style="white-space:pre-wrap">${$(e.note.trim())}</span></p>`:"",i=e.resetApproval?'<p style="margin:12px 0\
">Bitte prüfen Sie die neue Version und geben Sie sie erneut frei – die bisherige Freigabe gilt für die ältere Version.</p>':'<p style="margin:12px 0">Bitte sehen Sie sich die neue Version an.</p>',r=`
    <div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:560px;line-height:1.5">
      <p>Guten Tag,</p>
      <p>für Ihr Projekt <strong>${$(e.projectNumber)}</strong> liegt eine neue Version vor:</p>
      <ul style="margin:8px 0;padding-left:20px">${o}</ul>
      ${l}
      ${i}
      <p style="margin:24px 0">
        <a href="${$(e.link)}" style="background:#0E73E8;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600">Neue Version ansehen</a>
      </p>
      <p style="font-size:13px;color:#666">Link: ${$(e.link)}</p>
      <p style="margin-top:20px">Mit freundlichen Grüßen<br>${$(e.companyName)}</p>
    </div>`,a=["Guten Tag,","",`für Ihr Projekt ${e.projectNumber} liegt eine neue Version vor:`,...n.map(s=>`- ${s.label}${s.version?` (Version ${s.version})`:""}`),...e.note?.trim()?["",`Was wurde geändert? ${e.note.trim()}`]:[],"",e.resetApproval?"Bitte prüfen Sie die neue Version und geben Sie\
 sie erneut frei.":"Bitte sehen Sie sich die neue Version an.","",e.link,"","Mit freundlichen Grüßen",e.companyName].join(`
`);return{subject:t,html:r,text:a}}var D={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};function c(e,t=200){return new Response(JSON.stringify(e),{status:t,headers:{...D,"Content-Type":"application/json"}})}var F="h\
ttps://login.hero-software.de/api/external/v7/graphql";async function A(e,t,n){try{let o=await fetch(F,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${e}`},body:JSON.stringify({query:t,variables:n})}),l=await o.text();if(!o.ok)return{error:`HTTP ${o.status}: ${l.slice(
0,200)}`};let i=JSON.parse(l);return i.errors?.length?{error:i.errors[0]?.message||"GraphQL-Fehler"}:{data:i.data}}catch(o){return{error:o.message}}}async function U(e,t){let n=[],o=[{q:"query($ids:[Int]){ project_matches(ids:$ids){ id contact{ id email } } }",pick:i=>i?.contact?.email},{q:"query($i\
ds:[Int]){ project_matches(ids:$ids){ id customer{ contact_person{ email } } } }",pick:i=>i?.customer?.contact_person?.email},{q:"query($ids:[Int]){ project_matches(ids:$ids){ id customer{ id email } } }",pick:i=>i?.customer?.email}];for(let i of o){let r=await A(e,i.q,{ids:[t]});if(r.error){n.push(
r.error);continue}let a=r.data?.project_matches?.[0],s=i.pick(a);if(s)return{email:s,debug:n}}let l=["query($ids:[Int]){ project_matches(ids:$ids){ id contact_id } }","query($ids:[Int]){ project_matches(ids:$ids){ id customer_id } }"];for(let i of l){let r=await A(e,i,{ids:[t]});if(r.error){n.push(r.
error);continue}let a=r.data?.project_matches?.[0],s=a?.contact_id??a?.customer_id;if(s){let u=await A(e,"query($ids:[Int]){ contacts(ids:$ids){ id email } }",{ids:[Number(s)]});if(u.error){n.push(u.error);continue}let m=u.data?.contacts?.[0]?.email;if(m)return{email:m,debug:n}}}return{email:null,debug:n}}
function _(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}var Y="https://login.hero-software.de/api/external/v9/graphql";async function j(e,t){let{data:n}=await e.from("app_config").select("key,value").in("key",["hero_api_key","hero_enabled"]),o=new Map(
(n||[]).map(u=>[u.key,u.value])),l=o.get("hero_api_key");if(!(o.get("hero_enabled")==="true"||o.get("hero_enabled")===!0)||!l)return null;let{data:r}=await e.from("projects").select("custom_fields").eq("id",t).maybeSingle(),a=r?.custom_fields?.__hero_project_id,s=Number(a);return!Number.isFinite(s)||
s<=0?null:{apiKey:l,heroId:s}}async function P(e,t,n,o){let l="mutation($entry: LogbookEntryInput!) { add_logbook_entry(logbook_entry: $entry) { id } }",i=([n,o].filter(Boolean).join(`

`)||n).slice(0,5e3);try{let r=await fetch(Y,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${e}`},body:JSON.stringify({query:l,variables:{entry:{target:"project_match",target_id:t,custom_text:i}}})}),a=await r.text();if(!r.ok)return{ok:!1,error:`HTTP ${r.status}: ${a.
slice(0,200)}`};let s=JSON.parse(a);return s.errors?.length?{ok:!1,error:s.errors[0]?.message}:{ok:!0}}catch(r){return{ok:!1,error:r.message}}}function W(e,t,n,o){let l=o.trim()?`<p style="margin:16px 0;white-space:pre-wrap">${_(o.trim())}</p>`:"",i=`Korrektur / Freigabe – Einladung von ${e} · Pro\
jekt ${t}`,r=`
    <div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:560px;line-height:1.5">
      <p>Guten Tag,</p>
      <p><strong>${_(e)}</strong> hat für Ihr Projekt <strong>${_(t)}</strong> die Standorte zur Freigabe bereitgestellt. Die Prüfung läuft bequem online – ohne Registrierung.</p>
      ${l}
      <p style="margin:16px 0"><strong>So geht's:</strong> Link öffnen, Ihren Namen eingeben, dann Standorte freigeben oder Korrekturen hinterlassen.</p>
      <p style="margin:24px 0">
        <a href="${n}" style="background:#0E73E8;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600">Standorte ansehen &amp; freigeben</a>
      </p>
      <p style="font-size:13px;color:#666">Link: ${n}</p>
      <p style="margin-top:20px">Mit freundlichen Grüßen<br>${_(e)}</p>
    </div>`;return{subject:i,html:r}}function Q(e,t){let n=[],o=[],l=()=>{o.length!==0&&(n.push(`<ul style="margin:8px 0;padding-left:20px">${o.map(i=>`<li style="margin:2px 0">${i}</li>`).join("")}</ul>`),o=[])};for(let i of t.split(`
`)){let r=i.trim();if(!r){l();continue}let a=r.match(/^[-*•]\s+(.*)$/);if(a){o.push(_(a[1]));continue}l(),n.push(`<p style="margin:12px 0">${_(r)}</p>`)}return l(),`
    <div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:600px;line-height:1.5">
      ${n.join(`
`)}
      <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
      <p style="font-size:13px;color:#666;margin:0">Mit freundlichen Grüßen<br>${_(e)}</p>
    </div>`}Deno.serve(async e=>{if(e.method==="OPTIONS")return new Response(null,{headers:D});try{let t=await e.json(),{action:n,token:o}=t,l=o?await C(o,O()):null;if(!l||l.role!=="employee"&&l.role!=="admin")return c({error:"Unauthorized"},401);let i=(0,q.createClient)(Deno.env.get("SUPABASE_URL"),
Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));if(n==="lookup_email"){let r=Number(t.heroProjectId);if(!r)return c({email:null});let{data:a}=await i.from("app_config").select("value").eq("key","hero_api_key").maybeSingle(),s=a?.value;if(!s)return c({email:null});let{email:u,debug:m}=await U(s,r);return c(
{email:u,...t.debug?{debug:m}:{}})}if(n==="protocol_lookup_email"){let r=String(t.projectId||"").trim();if(!r)return c({email:null});let a=await j(i,r);if(!a)return c({email:null});let{email:s}=await U(a.apiKey,a.heroId);return c({email:s})}if(n==="send_protocol"){let r=String(t.email||"").trim(),a=String(
t.subject||"").trim()||"Protokoll",s=String(t.bodyText||""),u=String(t.projectId||"").trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r))return c({error:"Ungültige E-Mail-Adresse"},400);if(!s.trim())return c({error:"Kein Inhalt"},400);let m="SL WERBUNG",{data:y}=await i.from("app_config").select("valu\
e").eq("key","legal_info").maybeSingle();if(y?.value)try{let p=JSON.parse(y.value);p?.companyName&&String(p.companyName).trim()&&(m=String(p.companyName).trim())}catch{}let b=Deno.env.get("RESEND_API_KEY");if(!b)return c({error:"RESEND_API_KEY not configured"},500);let f=Q(m,s),h=await fetch("https:\
//api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${b}`,"Content-Type":"application/json"},body:JSON.stringify({from:"Captfix <notifications@captfix.app>",to:[r],subject:a,html:f})});if(!h.ok){let p=await h.text();return c({error:`Mailversand fehlgeschlagen: ${p.slice(0,200)}`},
502)}if(u)try{let p=await j(i,u);p&&await P(p.apiKey,p.heroId,"Captfix: Protokoll an Kunde gesendet",`An: ${r}
Betreff: ${a}

${s}`.slice(0,5e3))}catch{}return c({success:!0})}if(n==="send"){let r=String(t.projectId||"").trim(),a=String(t.email||"").trim(),s=String(t.note||"");if(!r)return c({error:"projectId fehlt"},400);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a))return c({error:"Ungültige E-Mail-Adresse"},400);let{data:u}=await i.
from("projects").select("project_number").eq("id",r).maybeSingle(),m=u?.project_number||r.slice(0,8),y="SL WERBUNG",{data:b}=await i.from("app_config").select("value").eq("key","legal_info").maybeSingle();if(b?.value)try{let g=JSON.parse(b.value);g?.companyName&&String(g.companyName).trim()&&(y=String(
g.companyName).trim())}catch{}let f=Deno.env.get("RESEND_API_KEY");if(!f)return c({error:"RESEND_API_KEY not configured"},500);let h=I(await E(i),`/freigabe/${r}`),{subject:p,html:x}=W(y,m,h,s),w=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${f}`,"Content\
-Type":"application/json"},body:JSON.stringify({from:"Captfix <notifications@captfix.app>",to:[a],subject:p,html:x})});if(!w.ok){let g=await w.text();return c({error:`Mailversand fehlgeschlagen: ${g.slice(0,200)}`},502)}try{await i.from("project_invites").insert({project_id:r,project_number:m,email:a,
sent_at:new Date().toISOString()})}catch{}try{let g=await j(i,r);if(g){let N=`Einladung zur Korrektur/Freigabe an ${a} versendet.

Betreff: ${p}
Link: ${h}`+(s.trim()?`

Persönliche Nachricht:
${s.trim()}`:"");await P(g.apiKey,g.heroId,"Captfix: Einladung versendet",N)}}catch{}return c({success:!0})}if(n==="notify_new_version"){let r=String(t.projectId||"").trim(),a=String(t.email||"").trim(),s=t.kind==="vehicle"?"vehicle":"location",u=String(t.note||"").slice(0,300),m=t.resetApproval!==!1;
if(!r)return c({error:"projectId fehlt"},400);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a))return c({error:"Ungültige E-Mail-Adresse"},400);let{data:y}=await i.from("projects").select("project_number").eq("id",r).maybeSingle();if(!y)return c({error:"Projekt nicht gefunden"},404);let b=y.project_number||
r.slice(0,8),f=[];if(s==="vehicle"){let{data:d}=await i.from("vehicle_layouts").select("version").eq("project_id",r).is("superseded_at",null).limit(1);f.push({label:"Fahrzeuglayout",version:d?.[0]?.version??null})}else{let d=(Array.isArray(t.locationIds)?t.locationIds:[]).map(String).slice(0,200);if(!d.
length)return c({error:"Keine Standorte angegeben"},400);let[{data:v},{data:k}]=await Promise.all([i.from("locations").select("id, location_number, location_name").eq("project_id",r).in("id",d).order("location_number"),i.from("location_pdfs").select("location_id, version").in("location_id",d).is("su\
perseded_at",null)]);if(!v?.length)return c({error:"Standorte gehören nicht zu diesem Projekt"},400);let z=new Map((k||[]).map(S=>[S.location_id,S.version]));for(let S of v)f.push({label:[`Standort ${S.location_number??""}`.trim(),S.location_name].filter(Boolean).join(" · "),version:z.get(S.id)??null})}
let h="",{data:p}=await i.from("app_config").select("value").eq("key","legal_info").maybeSingle();try{h=String(JSON.parse(p?.value||"{}")?.companyName||"").trim()}catch{}let x=Deno.env.get("RESEND_API_KEY");if(!x)return c({error:"RESEND_API_KEY not configured"},500);let w=I(await E(i),`/freigabe/${r}`),
g=L({companyName:h,projectNumber:b,link:w,items:f,note:u,resetApproval:m}),N=`${(h||"Freigabe").replace(/[<>"]/g,"")} <notifications@captfix.app>`,R=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${x}`,"Content-Type":"application/json"},body:JSON.stringify(
{from:N,to:[a],subject:g.subject,html:g.html,text:g.text})});if(!R.ok){let d=await R.text();return c({error:`Mailversand fehlgeschlagen: ${d.slice(0,200)}`},502)}try{let d=await j(i,r);if(d){let v=f.map(k=>`${k.label}${k.version?` v${k.version}`:""}`).join(", ");await P(d.apiKey,d.heroId,`Neue Versi\
on an ${a} gemeldet`,`${v}${u.trim()?`

Änderung: ${u.trim()}`:""}

Link: ${w}`)}}catch{}return c({success:!0})}return c({error:`Unknown action: ${n}`},400)}catch(t){return c({error:t.message},500)}});
