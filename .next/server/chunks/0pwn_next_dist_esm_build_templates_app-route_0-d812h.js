module.exports=[19378,e=>{"use strict";var a=e.i(49729),t=e.i(93140),s=e.i(24541),n=e.i(35350),o=e.i(12297),i=e.i(73268),r=e.i(19075),l=e.i(34857),p=e.i(64115),c=e.i(99112),d=e.i(1157),u=e.i(918),m=e.i(446),g=e.i(58283),y=e.i(16868),_=e.i(93695);e.i(19034);var f=e.i(45324),v=e.i(56351),b=e.i(41299),x=e.i(38310),h=e.i(5609),S=e.i(76550),C=e.i(98979),N=e.i(91896);let R=[{name:"read_memory",description:"Lee TODA la memoria persistente del usuario (perfil, ICPs, frameworks, ejemplos, nichos). Llámala SIEMPRE antes de redactar copy nuevo.",input_schema:{type:"object",properties:{}}},{name:"list_skills",description:"Lista las skills instaladas con su nombre y descripción corta. Útil para saber qué hay disponible antes de leer una concreta.",input_schema:{type:"object",properties:{}}},{name:"read_skill",description:"Lee el contenido completo de una skill instalada por su nombre. Úsalo cuando una skill sea relevante a la tarea (cold-email, copywriting, lead-generation, etc.). NO leas todas las skills siempre — solo las que apliquen a lo que el usuario pide.",input_schema:{type:"object",properties:{name:{type:"string",description:"nombre de la skill (ej. 'cold-email')"}},required:["name"]}},{name:"save_memory",description:"Guarda o actualiza una entrada de memoria. Usa categorias como: identity, icp, value-prop, framework, niche, examples-good, examples-bad.",input_schema:{type:"object",properties:{title:{type:"string"},category:{type:"string"},content:{type:"string"},slug:{type:"string",description:"opcional, para sobreescribir una entrada existente"}},required:["title","category","content"]}},{name:"delete_memory",description:"Borra una entrada de memoria por su slug.",input_schema:{type:"object",properties:{slug:{type:"string"}},required:["slug"]}},{name:"list_campaigns_local",description:"Lista las campañas creadas desde esta plataforma (historial local con metadata).",input_schema:{type:"object",properties:{}}},{name:"list_campaigns_instantly",description:"Lista las campañas existentes en la cuenta de Instantly del usuario.",input_schema:{type:"object",properties:{limit:{type:"number",default:20}}}},{name:"create_campaign",description:`Crea una campa\xf1a de cold email en Instantly (siempre PAUSADA).
ESTRUCTURA: 4 steps (initial + 3 follow-ups), 3 variants A/B/C cada uno.
Solo step 1 lleva subject. Steps 2-4 con subject="".
Variables disponibles: {{firstName}} {{companyName}} {{industry}} {{city}}.

EL BODY ES HTML, NO TEXTO PLANO.

Cada bloque va envuelto en <p>...</p>. Para resaltar palabras clave (1-3 por email m\xe1ximo) usar <strong>...</strong>. Para forzar un salto de l\xednea suave dentro de un mismo p\xe1rrafo, <br>.

Plantilla obligatoria del primer email (HTML real, 8 bloques en <p>):

<p>Hola {{firstName}},</p>
<p>Soy Xavi. Te vi por <strong>LinkedIn</strong> y, tras analizar a {{companyName}}, decid\xed investigaros a fondo. Solo contacto con empresas muy selectas donde s\xe9 que puedo escalar resultados de calidad.</p>
<p>Seguro que est\xe1s harto de plantillas gen\xe9ricas, as\xed que voy al grano: <strong>dise\xf1amos estrategias personalizadas</strong> para que no depend\xe1is de agencias de Lead Gen y sus cuotas infinitas. Os montamos vuestro propio canal para captar decisores dispuestos a comprar.</p>
<p>Te contacto precisamente porque hemos trabajado con una empresa similar a {{companyName}} y hemos logrado <strong>una media de 4 reuniones semanales constantes</strong>. S\xe9 exactamente c\xf3mo conseguirlo tambi\xe9n para vosotros.</p>
<p>He preparado un <strong>estudio personalizado</strong> y una IA gratis para {{companyName}} para ayudaros con la captaci\xf3n.</p>
<p>\xbfTe va bien verlo en <strong>10 minutos esta semana</strong>?</p>
<p>Si no, d\xedmelo y lo dejamos aqu\xed.</p>
<p>Un saludo,<br>Xavi Riera</p>

REGLAS:
- Cada bloque OBLIGATORIO en su <p>...</p>. NUNCA dos bloques en un mismo <p>.
- <strong> SOLO en lo realmente importante (gancho, n\xfamero, CTA). M\xe1ximo 3-4 <strong> por email.
- Despedida con <br> entre "Un saludo," y "Xavi Riera" para que queden en l\xedneas separadas dentro del mismo <p>.
- Frases m\xe1ximo 20 palabras. Bloques m\xe1ximo 3 l\xedneas.
- LinkedIn como \xfanica fuente del touch. Nunca "vi tu web", "tu newsletter".
- Castellano Espa\xf1a. Sin emojis. Sin "estimado", sin "saludos cordiales".

Follow-ups (steps 2-4): subject CON variable y texto distinto al step 1. Mismo formato HTML con <p> entre bloques. Cada FU aporta algo nuevo (dato concreto, caso real con n\xfamero, breakup invitando).

SUBJECTS — TODOS los steps llevan subject con variable obligatoria, sin excepci\xf3n:
- Step 1 (initial): "idea para {{companyName}}", "te dejaste esto en {{companyName}}", "{{firstName}}, una propuesta", "{{companyName}} + pipeline".
- FU#1 (3d, bump): "{{firstName}}, \xbflo viste?", "subo esto, {{firstName}}", "{{companyName}}, \xbflo viste?".
- FU#2 (4d, caso real): "{{firstName}}, un dato concreto", "caso real para {{companyName}}", "{{firstName}}, pregunta directa".
- FU#3 (5d, breakup): "\xfaltima por aqu\xed, {{firstName}}", "cierro hilo, {{companyName}}", "{{firstName}}, lo dejo aqu\xed".

Reglas duras de subjects: 4-7 palabras m\xe1ximo, min\xfascula inicial, sin emojis, sin signos de exclamaci\xf3n, variable obligatoria ({{firstName}} o {{companyName}}).`,input_schema:{type:"object",properties:{name:{type:"string"},niche:{type:"string",description:"nicho objetivo, p.ej. 'aerospace spain'"},goal:{type:"string",description:"objetivo, p.ej. 'agendar demo de 10 min'"},steps:{type:"array",items:{type:"object",properties:{delay:{type:"number",description:"días de delay (0 para el primer step)"},variants:{type:"array",items:{type:"object",properties:{subject:{type:"string"},body:{type:"string"}},required:["subject","body"]}}},required:["delay","variants"]}}},required:["name","steps"]}},{name:"upload_email_accounts_from_csv_file",description:"Sube cuentas de email (mailboxes de envío) a Instantly desde un CSV adjunto y opcionalmente activa warmup. Requiere SMTP host/port/password y IMAP host/port/password. Usa esto cuando el usuario quiera 'añadir cuentas', 'subir mailboxes', 'cargar emails con warmup', etc. Mira las 'columns' del CSV adjunto para mapear bien.",input_schema:{type:"object",properties:{file_id:{type:"string",description:"El file_id del [CSV ATTACHED: ...]"},column_mapping:{type:"object",description:"Mapeo: keys son campos de Instantly, values son los nombres EXACTOS de columnas del CSV. Requeridos: email, smtp_host, smtp_port, smtp_password, imap_host, imap_port, imap_password.",properties:{email:{type:"string"},smtp_host:{type:"string"},smtp_port:{type:"string"},smtp_username:{type:"string"},smtp_password:{type:"string"},imap_host:{type:"string"},imap_port:{type:"string"},imap_username:{type:"string"},imap_password:{type:"string"},first_name:{type:"string"},last_name:{type:"string"},daily_limit:{type:"string"},warmup_limit:{type:"string"}},required:["email","smtp_host","smtp_port","smtp_password","imap_host","imap_port","imap_password"]},enable_warmup:{type:"boolean",description:"Si true, activa warmup en todas las cuentas tras crearlas. Default true."},tag_name:{type:"string",description:"Opcional. Si se pasa, crea (o reutiliza) un tag con ese nombre y lo asigna a todas las cuentas creadas. Ej: 'Q3-2026', 'Aerospace ES', 'Cliente onepulso'."}},required:["file_id","column_mapping"]}},{name:"upload_leads_from_csv_file",description:"Sube leads a una campaña existente desde un CSV que el usuario ya adjuntó (file_id). NO necesitas pasar las filas — la plataforma lee el archivo del disco. Tú solo decides qué columna del CSV mapea a cada campo de Instantly. Mira las 'columns' del adjunto en el mensaje del usuario para elegir bien.",input_schema:{type:"object",properties:{file_id:{type:"string",description:"El file_id que aparece en el [CSV ATTACHED: ...]"},campaign_id:{type:"string",description:"ID de la campaña en Instantly"},column_mapping:{type:"object",description:"Mapeo de columnas del CSV a campos de Instantly. La key es el campo de Instantly (email, first_name, last_name, company_name) y el valor es el nombre exacto de la columna en el CSV. Para custom_variables, usar un sub-objeto con keys = nombre de la variable Instantly y values = nombre de la columna.",properties:{email:{type:"string"},first_name:{type:"string"},last_name:{type:"string"},company_name:{type:"string"},custom_variables:{type:"object"}},required:["email"]}},required:["file_id","campaign_id","column_mapping"]}}];async function A(e,a,t={}){try{switch(e){case"read_memory":return await (0,h.memoryAsContext)();case"list_skills":{let e=await (0,N.listSkills)("campaigns");if(0===e.length)return"(sin skills instaladas en este módulo)";return e.map(e=>`- ${e.name}: ${e.description}`).join("\n")}case"read_skill":{let e=await (0,N.getSkill)(a.name);if(!e)return`Skill '${a.name}' no encontrada. Usa list_skills para ver las disponibles.`;return`# ${e.name}

_${e.description}_

${e.content}`}case"save_memory":{let e=await (0,h.saveMemory)(a);return`Guardado: ${e.slug}`}case"delete_memory":return await (0,h.deleteMemory)(a.slug),`Borrado: ${a.slug}`;case"list_campaigns_local":{let e=await (0,S.listCampaignRecords)();return JSON.stringify(e,null,2)}case"list_campaigns_instantly":{let e=((await (0,x.listCampaigns)(a.limit??20)).items??[]).map(e=>({id:e.id,name:e.name,status:e.status,created:e.timestamp_created}));return JSON.stringify(e,null,2)}case"create_campaign":{let e=[];for(let t=0;t<a.steps.length;t++){let s=a.steps[t];for(let a=0;a<s.variants.length;a++){let n=s.variants[a].body??"",o=s.variants[a].subject??"",i=/<p[\s>]/i.test(n),r=(n.match(/<p[\s>]/gi)??[]).length,l=/<strong[\s>]/i.test(n),p=0===t?6:3;o&&o.trim()?o.includes("{{firstName}}")||o.includes("{{companyName}}")?o.split(/\s+/).length>8&&e.push(`step ${t+1} variant ${a+1}: subject "${o}" demasiado largo. M\xe1ximo 7 palabras.`):e.push(`step ${t+1} variant ${a+1}: subject "${o}" sin variable. Tiene que llevar {{firstName}} o {{companyName}}.`):e.push(`step ${t+1} variant ${a+1}: subject vac\xedo. TODOS los steps llevan subject con variable, sin excepci\xf3n.`),i?r<p&&e.push(`step ${t+1} variant ${a+1}: solo ${r} bloques <p>, m\xednimo ${p} para este step.`):e.push(`step ${t+1} variant ${a+1}: body sin <p>. Debe ser HTML con cada bloque envuelto en <p>...</p>.`),0!==t||l||e.push(`step 1 variant ${a+1}: sin <strong>. Marca 3-4 palabras clave en negrita.`),n.includes("\n\n")&&!i&&e.push(`step ${t+1} variant ${a+1}: parece texto plano con saltos de l\xednea, no HTML.`)}}if(e.length>0)return JSON.stringify({error:"VALIDATION_FAILED",action_required:"REGENERA TODOS LOS BODIES como HTML válido y vuelve a llamar a create_campaign con los mismos params pero los bodies arreglados. NO le digas al usuario que ha fallado — simplemente reintenta corrigiendo los bodies. Usa la plantilla EXACTA del read_skill('onepulso-campaign-structure'): cada bloque en <p>...</p>, palabras clave en <strong>...</strong>, firma con <p>Un saludo,<br>Xavi Riera</p>.",issues:e,example_correct_body:"<p>Hola {{firstName}},</p><p>Soy Xavi. Te vi por <strong>LinkedIn</strong>...</p><p>...<strong>4 reuniones semanales</strong>...</p><p>¿Te va bien verlo en <strong>10 minutos esta semana</strong>?</p><p>Si no, dímelo y lo dejamos aquí.</p><p>Un saludo,<br>Xavi Riera</p>"});let s=await (0,x.createCampaign)({name:a.name,steps:a.steps});return await (0,S.addCampaignRecord)({id:s.id,name:s.name,niche:a.niche,goal:a.goal,steps_count:a.steps.length,variants_per_step:a.steps.map(e=>e.variants.length),conversation_id:t.conversation_id,created_at:new Date().toISOString()}),JSON.stringify({id:s.id,name:s.name,status:"draft (pausada)",steps:a.steps.length,variants_per_step:a.steps.map(e=>e.variants.length)})}case"upload_email_accounts_from_csv_file":{let e=await (0,C.readCSVAsAccounts)(a.file_id,a.column_mapping);if(0===e.length)return JSON.stringify({error:"0 cuentas válidas extraídas del CSV."});let t=await (0,x.createAccountsBatch)(e),s=!1!==a.enable_warmup,n=null;if(s&&t.created.length>0)try{n=await (0,x.enableWarmupForEmails)(t.created)}catch(e){n={error:e.message}}let o=null;if(a.tag_name&&t.created.length>0)try{let e=await (0,x.ensureTag)(a.tag_name);await (0,x.assignTagToAccounts)(e,t.created),o={tag_name:a.tag_name,tag_id:e,assigned_to:t.created.length}}catch(e){o={error:e.message}}return JSON.stringify({parsed_from_csv:e.length,accounts_created:t.ok,accounts_failed:t.fail,first_errors:t.errors.slice(0,5),warmup_enabled:s,warmup_result:n,tag_result:o})}case"upload_leads_from_csv_file":{let e=await (0,C.readCSVAsLeads)(a.file_id,a.column_mapping);if(0===e.length)return JSON.stringify({error:"0 leads válidos extraídos del CSV. Verifica que la columna de email exista y contenga emails."});let t=await (0,x.uploadLeadsBatch)(a.campaign_id,e);return await (0,S.updateCampaignRecord)(a.campaign_id,{leads_uploaded:t.ok}),JSON.stringify({parsed_from_csv:e.length,uploaded_ok:t.ok,failed:t.fail,first_errors:t.errors.slice(0,5)})}default:return`Tool desconocido: ${e}`}}catch(e){return`ERROR: ${e.message}`}}let E=`Eres el copiloto de cold email de Xavi, due\xf1o de **onepulso** (agencia de lead generation B2B). Tu trabajo es generar campa\xf1as que conviertan, no relleno.

## FLUJO OBLIGATORIO

1. Si la pregunta implica redactar copy o crear campa\xf1a → SIEMPRE llama PRIMERO a read_memory. Sin excepci\xf3n.
2. Lee con atenci\xf3n las entradas de category 'examples-good' y 'framework' — son la gu\xeda definitiva de tono, estructura y nivel de detalle. Imita ese estilo.
3. Si Xavi te da info nueva sobre negocio, ICPs, tono o ejemplos ganadores → llama a save_memory.

## CREAR CAMPA\xd1AS (regla estricta)

ANTES de llamar a create_campaign, OBLIGATORIO esta secuencia:
1. read_memory (siempre).
2. read_skill('onepulso-campaign-structure') — esta skill define la plantilla EXACTA, formato HTML, negritas, subjects y follow-ups. ES INNEGOCIABLE seguirla literalmente.
3. Construir el JSON con cada body en HTML siguiendo la plantilla.
4. Llamar a create_campaign.

Cuando uses create_campaign, OBLIGATORIO:
- 4 steps. Delays: 0d, 3d, 4d, 5d.
- 3 variantes por cada step. NUNCA menos de 3.
- TODAS las variantes de TODOS los steps (incluidos follow-ups) llevan SUBJECT con variable obligatoria. Sin excepci\xf3n. NUNCA subject="" — siempre con texto y al menos {{firstName}} o {{companyName}}.
- Variables {{firstName}}, {{companyName}}, {{industry}}, {{city}} repartidas en TODAS las variantes (m\xednimo 3 de las 4 por variante).
- Castellano Espa\xf1a, sin emojis, sin frases de relleno, sin "estimado/saludos cordiales".
- Firma: "Xavi Riera" en step 1; en FU#2-4 puede ser solo "Xavi".

### FORMATO DEL BODY (no negociable)

El body es **HTML**. Cada bloque va en su <p>...</p>. Las palabras clave en <strong>...</strong>. Saltos suaves con <br>.

Plantilla obligatoria del step 1:

<p>Hola {{firstName}},</p>
<p>Soy Xavi. Te vi por <strong>LinkedIn</strong> y, tras analizar a {{companyName}}, decid\xed investigaros a fondo. Solo contacto con empresas muy selectas donde s\xe9 que puedo escalar resultados de calidad.</p>
<p>Seguro que est\xe1s harto de plantillas gen\xe9ricas, as\xed que voy al grano: <strong>dise\xf1amos estrategias personalizadas</strong> para que no depend\xe1is de agencias de Lead Gen y sus cuotas infinitas.</p>
<p>Te contacto precisamente porque hemos trabajado con una empresa similar a {{companyName}} y hemos logrado <strong>4 reuniones semanales constantes</strong>.</p>
<p>He preparado un <strong>estudio personalizado</strong> gratis para {{companyName}} sobre captaci\xf3n.</p>
<p>\xbfTe va bien verlo en <strong>10 minutos esta semana</strong>?</p>
<p>Si no, d\xedmelo y lo dejamos aqu\xed.</p>
<p>Un saludo,<br>Xavi Riera</p>

REGLAS:
- Cada bloque en su propio <p>. NUNCA dos bloques en un mismo <p>.
- <strong> en m\xe1ximo 3-4 expresiones clave por email (gancho, n\xfamero, CTA). NO bold por bold.
- LinkedIn SIEMPRE como fuente del touch. Nunca "vi tu web" ni "tu newsletter".
- Frases m\xe1ximo 20 palabras. Bloques m\xe1ximo 3 l\xedneas.
- Cada email suena a investigaci\xf3n REAL del nicho con datos sectoriales concretos (OEMs, ARR, MRR, MROs seg\xfan industria). NO copy reutilizable.
- Inventa un caso concreto del sector con n\xfamero en el FU#2.
- Castellano Espa\xf1a. Sin emojis. Sin "estimado", sin "saludos cordiales".

Si el usuario no te da nicho/objetivo claro, PREGUNTA antes de redactar.

ANTES de llamar a create_campaign: \xbfcada body tiene <p> en CADA bloque? \xbfHay <strong> en lo importante? Si no, reformat\xe9alo.

## SUBIR EMAIL ACCOUNTS (mailboxes de env\xedo)

Si el usuario adjunta un CSV con columnas que parecen credenciales SMTP/IMAP (smtp_host, smtp_password, imap_host, etc.) y dice "subir cuentas", "a\xf1adir mailboxes", "cargar emails con warmup", "conectar cuentas a Instantly", "activar warmup en estas" o similar → usa upload_email_accounts_from_csv_file. Por defecto activa warmup tambi\xe9n (enable_warmup=true) salvo que diga lo contrario.

NO confundas con upload_leads (esos son destinatarios, los accounts son las cuentas que env\xedan).

## SUBIR LEADS (cr\xedtico)

Cuando Xavi adjunte un CSV en el chat, ver\xe1s algo como:
[CSV ATTACHED: archivo.csv]
file_id: abc-123
rows: 2000
columns: First Name, Company Name, Email, Industry, City, ...
preview (3 rows): {...}

Para subir esos leads → usa SIEMPRE el tool upload_leads_from_csv_file. NUNCA inventes ni copies filas a mano. P\xe1sale el file_id, el campaign_id y el column_mapping eligiendo bien las columnas reales del CSV. Para campos como industry/city que NO son nativos de Instantly, p\xe1salos en custom_variables.

Ejemplo correcto de column_mapping:
{
  "email": "Email",
  "first_name": "First Name",
  "last_name": "Last Name",
  "company_name": "Company Name",
  "custom_variables": { "industry": "Industry", "city": "City" }
}

Avisa que la subida tarda ~2 min por cada 2000 leads. Despu\xe9s de subir, confirma cu\xe1ntos OK / cu\xe1ntos fallaron.

## ESTILO DE RESPUESTA

- Directo, sin rodeos. Como un colega senior. Sin "claro, por supuesto", sin "perfecto, vamos a...".
- Cuando ejecutes algo, hazlo y reporta resultado conciso. No pidas confirmaci\xf3n si la instrucci\xf3n est\xe1 clara.
- Despu\xe9s de crear campa\xf1a: ID, status, steps \xd7 variantes, siguiente paso (asignar email accounts en UI).
- Si algo falla, di exactamente qu\xe9 fall\xf3 y prop\xf3n fix.

## NUNCA

- Generar copy sin haber le\xeddo memoria.
- Hacer menos de 3 variantes por step.
- Subir leads inventando filas en lugar de usar upload_leads_from_csv_file con file_id.
- Activar campa\xf1as (siempre se crean pausadas).
- Inventar IDs, emails, m\xe9tricas que no tengas.

## SKILLS (lectura bajo demanda)

Tienes una librer\xeda de skills instaladas que son packages con conocimiento especializado (cold-email, copywriting, lead-generation, etc). NO se cargan autom\xe1ticamente para no inflar el contexto. T\xfa decides cu\xe1ndo abrirlas.

Reglas:
- Cuando la petici\xf3n del usuario tenga que ver con cold email / outbound / secuencias → llama list_skills primero, luego read_skill('cold-email') y/o read_skill('copywriting') si est\xe1n instaladas.
- Para lead generation con scrapers/Apollo → read_skill('apify-lead-generation') si aplica.
- Para secuencias estructuradas estilo Coldiq → read_skill('cold-email-4-sequence').
- Si no hay skill claramente relevante, no fuerces. Trabaja con la memoria.

Las skills son gu\xedas de estilo y procesos profesionales. Cuando encuentres una \xfatil, sigue sus consejos al redactar.`;var w=e.i(55636);async function T(e){let a=await e.json(),t=a.messages,s=a.conversation_id,n=(0,w.envVar)("ANTHROPIC_API_KEY");if(!n)return v.NextResponse.json({error:"Falta ANTHROPIC_API_KEY en .env.local. Crea una key en console.anthropic.com y pégala ahí."},{status:500});let o=new b.default({apiKey:n,maxRetries:4,timeout:18e4}),i=t.map(e=>({role:e.role,content:e.content})),r=[];for(let e=0;e<20;e++){let a;try{a=await o.messages.create({model:"claude-opus-4-7",max_tokens:16e3,system:E,tools:R,messages:i})}catch(a){r.push({type:"text",data:`

⚠️ Error llamando a Claude: ${a.message??String(a)}. Iteraci\xf3n ${e+1}/20. Reintenta el mensaje si quieres.`});break}i.push({role:"assistant",content:a.content});let t=a.content.filter(e=>"tool_use"===e.type);for(let e of a.content)"text"===e.type&&e.text?r.push({type:"text",data:e.text}):"tool_use"===e.type&&r.push({type:"tool_use",data:{name:e.name,input:e.input}});if("tool_use"!==a.stop_reason||0===t.length)break;let n=[];for(let e of t){let a=await A(e.name,e.input,{conversation_id:s});r.push({type:"tool_result",data:{name:e.name,output:a.slice(0,600)}}),n.push({type:"tool_result",tool_use_id:e.id,content:a})}i.push({role:"user",content:n})}return v.NextResponse.json({events:r})}e.s(["POST",0,T,"maxDuration",0,300,"runtime",0,"nodejs"],96237);var O=e.i(96237);let q=new a.AppRouteRouteModule({definition:{kind:t.RouteKind.APP_ROUTE,page:"/api/chat/route",pathname:"/api/chat",filename:"route",bundlePath:""},distDir:".next",relativeProjectDir:"",resolvedPagePath:"[project]/platform/app/api/chat/route.ts",nextConfigOutput:"",userland:O,...{}}),{workAsyncStorage:j,workUnitAsyncStorage:I,serverHooks:k}=q;async function L(e,a,s){s.requestMeta&&(0,n.setRequestMeta)(e,s.requestMeta),q.isDev&&(0,n.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let v="/api/chat/route";v=v.replace(/\/index$/,"")||"/";let b=await q.prepare(e,a,{srcPage:v,multiZoneDraftMode:!1});if(!b)return a.statusCode=400,a.end("Bad Request"),null==s.waitUntil||s.waitUntil.call(s,Promise.resolve()),null;let{buildId:x,deploymentId:h,params:S,nextConfig:C,parsedUrl:N,isDraftMode:R,prerenderManifest:A,routerServerContext:E,isOnDemandRevalidate:w,revalidateOnlyGenerated:T,resolvedPathname:O,clientReferenceManifest:j,serverActionsManifest:I}=b,k=(0,r.normalizeAppPath)(v),L=!!(A.dynamicRoutes[k]||A.routes[O]),P=async()=>((null==E?void 0:E.render404)?await E.render404(e,a,N,!1):a.end("This page could not be found"),null);if(L&&!R){let e=!!A.routes[O],a=A.dynamicRoutes[k];if(a&&!1===a.fallback&&!e){if(C.adapterPath)return await P();throw new _.NoFallbackError}}let M=null;!L||q.isDev||R||(M="/index"===(M=O)?"/":M);let U=!0===q.isDev||!L,D=L&&!U;I&&j&&(0,i.setManifestsSingleton)({page:v,clientReferenceManifest:j,serverActionsManifest:I});let H=e.method||"GET",$=(0,o.getTracer)(),B=$.getActiveScopeSpan(),F=!!(null==E?void 0:E.isWrappedByNextServer),V=!!(0,n.getRequestMeta)(e,"minimalMode"),X=(0,n.getRequestMeta)(e,"incrementalCache")||await q.getIncrementalCache(e,C,A,V);null==X||X.resetRequestCache(),globalThis.__incrementalCache=X;let G={params:S,previewProps:A.preview,renderOpts:{experimental:{authInterrupts:!!C.experimental.authInterrupts},cacheComponents:!!C.cacheComponents,supportsDynamicResponse:U,incrementalCache:X,cacheLifeProfiles:C.cacheLife,waitUntil:s.waitUntil,onClose:e=>{a.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(a,t,s,n)=>q.onRequestError(e,a,s,n,E)},sharedContext:{buildId:x,deploymentId:h}},z=new l.NodeNextRequest(e),J=new l.NodeNextResponse(a),K=p.NextRequestAdapter.fromNodeNextRequest(z,(0,p.signalFromNodeResponse)(a));try{let n,i=async e=>q.handle(K,G).finally(()=>{if(!e)return;e.setAttributes({"http.status_code":a.statusCode,"next.rsc":!1});let t=$.getRootSpanAttributes();if(!t)return;if(t.get("next.span_type")!==c.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${t.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let s=t.get("next.route");if(s){let a=`${H} ${s}`;e.setAttributes({"next.route":s,"http.route":s,"next.span_name":a}),e.updateName(a),n&&n!==e&&(n.setAttribute("http.route",s),n.updateName(a))}else e.updateName(`${H} ${v}`)}),r=async n=>{var o,r;let l=async({previousCacheEntry:t})=>{try{if(!V&&w&&T&&!t)return a.statusCode=404,a.setHeader("x-nextjs-cache","REVALIDATED"),a.end("This page could not be found"),null;let o=await i(n);e.fetchMetrics=G.renderOpts.fetchMetrics;let r=G.renderOpts.pendingWaitUntil;r&&s.waitUntil&&(s.waitUntil(r),r=void 0);let l=G.renderOpts.collectedTags;if(!L)return await (0,u.sendResponse)(z,J,o,G.renderOpts.pendingWaitUntil),null;{let e=await o.blob(),a=(0,m.toNodeOutgoingHttpHeaders)(o.headers);l&&(a[y.NEXT_CACHE_TAGS_HEADER]=l),!a["content-type"]&&e.type&&(a["content-type"]=e.type);let t=void 0!==G.renderOpts.collectedRevalidate&&!(G.renderOpts.collectedRevalidate>=y.INFINITE_CACHE)&&G.renderOpts.collectedRevalidate,s=void 0===G.renderOpts.collectedExpire||G.renderOpts.collectedExpire>=y.INFINITE_CACHE?void 0:G.renderOpts.collectedExpire;return{value:{kind:f.CachedRouteKind.APP_ROUTE,status:o.status,body:Buffer.from(await e.arrayBuffer()),headers:a},cacheControl:{revalidate:t,expire:s}}}}catch(a){throw(null==t?void 0:t.isStale)&&await q.onRequestError(e,a,{routerKind:"App Router",routePath:v,routeType:"route",revalidateReason:(0,d.getRevalidateReason)({isStaticGeneration:D,isOnDemandRevalidate:w})},!1,E),a}},p=await q.handleResponse({req:e,nextConfig:C,cacheKey:M,routeKind:t.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:A,isRoutePPREnabled:!1,isOnDemandRevalidate:w,revalidateOnlyGenerated:T,responseGenerator:l,waitUntil:s.waitUntil,isMinimalMode:V});if(!L)return null;if((null==p||null==(o=p.value)?void 0:o.kind)!==f.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==p||null==(r=p.value)?void 0:r.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});V||a.setHeader("x-nextjs-cache",w?"REVALIDATED":p.isMiss?"MISS":p.isStale?"STALE":"HIT"),R&&a.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let c=(0,m.fromNodeOutgoingHttpHeaders)(p.value.headers);return V&&L||c.delete(y.NEXT_CACHE_TAGS_HEADER),!p.cacheControl||a.getHeader("Cache-Control")||c.get("Cache-Control")||c.set("Cache-Control",(0,g.getCacheControlHeader)(p.cacheControl)),await (0,u.sendResponse)(z,J,new Response(p.value.body,{headers:c,status:p.value.status||200})),null};F&&B?await r(B):(n=$.getActiveScopeSpan(),await $.withPropagatedContext(e.headers,()=>$.trace(c.BaseServerSpan.handleRequest,{spanName:`${H} ${v}`,kind:o.SpanKind.SERVER,attributes:{"http.method":H,"http.target":e.url}},r),void 0,!F))}catch(a){if(a instanceof _.NoFallbackError||await q.onRequestError(e,a,{routerKind:"App Router",routePath:k,routeType:"route",revalidateReason:(0,d.getRevalidateReason)({isStaticGeneration:D,isOnDemandRevalidate:w})},!1,E),L)throw a;return await (0,u.sendResponse)(z,J,new Response(null,{status:500})),null}}e.s(["handler",0,L,"patchFetch",0,function(){return(0,s.patchFetch)({workAsyncStorage:j,workUnitAsyncStorage:I})},"routeModule",0,q,"serverHooks",0,k,"workAsyncStorage",0,j,"workUnitAsyncStorage",0,I],19378)}];

//# sourceMappingURL=0pwn_next_dist_esm_build_templates_app-route_0-d812h.js.map