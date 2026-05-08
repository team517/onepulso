module.exports=[5609,e=>{"use strict";var t=e.i(22734),a=e.i(14747);let r=a.default.join(process.cwd(),"data","memory");async function n(){await t.promises.mkdir(r,{recursive:!0})}async function i(){await n();let e=await t.promises.readdir(r),i=[];for(let n of e){if(!n.endsWith(".md"))continue;let e=a.default.join(r,n),s=function(e){if(!e.startsWith("---"))return{meta:{},body:e};let t=e.indexOf("\n---",3);if(-1===t)return{meta:{},body:e};let a=e.slice(3,t).trim(),r=e.slice(t+4).trimStart(),n={};for(let e of a.split("\n")){let t=e.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);t&&(n[t[1]]=t[2].trim())}return{meta:n,body:r}}(await t.promises.readFile(e,"utf-8")),o=await t.promises.stat(e);i.push({slug:n.replace(/\.md$/,""),title:s.meta.title??n.replace(/\.md$/,""),category:s.meta.category??"general",content:s.body,updated:o.mtime.toISOString()})}return i.sort((e,t)=>t.updated.localeCompare(e.updated))}async function s(e){await n();let i=e.slug??e.title.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,80),s=a.default.join(r,`${i}.md`),o=`---
title: ${e.title}
category: ${e.category}
---

${e.content}
`;return await t.promises.writeFile(s,o,"utf-8"),{slug:i,title:e.title,category:e.category,content:e.content,updated:new Date().toISOString()}}async function o(e){let n=a.default.join(r,`${e}.md`);await t.promises.unlink(n).catch(()=>{})}async function l(){let e=await i();return 0===e.length?"(sin memoria configurada todavía)":e.map(e=>`### [${e.category}] ${e.title}
${e.content}`).join("\n\n---\n\n")}e.s(["deleteMemory",0,o,"listMemory",0,i,"memoryAsContext",0,l,"saveMemory",0,s])},93695,(e,t,a)=>{t.exports=e.x("next/dist/shared/lib/no-fallback-error.external.js",()=>require("next/dist/shared/lib/no-fallback-error.external.js"))},14747,(e,t,a)=>{t.exports=e.x("path",()=>require("path"))},18622,(e,t,a)=>{t.exports=e.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))},56704,(e,t,a)=>{t.exports=e.x("next/dist/server/app-render/work-async-storage.external.js",()=>require("next/dist/server/app-render/work-async-storage.external.js"))},32319,(e,t,a)=>{t.exports=e.x("next/dist/server/app-render/work-unit-async-storage.external.js",()=>require("next/dist/server/app-render/work-unit-async-storage.external.js"))},24725,(e,t,a)=>{t.exports=e.x("next/dist/server/app-render/after-task-async-storage.external.js",()=>require("next/dist/server/app-render/after-task-async-storage.external.js"))},70406,(e,t,a)=>{t.exports=e.x("next/dist/compiled/@opentelemetry/api",()=>require("next/dist/compiled/@opentelemetry/api"))},22734,(e,t,a)=>{t.exports=e.x("fs",()=>require("fs"))},55636,17710,e=>{"use strict";var t=e.i(22734),a=e.i(14747);let r=a.default.join(process.cwd(),"data","credentials.json"),n=["ANTHROPIC_API_KEY","INSTANTLY_API_KEY","OPENAI_API_KEY","LINKEDIN_CLIENT_ID","LINKEDIN_CLIENT_SECRET"];function i(){try{if(!(0,t.existsSync)(r))return{};return JSON.parse((0,t.readFileSync)(r,"utf-8"))}catch{return{}}}async function s(){try{let e=await t.promises.readFile(r,"utf-8");return JSON.parse(e)}catch{return{}}}async function o(e){await t.promises.mkdir(a.default.dirname(r),{recursive:!0}),await t.promises.writeFile(r,JSON.stringify(e,null,2),"utf-8")}async function l(e,t){let a=await s();t&&t.trim()?a[e]=t.trim():delete a[e],await o(a)}async function d(e){let t=await s();delete t[e],await o(t)}e.s(["clearCredential",0,d,"isKnown",0,function(e){return n.includes(e)},"mask",0,function(e){return e?e.length<=8?"•".repeat(e.length):e.slice(0,6)+"•".repeat(Math.max(e.length-10,4))+e.slice(-4):""},"readCredentialsSync",0,i,"setCredential",0,l],17710);let u=null;e.s(["envVar",0,function(e){try{let t=i();if(t[e]&&t[e].length>0)return t[e]}catch{}let r=process.env[e];return r&&r.length>0?r:function(){if(u)return u;u={};try{for(let e of(0,t.readFileSync)((0,a.join)(process.cwd(),".env.local"),"utf-8").split(/\r?\n/)){let t=e.trim();if(!t||t.startsWith("#"))continue;let a=t.indexOf("=");if(a<=0)continue;let r=t.slice(0,a).trim(),n=t.slice(a+1).trim();(n.startsWith('"')&&n.endsWith('"')||n.startsWith("'")&&n.endsWith("'"))&&(n=n.slice(1,-1)),u[r]=n}}catch{}return u}()[e]??""}],55636)},24361,(e,t,a)=>{t.exports=e.x("util",()=>require("util"))},88947,(e,t,a)=>{t.exports=e.x("stream",()=>require("stream"))},92509,(e,t,a)=>{t.exports=e.x("url",()=>require("url"))},6461,(e,t,a)=>{t.exports=e.x("zlib",()=>require("zlib"))},81111,(e,t,a)=>{t.exports=e.x("node:stream",()=>require("node:stream"))},21517,(e,t,a)=>{t.exports=e.x("http",()=>require("http"))},24836,(e,t,a)=>{t.exports=e.x("https",()=>require("https"))},91896,30224,e=>{"use strict";var t=e.i(22734),a=e.i(14747);let r=a.default.join(process.cwd(),"data","skill-scopes.json");async function n(){try{return JSON.parse(await t.promises.readFile(r,"utf-8"))}catch{return{}}}async function i(e){await t.promises.mkdir(a.default.dirname(r),{recursive:!0}),await t.promises.writeFile(r,JSON.stringify(e,null,2),"utf-8")}async function s(e,t){let a=await n(),r=new Set(a[e]??[]);r.add(t),a[e]=[...r],await i(a)}async function o(e,t){let a=await n(),r=(a[e]??[]).filter(e=>e!==t);0===r.length?delete a[e]:a[e]=r,await i(a)}async function l(e){return Object.entries(await n()).filter(([,t])=>t.includes(e)).map(([e])=>e)}e.s(["addToScope",0,s,"listSkillsInScope",0,l,"removeFromScope",0,o],30224);let d=a.default.resolve(process.cwd(),"..",".agents","skills");function u(e){let t=e.replace(/\r\n/g,"\n").replace(/\r/g,"\n");if(!t.startsWith("---"))return{meta:{},body:t};let a=t.indexOf("\n---",3);if(-1===a)return{meta:{},body:t};let r=t.slice(3,a).trim(),n=t.slice(a+4).trimStart(),i={};for(let e of r.split("\n")){if(/^\s/.test(e))continue;let t=e.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);t&&(i[t[1]]=t[2].trim().replace(/^["']|["']$/g,""))}return{meta:i,body:n}}async function c(e){let r=[];try{r=await t.promises.readdir(d)}catch{return[]}let n=e?new Set(await l(e)):null,i=[];for(let e of r){if(n&&!n.has(e))continue;let r=a.default.join(d,e,"SKILL.md");try{let a=await t.promises.readFile(r,"utf-8"),{meta:n}=u(a);i.push({name:n.name??e,description:n.description??"(sin descripción)"})}catch{}}return i.sort((e,t)=>e.name.localeCompare(t.name))}async function p(e){let r;try{r=await t.promises.readdir(d)}catch{return null}let n=r.find(t=>t===e);if(!n)for(let i of r){let r=a.default.join(d,i,"SKILL.md");try{let a=await t.promises.readFile(r,"utf-8"),{meta:s}=u(a);if(s.name===e){n=i;break}}catch{}}if(!n)return null;let i=a.default.join(d,n,"SKILL.md");try{let e=await t.promises.readFile(i,"utf-8"),{meta:a,body:r}=u(e);return{name:a.name??n,description:a.description??"(sin descripción)",content:r,raw:e}}catch{return null}}e.s(["getSkill",0,p,"listSkills",0,c],91896)},59961,e=>{"use strict";var t=e.i(49729),a=e.i(93140),r=e.i(24541),n=e.i(35350),i=e.i(12297),s=e.i(73268),o=e.i(19075),l=e.i(34857),d=e.i(64115),u=e.i(99112),c=e.i(1157),p=e.i(918),m=e.i(446),f=e.i(58283),x=e.i(16868),h=e.i(93695);e.i(19034);var g=e.i(45324),w=e.i(56351),y=e.i(41299),v=e.i(55636),R=e.i(5609),E=e.i(91896);let C=`Eres un copywriter senior de LinkedIn especializado en posts B2B que generan engagement real.

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

\xbfCu\xe1ntas oportunidades est\xe1s dejando enterradas en el inbox de un lunes?`;async function S(e){let{prompt:t,has_image:a}=await e.json();if(!t||"string"!=typeof t)return w.NextResponse.json({error:"prompt required"},{status:400});let r=(0,v.envVar)("ANTHROPIC_API_KEY");if(!r)return w.NextResponse.json({error:"ANTHROPIC_API_KEY missing"},{status:500});let n=new y.default({apiKey:r}),i=await (0,R.memoryAsContext)(),s=await (0,E.listSkills)("linkedin"),o="";if(s.length){let e=await Promise.all(s.map(async e=>{let t=await (0,E.getSkill)(e.name);return t?`### Skill: ${t.name}
${t.content.slice(0,3e3)}`:""}));o=`

Skills LinkedIn instaladas (\xfasalas como gu\xeda profesional):
${e.filter(Boolean).join("\n\n---\n\n")}`}let l=`Memoria del usuario:
${i}${o}

${a?"Va con imagen adjunta — texto puede ser un poco más corto.\n\n":""}Brief:
${t}`,d=(await n.messages.create({model:"claude-opus-4-7",max_tokens:1500,system:C,messages:[{role:"user",content:l}]})).content.filter(e=>"text"===e.type).map(e=>e.text).join("\n").trim();return w.NextResponse.json({text:d})}e.s(["POST",0,S,"maxDuration",0,90,"runtime",0,"nodejs"],15923);var b=e.i(15923);let O=new t.AppRouteRouteModule({definition:{kind:a.RouteKind.APP_ROUTE,page:"/api/linkedin/draft/route",pathname:"/api/linkedin/draft",filename:"route",bundlePath:""},distDir:".next",relativeProjectDir:"",resolvedPagePath:"[project]/platform/app/api/linkedin/draft/route.ts",nextConfigOutput:"",userland:b,...{}}),{workAsyncStorage:A,workUnitAsyncStorage:N,serverHooks:k}=O;async function j(e,t,r){r.requestMeta&&(0,n.setRequestMeta)(e,r.requestMeta),O.isDev&&(0,n.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let w="/api/linkedin/draft/route";w=w.replace(/\/index$/,"")||"/";let y=await O.prepare(e,t,{srcPage:w,multiZoneDraftMode:!1});if(!y)return t.statusCode=400,t.end("Bad Request"),null==r.waitUntil||r.waitUntil.call(r,Promise.resolve()),null;let{buildId:v,deploymentId:R,params:E,nextConfig:C,parsedUrl:S,isDraftMode:b,prerenderManifest:A,routerServerContext:N,isOnDemandRevalidate:k,revalidateOnlyGenerated:j,resolvedPathname:I,clientReferenceManifest:T,serverActionsManifest:q}=y,_=(0,o.normalizeAppPath)(w),P=!!(A.dynamicRoutes[_]||A.routes[I]),L=async()=>((null==N?void 0:N.render404)?await N.render404(e,t,S,!1):t.end("This page could not be found"),null);if(P&&!b){let e=!!A.routes[I],t=A.dynamicRoutes[_];if(t&&!1===t.fallback&&!e){if(C.adapterPath)return await L();throw new h.NoFallbackError}}let $=null;!P||O.isDev||b||($="/index"===($=I)?"/":$);let D=!0===O.isDev||!P,M=P&&!D;q&&T&&(0,s.setManifestsSingleton)({page:w,clientReferenceManifest:T,serverActionsManifest:q});let F=e.method||"GET",H=(0,i.getTracer)(),U=H.getActiveScopeSpan(),K=!!(null==N?void 0:N.isWrappedByNextServer),B=!!(0,n.getRequestMeta)(e,"minimalMode"),W=(0,n.getRequestMeta)(e,"incrementalCache")||await O.getIncrementalCache(e,C,A,B);null==W||W.resetRequestCache(),globalThis.__incrementalCache=W;let z={params:E,previewProps:A.preview,renderOpts:{experimental:{authInterrupts:!!C.experimental.authInterrupts},cacheComponents:!!C.cacheComponents,supportsDynamicResponse:D,incrementalCache:W,cacheLifeProfiles:C.cacheLife,waitUntil:r.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,a,r,n)=>O.onRequestError(e,t,r,n,N)},sharedContext:{buildId:v,deploymentId:R}},V=new l.NodeNextRequest(e),J=new l.NodeNextResponse(t),Y=d.NextRequestAdapter.fromNodeNextRequest(V,(0,d.signalFromNodeResponse)(t));try{let n,s=async e=>O.handle(Y,z).finally(()=>{if(!e)return;e.setAttributes({"http.status_code":t.statusCode,"next.rsc":!1});let a=H.getRootSpanAttributes();if(!a)return;if(a.get("next.span_type")!==u.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${a.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let r=a.get("next.route");if(r){let t=`${F} ${r}`;e.setAttributes({"next.route":r,"http.route":r,"next.span_name":t}),e.updateName(t),n&&n!==e&&(n.setAttribute("http.route",r),n.updateName(t))}else e.updateName(`${F} ${w}`)}),o=async n=>{var i,o;let l=async({previousCacheEntry:a})=>{try{if(!B&&k&&j&&!a)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let i=await s(n);e.fetchMetrics=z.renderOpts.fetchMetrics;let o=z.renderOpts.pendingWaitUntil;o&&r.waitUntil&&(r.waitUntil(o),o=void 0);let l=z.renderOpts.collectedTags;if(!P)return await (0,p.sendResponse)(V,J,i,z.renderOpts.pendingWaitUntil),null;{let e=await i.blob(),t=(0,m.toNodeOutgoingHttpHeaders)(i.headers);l&&(t[x.NEXT_CACHE_TAGS_HEADER]=l),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let a=void 0!==z.renderOpts.collectedRevalidate&&!(z.renderOpts.collectedRevalidate>=x.INFINITE_CACHE)&&z.renderOpts.collectedRevalidate,r=void 0===z.renderOpts.collectedExpire||z.renderOpts.collectedExpire>=x.INFINITE_CACHE?void 0:z.renderOpts.collectedExpire;return{value:{kind:g.CachedRouteKind.APP_ROUTE,status:i.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:a,expire:r}}}}catch(t){throw(null==a?void 0:a.isStale)&&await O.onRequestError(e,t,{routerKind:"App Router",routePath:w,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:M,isOnDemandRevalidate:k})},!1,N),t}},d=await O.handleResponse({req:e,nextConfig:C,cacheKey:$,routeKind:a.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:A,isRoutePPREnabled:!1,isOnDemandRevalidate:k,revalidateOnlyGenerated:j,responseGenerator:l,waitUntil:r.waitUntil,isMinimalMode:B});if(!P)return null;if((null==d||null==(i=d.value)?void 0:i.kind)!==g.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==d||null==(o=d.value)?void 0:o.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});B||t.setHeader("x-nextjs-cache",k?"REVALIDATED":d.isMiss?"MISS":d.isStale?"STALE":"HIT"),b&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let u=(0,m.fromNodeOutgoingHttpHeaders)(d.value.headers);return B&&P||u.delete(x.NEXT_CACHE_TAGS_HEADER),!d.cacheControl||t.getHeader("Cache-Control")||u.get("Cache-Control")||u.set("Cache-Control",(0,f.getCacheControlHeader)(d.cacheControl)),await (0,p.sendResponse)(V,J,new Response(d.value.body,{headers:u,status:d.value.status||200})),null};K&&U?await o(U):(n=H.getActiveScopeSpan(),await H.withPropagatedContext(e.headers,()=>H.trace(u.BaseServerSpan.handleRequest,{spanName:`${F} ${w}`,kind:i.SpanKind.SERVER,attributes:{"http.method":F,"http.target":e.url}},o),void 0,!K))}catch(t){if(t instanceof h.NoFallbackError||await O.onRequestError(e,t,{routerKind:"App Router",routePath:_,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:M,isOnDemandRevalidate:k})},!1,N),P)throw t;return await (0,p.sendResponse)(V,J,new Response(null,{status:500})),null}}e.s(["handler",0,j,"patchFetch",0,function(){return(0,r.patchFetch)({workAsyncStorage:A,workUnitAsyncStorage:N})},"routeModule",0,O,"serverHooks",0,k,"workAsyncStorage",0,A,"workUnitAsyncStorage",0,N],59961)},91550,e=>{e.v(t=>Promise.all(["server/chunks/[root-of-the-server]__0u-m5i5._.js"].map(t=>e.l(t))).then(()=>t(96418)))}];

//# sourceMappingURL=%5Broot-of-the-server%5D__0~b94j1._.js.map