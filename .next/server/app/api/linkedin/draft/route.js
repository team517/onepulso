(()=>{var e={};e.id=1600,e.ids=[1600],e.modules={10846:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},44870:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},3295:e=>{"use strict";e.exports=require("next/dist/server/app-render/after-task-async-storage.external.js")},29294:e=>{"use strict";e.exports=require("next/dist/server/app-render/work-async-storage.external.js")},63033:e=>{"use strict";e.exports=require("next/dist/server/app-render/work-unit-async-storage.external.js")},29021:e=>{"use strict";e.exports=require("fs")},81630:e=>{"use strict";e.exports=require("http")},55591:e=>{"use strict";e.exports=require("https")},33873:e=>{"use strict";e.exports=require("path")},11997:e=>{"use strict";e.exports=require("punycode")},27910:e=>{"use strict";e.exports=require("stream")},79551:e=>{"use strict";e.exports=require("url")},28354:e=>{"use strict";e.exports=require("util")},73566:e=>{"use strict";e.exports=require("worker_threads")},74075:e=>{"use strict";e.exports=require("zlib")},73024:e=>{"use strict";e.exports=require("node:fs")},57075:e=>{"use strict";e.exports=require("node:stream")},37830:e=>{"use strict";e.exports=require("node:stream/web")},68317:(e,t,r)=>{"use strict";r.r(t),r.d(t,{patchFetch:()=>v,routeModule:()=>g,serverHooks:()=>h,workAsyncStorage:()=>y,workUnitAsyncStorage:()=>w});var a={};r.r(a),r.d(a,{POST:()=>x,maxDuration:()=>m,runtime:()=>p});var n=r(42706),s=r(28203),i=r(45994),o=r(39187),l=r(48074),c=r(24412),u=r(90724),d=r(79217);let p="nodejs",m=90,f=`Eres un copywriter senior de LinkedIn especializado en posts B2B que generan engagement real.

# FORMATO VISUAL — CR\xcdTICO

LinkedIn premia el espacio en blanco. Un muro de texto NO se lee. Estructura cada post as\xed:

\`\`\`
[Hook — UNA frase sola en su propia l\xednea, m\xe1ximo 12 palabras]

[L\xednea en blanco]

[Frase de contexto o giro — 1 l\xednea]

[L\xednea en blanco]

[Mini-p\xe1rrafo desarrollando — 1-3 frases CORTAS, cada una en su l\xednea o
bien agrupadas si forman una unidad]

[L\xednea en blanco]

[Otro mini-p\xe1rrafo o lista breve]

[L\xednea en blanco]

[Cierre + pregunta o llamada — 1-2 l\xedneas m\xe1ximo]
\`\`\`

REGLAS DURAS:
- DOBLE salto de l\xednea (l\xednea en blanco) entre ideas distintas. SIEMPRE.
- Frases m\xe1ximo ~20 palabras. Si supera, parte en dos l\xedneas.
- Bloques de texto m\xe1ximo 3 l\xedneas seguidas. Despu\xe9s → l\xednea en blanco.
- El hook (primera l\xednea) va siempre solo, aislado.
- El cierre va siempre solo, aislado.
- Cuando uses listas: cada \xedtem en su l\xednea, con gui\xf3n "- " (no emoji, no asterisco).
- Espacios en blanco bien repartidos por TODO el post (no concentrados al principio o al final).

# CONTENIDO

- Idioma: castellano Espa\xf1a (salvo que la memoria diga otro).
- Tono: directo, personal, profesional. Sin "estimados", sin "saludos cordiales", sin emojis salvo que el usuario los pida.
- Hook fuerte: afirmaci\xf3n contraria, dato concreto, observaci\xf3n contradictoria, pregunta provocadora.
- Desarrollo con un ejemplo real, mini-caso o dato. Nada gen\xe9rico.
- Cierre: insight, conclusi\xf3n o pregunta abierta que invite a comentar.
- Longitud: 700-1400 caracteres incluyendo saltos de l\xednea. NO uses el m\xe1ximo "porque s\xed" — los posts cortos rinden mejor en feed.
- Si lleva imagen, el texto puede ser m\xe1s corto y NO describirla literalmente.

# PROHIBIDO

- P\xe1rrafos de 5+ l\xedneas seguidas.
- "TLDR", "Conclusi\xf3n:", "Resumen:".
- Bullets con emojis (✅ 🚀 💡 etc.).
- Listas numeradas tipo "1) 2) 3)" salvo que sea estrictamente necesario.
- Buzzwords vac\xedas: "sinergias", "win-win", "valor a\xf1adido", "engagement".
- Cierres de "\xbfqu\xe9 opinas t\xfa?" sin m\xe1s — la pregunta tiene que ser espec\xedfica.

# OUTPUT

Solo el texto del post tal como va a aparecer en LinkedIn (con sus saltos de l\xednea reales). Sin comillas, sin explicaciones, sin "Aqu\xed tienes:", sin meta-comentarios. Empieza directamente con el hook.

# EJEMPLO DE FORMATO CORRECTO

Vendedores B2B: dejad de mandar follow-ups el viernes a las 17h.

Lo digo despu\xe9s de revisar 12.000 secuencias de cold email este a\xf1o.

Los emails enviados viernes tarde caen en el agujero negro del fin de semana.
Cuando el lead abre el inbox el lunes, tu mensaje est\xe1 ya enterrado bajo 200 m\xe1s.

Reply rate los viernes 17h-19h: 1.4%.
Reply rate los martes 9h-11h: 6.8%.

Cinco veces m\xe1s respuestas. Mismo equipo, mismo copy.

\xbfCu\xe1ntas oportunidades est\xe1s dejando enterradas en el inbox de un lunes?`;async function x(e){let{prompt:t,has_image:r}=await e.json();if(!t||"string"!=typeof t)return o.NextResponse.json({error:"prompt required"},{status:400});let a=(0,c.D)("ANTHROPIC_API_KEY");if(!a)return o.NextResponse.json({error:"ANTHROPIC_API_KEY missing"},{status:500});let n=new l.Ay({apiKey:a}),s=await (0,u.Lx)(),i=await (0,d.bG)("linkedin"),p="";if(i.length){let e=await Promise.all(i.map(async e=>{let t=await (0,d.SK)(e.name);return t?`### Skill: ${t.name}
${t.content.slice(0,3e3)}`:""}));p=`

Skills LinkedIn instaladas (\xfasalas como gu\xeda profesional):
${e.filter(Boolean).join("\n\n---\n\n")}`}let m=`Memoria del usuario:
${s}${p}

${r?"Va con imagen adjunta — texto puede ser un poco m\xe1s corto.\n\n":""}Brief:
${t}`,x=(await n.messages.create({model:"claude-opus-4-7",max_tokens:1500,system:f,messages:[{role:"user",content:m}]})).content.filter(e=>"text"===e.type).map(e=>e.text).join("\n").trim();return o.NextResponse.json({text:x})}let g=new n.AppRouteRouteModule({definition:{kind:s.RouteKind.APP_ROUTE,page:"/api/linkedin/draft/route",pathname:"/api/linkedin/draft",filename:"route",bundlePath:"app/api/linkedin/draft/route"},resolvedPagePath:"C:\\Users\\USUARIO\\Nueva carpeta\\platform\\app\\api\\linkedin\\draft\\route.ts",nextConfigOutput:"",userland:a}),{workAsyncStorage:y,workUnitAsyncStorage:w,serverHooks:h}=g;function v(){return(0,i.patchFetch)({workAsyncStorage:y,workUnitAsyncStorage:w})}},96487:()=>{},78335:()=>{},24061:(e,t,r)=>{"use strict";r.d(t,{OR:()=>l,dK:()=>m,e3:()=>d,n4:()=>p,qE:()=>f});var a=r(29021),n=r(33873),s=r.n(n);let i=s().join(process.cwd(),"data","credentials.json"),o=["ANTHROPIC_API_KEY","INSTANTLY_API_KEY","OPENAI_API_KEY","LINKEDIN_CLIENT_ID","LINKEDIN_CLIENT_SECRET"];function l(){try{if(!(0,a.existsSync)(i))return{};return JSON.parse((0,a.readFileSync)(i,"utf-8"))}catch{return{}}}async function c(){try{let e=await a.promises.readFile(i,"utf-8");return JSON.parse(e)}catch{return{}}}async function u(e){await a.promises.mkdir(s().dirname(i),{recursive:!0}),await a.promises.writeFile(i,JSON.stringify(e,null,2),"utf-8")}async function d(e,t){let r=await c();t&&t.trim()?r[e]=t.trim():delete r[e],await u(r)}async function p(e){let t=await c();delete t[e],await u(t)}function m(e){return e?e.length<=8?"•".repeat(e.length):e.slice(0,6)+"•".repeat(Math.max(e.length-10,4))+e.slice(-4):""}function f(e){return o.includes(e)}},24412:(e,t,r)=>{"use strict";r.d(t,{D:()=>o});var a=r(29021),n=r(33873),s=r(24061);let i=null;function o(e){try{let t=(0,s.OR)();if(t[e]&&t[e].length>0)return t[e]}catch{}let t=process.env[e];return t&&t.length>0?t:function(){if(i)return i;i={};try{for(let e of(0,a.readFileSync)((0,n.join)(process.cwd(),".env.local"),"utf-8").split(/\r?\n/)){let t=e.trim();if(!t||t.startsWith("#"))continue;let r=t.indexOf("=");if(r<=0)continue;let a=t.slice(0,r).trim(),n=t.slice(r+1).trim();(n.startsWith('"')&&n.endsWith('"')||n.startsWith("'")&&n.endsWith("'"))&&(n=n.slice(1,-1)),i[a]=n}}catch{}return i}()[e]??""}},90724:(e,t,r)=>{"use strict";r.d(t,{Lx:()=>d,Q_:()=>l,h0:()=>u,zm:()=>c});var a=r(29021),n=r(33873),s=r.n(n);let i=s().join(process.cwd(),"data","memory");async function o(){await a.promises.mkdir(i,{recursive:!0})}async function l(){await o();let e=await a.promises.readdir(i),t=[];for(let r of e){if(!r.endsWith(".md"))continue;let e=s().join(i,r),n=function(e){if(!e.startsWith("---"))return{meta:{},body:e};let t=e.indexOf("\n---",3);if(-1===t)return{meta:{},body:e};let r=e.slice(3,t).trim(),a=e.slice(t+4).trimStart(),n={};for(let e of r.split("\n")){let t=e.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);t&&(n[t[1]]=t[2].trim())}return{meta:n,body:a}}(await a.promises.readFile(e,"utf-8")),o=await a.promises.stat(e);t.push({slug:r.replace(/\.md$/,""),title:n.meta.title??r.replace(/\.md$/,""),category:n.meta.category??"general",content:n.body,updated:o.mtime.toISOString()})}return t.sort((e,t)=>t.updated.localeCompare(e.updated))}async function c(e){await o();let t=e.slug??e.title.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,80),r=s().join(i,`${t}.md`),n=`---
title: ${e.title}
category: ${e.category}
---

${e.content}
`;return await a.promises.writeFile(r,n,"utf-8"),{slug:t,title:e.title,category:e.category,content:e.content,updated:new Date().toISOString()}}async function u(e){let t=s().join(i,`${e}.md`);await a.promises.unlink(t).catch(()=>{})}async function d(){let e=await l();return 0===e.length?"(sin memoria configurada todav\xeda)":e.map(e=>`### [${e.category}] ${e.title}
${e.content}`).join("\n\n---\n\n")}},9474:(e,t,r)=>{"use strict";r.d(t,{TA:()=>c,pp:()=>u,qU:()=>d});var a=r(29021),n=r(33873),s=r.n(n);let i=s().join(process.cwd(),"data","skill-scopes.json");async function o(){try{return JSON.parse(await a.promises.readFile(i,"utf-8"))}catch{return{}}}async function l(e){await a.promises.mkdir(s().dirname(i),{recursive:!0}),await a.promises.writeFile(i,JSON.stringify(e,null,2),"utf-8")}async function c(e,t){let r=await o(),a=new Set(r[e]??[]);a.add(t),r[e]=[...a],await l(r)}async function u(e,t){let r=await o(),a=(r[e]??[]).filter(e=>e!==t);0===a.length?delete r[e]:r[e]=a,await l(r)}async function d(e){return Object.entries(await o()).filter(([,t])=>t.includes(e)).map(([e])=>e)}},79217:(e,t,r)=>{"use strict";r.d(t,{SK:()=>u,bG:()=>c});var a=r(29021),n=r(33873),s=r.n(n),i=r(9474);let o=s().resolve(process.cwd(),"..",".agents","skills");function l(e){let t=e.replace(/\r\n/g,"\n").replace(/\r/g,"\n");if(!t.startsWith("---"))return{meta:{},body:t};let r=t.indexOf("\n---",3);if(-1===r)return{meta:{},body:t};let a=t.slice(3,r).trim(),n=t.slice(r+4).trimStart(),s={};for(let e of a.split("\n")){if(/^\s/.test(e))continue;let t=e.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);t&&(s[t[1]]=t[2].trim().replace(/^["']|["']$/g,""))}return{meta:s,body:n}}async function c(e){let t=[];try{t=await a.promises.readdir(o)}catch{return[]}let r=e?new Set(await (0,i.qU)(e)):null,n=[];for(let e of t){if(r&&!r.has(e))continue;let t=s().join(o,e,"SKILL.md");try{let r=await a.promises.readFile(t,"utf-8"),{meta:s}=l(r);n.push({name:s.name??e,description:s.description??"(sin descripci\xf3n)"})}catch{}}return n.sort((e,t)=>e.name.localeCompare(t.name))}async function u(e){let t;try{t=await a.promises.readdir(o)}catch{return null}let r=t.find(t=>t===e);if(!r)for(let n of t){let t=s().join(o,n,"SKILL.md");try{let s=await a.promises.readFile(t,"utf-8"),{meta:i}=l(s);if(i.name===e){r=n;break}}catch{}}if(!r)return null;let n=s().join(o,r,"SKILL.md");try{let e=await a.promises.readFile(n,"utf-8"),{meta:t,body:s}=l(e);return{name:t.name??r,description:t.description??"(sin descripci\xf3n)",content:s,raw:e}}catch{return null}}}};var t=require("../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),a=t.X(0,[638,5452,8074],()=>r(68317));module.exports=a})();