(()=>{var e={};e.id=1038,e.ids=[1038],e.modules={10846:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},44870:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},3295:e=>{"use strict";e.exports=require("next/dist/server/app-render/after-task-async-storage.external.js")},29294:e=>{"use strict";e.exports=require("next/dist/server/app-render/work-async-storage.external.js")},63033:e=>{"use strict";e.exports=require("next/dist/server/app-render/work-unit-async-storage.external.js")},29021:e=>{"use strict";e.exports=require("fs")},81630:e=>{"use strict";e.exports=require("http")},55591:e=>{"use strict";e.exports=require("https")},33873:e=>{"use strict";e.exports=require("path")},11997:e=>{"use strict";e.exports=require("punycode")},27910:e=>{"use strict";e.exports=require("stream")},79551:e=>{"use strict";e.exports=require("url")},28354:e=>{"use strict";e.exports=require("util")},73566:e=>{"use strict";e.exports=require("worker_threads")},74075:e=>{"use strict";e.exports=require("zlib")},73024:e=>{"use strict";e.exports=require("node:fs")},57075:e=>{"use strict";e.exports=require("node:stream")},37830:e=>{"use strict";e.exports=require("node:stream/web")},91285:(e,t,r)=>{"use strict";r.r(t),r.d(t,{patchFetch:()=>h,routeModule:()=>x,serverHooks:()=>w,workAsyncStorage:()=>g,workUnitAsyncStorage:()=>y});var s={};r.r(s),r.d(s,{POST:()=>f,maxDuration:()=>p,runtime:()=>d});var a=r(42706),n=r(28203),i=r(45994),o=r(39187),c=r(48074),u=r(24412),l=r(90724);let d="nodejs",p=90,m=`Generas secuencias de email follow-up para Xavi (onepulso, lead generation B2B).

Te da: una descripci\xf3n del prop\xf3sito + datos del prospect. T\xfa devuelves un JSON con steps[] de la secuencia.

REGLAS DE CADA STEP:
- delay_days: d\xedas desde el step anterior (o desde el env\xedo inicial para el step 1).
- body_html: HTML con <p> en cada bloque, <strong> en 2-3 palabras clave, firma "Un saludo,<br>Xavi". Sin emojis.
- send_if_no_reply: true por defecto (cancelar si han respondido).
- note: 1 frase corta describiendo el prop\xf3sito.

ESTRATEGIA:
- 3-4 steps t\xedpicamente.
- Step 1 (3 d\xedas): bump suave + recordar el gancho personalizado.
- Step 2 (4 d\xedas): caso real con n\xfamero o pregunta de cualificaci\xf3n.
- Step 3 (5 d\xedas): breakup invitando a responder cuando lo retomen.
- Si el usuario describe ramas condicionales ("si dice X, mandar Y") → ignora la condici\xf3n y genera la rama del "no responde". Las ramas por contenido se gestionan con respuestas IA, no con secuencias programadas.

Castellano Espa\xf1a. Tono directo, profesional, sin floritura.

OUTPUT: JSON puro sin markdown:
{
  "name": "string corto",
  "description": "string",
  "steps": [
    {"delay_days": 3, "body_html": "<p>...</p>", "send_if_no_reply": true, "note": "..."},
    ...
  ]
}`;async function f(e){let{description:t}=await e.json();if(!t)return o.NextResponse.json({error:"description requerida"},{status:400});let r=(0,u.D)("ANTHROPIC_API_KEY");if(!r)return o.NextResponse.json({error:"ANTHROPIC_API_KEY missing"},{status:500});let s=await (0,l.Lx)(),a=`MEMORIA DEL USUARIO (tono, framework, casos):
${s}

DESCRIPCI\xd3N DE LA SECUENCIA QUE QUIERE GENERAR:
${t}

Devuelve solo el JSON con la secuencia.`,n=new c.Ay({apiKey:r,maxRetries:3,timeout:12e4}),i=(await n.messages.create({model:"claude-opus-4-7",max_tokens:6e3,system:m,messages:[{role:"user",content:a}]})).content.filter(e=>"text"===e.type).map(e=>e.text).join("\n").trim(),d=i.replace(/^```json\s*|\s*```$/gi,"").trim();try{let e=JSON.parse(d);return o.NextResponse.json({sequence:e})}catch{return o.NextResponse.json({error:"no se pudo parsear",raw:i},{status:500})}}let x=new a.AppRouteRouteModule({definition:{kind:n.RouteKind.APP_ROUTE,page:"/api/email/sequences/ai-generate/route",pathname:"/api/email/sequences/ai-generate",filename:"route",bundlePath:"app/api/email/sequences/ai-generate/route"},resolvedPagePath:"C:\\Users\\USUARIO\\Nueva carpeta\\platform\\app\\api\\email\\sequences\\ai-generate\\route.ts",nextConfigOutput:"",userland:s}),{workAsyncStorage:g,workUnitAsyncStorage:y,serverHooks:w}=x;function h(){return(0,i.patchFetch)({workAsyncStorage:g,workUnitAsyncStorage:y})}},96487:()=>{},78335:()=>{},24061:(e,t,r)=>{"use strict";r.d(t,{OR:()=>c,dK:()=>m,e3:()=>d,n4:()=>p,qE:()=>f});var s=r(29021),a=r(33873),n=r.n(a);let i=n().join(process.cwd(),"data","credentials.json"),o=["ANTHROPIC_API_KEY","INSTANTLY_API_KEY","OPENAI_API_KEY","LINKEDIN_CLIENT_ID","LINKEDIN_CLIENT_SECRET"];function c(){try{if(!(0,s.existsSync)(i))return{};return JSON.parse((0,s.readFileSync)(i,"utf-8"))}catch{return{}}}async function u(){try{let e=await s.promises.readFile(i,"utf-8");return JSON.parse(e)}catch{return{}}}async function l(e){await s.promises.mkdir(n().dirname(i),{recursive:!0}),await s.promises.writeFile(i,JSON.stringify(e,null,2),"utf-8")}async function d(e,t){let r=await u();t&&t.trim()?r[e]=t.trim():delete r[e],await l(r)}async function p(e){let t=await u();delete t[e],await l(t)}function m(e){return e?e.length<=8?"•".repeat(e.length):e.slice(0,6)+"•".repeat(Math.max(e.length-10,4))+e.slice(-4):""}function f(e){return o.includes(e)}},24412:(e,t,r)=>{"use strict";r.d(t,{D:()=>o});var s=r(29021),a=r(33873),n=r(24061);let i=null;function o(e){try{let t=(0,n.OR)();if(t[e]&&t[e].length>0)return t[e]}catch{}let t=process.env[e];return t&&t.length>0?t:function(){if(i)return i;i={};try{for(let e of(0,s.readFileSync)((0,a.join)(process.cwd(),".env.local"),"utf-8").split(/\r?\n/)){let t=e.trim();if(!t||t.startsWith("#"))continue;let r=t.indexOf("=");if(r<=0)continue;let s=t.slice(0,r).trim(),a=t.slice(r+1).trim();(a.startsWith('"')&&a.endsWith('"')||a.startsWith("'")&&a.endsWith("'"))&&(a=a.slice(1,-1)),i[s]=a}}catch{}return i}()[e]??""}},90724:(e,t,r)=>{"use strict";r.d(t,{Lx:()=>d,Q_:()=>c,h0:()=>l,zm:()=>u});var s=r(29021),a=r(33873),n=r.n(a);let i=n().join(process.cwd(),"data","memory");async function o(){await s.promises.mkdir(i,{recursive:!0})}async function c(){await o();let e=await s.promises.readdir(i),t=[];for(let r of e){if(!r.endsWith(".md"))continue;let e=n().join(i,r),a=function(e){if(!e.startsWith("---"))return{meta:{},body:e};let t=e.indexOf("\n---",3);if(-1===t)return{meta:{},body:e};let r=e.slice(3,t).trim(),s=e.slice(t+4).trimStart(),a={};for(let e of r.split("\n")){let t=e.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);t&&(a[t[1]]=t[2].trim())}return{meta:a,body:s}}(await s.promises.readFile(e,"utf-8")),o=await s.promises.stat(e);t.push({slug:r.replace(/\.md$/,""),title:a.meta.title??r.replace(/\.md$/,""),category:a.meta.category??"general",content:a.body,updated:o.mtime.toISOString()})}return t.sort((e,t)=>t.updated.localeCompare(e.updated))}async function u(e){await o();let t=e.slug??e.title.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,80),r=n().join(i,`${t}.md`),a=`---
title: ${e.title}
category: ${e.category}
---

${e.content}
`;return await s.promises.writeFile(r,a,"utf-8"),{slug:t,title:e.title,category:e.category,content:e.content,updated:new Date().toISOString()}}async function l(e){let t=n().join(i,`${e}.md`);await s.promises.unlink(t).catch(()=>{})}async function d(){let e=await c();return 0===e.length?"(sin memoria configurada todav\xeda)":e.map(e=>`### [${e.category}] ${e.title}
${e.content}`).join("\n\n---\n\n")}}};var t=require("../../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),s=t.X(0,[638,5452,8074],()=>r(91285));module.exports=s})();