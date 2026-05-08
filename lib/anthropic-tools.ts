import Anthropic from "@anthropic-ai/sdk";
import { createCampaign, listCampaigns, uploadLeadsBatch, createAccountsBatch, enableWarmupForEmails, ensureTag, assignTagToAccounts } from "./instantly";
import { listMemory, saveMemory, memoryAsContext, deleteMemory } from "./memory";
import { addCampaignRecord, listCampaignRecords, updateCampaignRecord } from "./campaigns-store";
import { readCSVAsLeads, readCSVAsAccounts } from "./csv";
import { listSkills, getSkill, skillsCatalogForPrompt } from "./skills";

export const tools: Anthropic.Messages.Tool[] = [
  {
    name: "read_memory",
    description:
      "Lee TODA la memoria persistente del usuario (perfil, ICPs, frameworks, ejemplos, nichos). Llámala SIEMPRE antes de redactar copy nuevo.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_skills",
    description:
      "Lista las skills instaladas con su nombre y descripción corta. Útil para saber qué hay disponible antes de leer una concreta.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "read_skill",
    description:
      "Lee el contenido completo de una skill instalada por su nombre. Úsalo cuando una skill sea relevante a la tarea (cold-email, copywriting, lead-generation, etc.). NO leas todas las skills siempre — solo las que apliquen a lo que el usuario pide.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string", description: "nombre de la skill (ej. 'cold-email')" } },
      required: ["name"],
    },
  },
  {
    name: "save_memory",
    description: "Guarda o actualiza una entrada de memoria. Usa categorias como: identity, icp, value-prop, framework, niche, examples-good, examples-bad.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        category: { type: "string" },
        content: { type: "string" },
        slug: { type: "string", description: "opcional, para sobreescribir una entrada existente" },
      },
      required: ["title", "category", "content"],
    },
  },
  {
    name: "delete_memory",
    description: "Borra una entrada de memoria por su slug.",
    input_schema: {
      type: "object",
      properties: { slug: { type: "string" } },
      required: ["slug"],
    },
  },
  {
    name: "list_campaigns_local",
    description: "Lista las campañas creadas desde esta plataforma (historial local con metadata).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_campaigns_instantly",
    description: "Lista las campañas existentes en la cuenta de Instantly del usuario.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number", default: 20 } },
    },
  },
  {
    name: "create_campaign",
    description:
      `Crea una campaña de cold email en Instantly (siempre PAUSADA).
ESTRUCTURA: 4 steps (initial + 3 follow-ups), 3 variants A/B/C cada uno.
Solo step 1 lleva subject. Steps 2-4 con subject="".
Variables disponibles: {{firstName}} {{companyName}} {{industry}} {{city}}.

EL BODY ES HTML, NO TEXTO PLANO.

Cada bloque va envuelto en <p>...</p>. Para resaltar palabras clave (1-3 por email máximo) usar <strong>...</strong>. Para forzar un salto de línea suave dentro de un mismo párrafo, <br>.

Plantilla obligatoria del primer email (HTML real, 8 bloques en <p>):

<p>Hola {{firstName}},</p>
<p>Soy Xavi. Te vi por <strong>LinkedIn</strong> y, tras analizar a {{companyName}}, decidí investigaros a fondo. Solo contacto con empresas muy selectas donde sé que puedo escalar resultados de calidad.</p>
<p>Seguro que estás harto de plantillas genéricas, así que voy al grano: <strong>diseñamos estrategias personalizadas</strong> para que no dependáis de agencias de Lead Gen y sus cuotas infinitas. Os montamos vuestro propio canal para captar decisores dispuestos a comprar.</p>
<p>Te contacto precisamente porque hemos trabajado con una empresa similar a {{companyName}} y hemos logrado <strong>una media de 4 reuniones semanales constantes</strong>. Sé exactamente cómo conseguirlo también para vosotros.</p>
<p>He preparado un <strong>estudio personalizado</strong> y una IA gratis para {{companyName}} para ayudaros con la captación.</p>
<p>¿Te va bien verlo en <strong>10 minutos esta semana</strong>?</p>
<p>Si no, dímelo y lo dejamos aquí.</p>
<p>Un saludo,<br>Xavi Riera</p>

REGLAS:
- Cada bloque OBLIGATORIO en su <p>...</p>. NUNCA dos bloques en un mismo <p>.
- <strong> SOLO en lo realmente importante (gancho, número, CTA). Máximo 3-4 <strong> por email.
- Despedida con <br> entre "Un saludo," y "Xavi Riera" para que queden en líneas separadas dentro del mismo <p>.
- Frases máximo 20 palabras. Bloques máximo 3 líneas.
- LinkedIn como única fuente del touch. Nunca "vi tu web", "tu newsletter".
- Castellano España. Sin emojis. Sin "estimado", sin "saludos cordiales".

Follow-ups (steps 2-4): subject CON variable y texto distinto al step 1. Mismo formato HTML con <p> entre bloques. Cada FU aporta algo nuevo (dato concreto, caso real con número, breakup invitando).

SUBJECTS — TODOS los steps llevan subject con variable obligatoria, sin excepción:
- Step 1 (initial): "idea para {{companyName}}", "te dejaste esto en {{companyName}}", "{{firstName}}, una propuesta", "{{companyName}} + pipeline".
- FU#1 (3d, bump): "{{firstName}}, ¿lo viste?", "subo esto, {{firstName}}", "{{companyName}}, ¿lo viste?".
- FU#2 (4d, caso real): "{{firstName}}, un dato concreto", "caso real para {{companyName}}", "{{firstName}}, pregunta directa".
- FU#3 (5d, breakup): "última por aquí, {{firstName}}", "cierro hilo, {{companyName}}", "{{firstName}}, lo dejo aquí".

Reglas duras de subjects: 4-7 palabras máximo, minúscula inicial, sin emojis, sin signos de exclamación, variable obligatoria ({{firstName}} o {{companyName}}).`,
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        niche: { type: "string", description: "nicho objetivo, p.ej. 'aerospace spain'" },
        goal: { type: "string", description: "objetivo, p.ej. 'agendar demo de 10 min'" },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              delay: { type: "number", description: "días de delay (0 para el primer step)" },
              variants: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    subject: { type: "string" },
                    body: { type: "string" },
                  },
                  required: ["subject", "body"],
                },
              },
            },
            required: ["delay", "variants"],
          },
        },
      },
      required: ["name", "steps"],
    },
  },
  {
    name: "upload_email_accounts_from_csv_file",
    description:
      "Sube cuentas de email (mailboxes de envío) a Instantly desde un CSV adjunto y opcionalmente activa warmup. Requiere SMTP host/port/password y IMAP host/port/password. Usa esto cuando el usuario quiera 'añadir cuentas', 'subir mailboxes', 'cargar emails con warmup', etc. Mira las 'columns' del CSV adjunto para mapear bien.",
    input_schema: {
      type: "object",
      properties: {
        file_id: { type: "string", description: "El file_id del [CSV ATTACHED: ...]" },
        column_mapping: {
          type: "object",
          description:
            "Mapeo: keys son campos de Instantly, values son los nombres EXACTOS de columnas del CSV. Requeridos: email, smtp_host, smtp_port, smtp_password, imap_host, imap_port, imap_password.",
          properties: {
            email: { type: "string" },
            smtp_host: { type: "string" },
            smtp_port: { type: "string" },
            smtp_username: { type: "string" },
            smtp_password: { type: "string" },
            imap_host: { type: "string" },
            imap_port: { type: "string" },
            imap_username: { type: "string" },
            imap_password: { type: "string" },
            first_name: { type: "string" },
            last_name: { type: "string" },
            daily_limit: { type: "string" },
            warmup_limit: { type: "string" },
          },
          required: ["email", "smtp_host", "smtp_port", "smtp_password", "imap_host", "imap_port", "imap_password"],
        },
        enable_warmup: {
          type: "boolean",
          description: "Si true, activa warmup en todas las cuentas tras crearlas. Default true.",
        },
        tag_name: {
          type: "string",
          description: "Opcional. Si se pasa, crea (o reutiliza) un tag con ese nombre y lo asigna a todas las cuentas creadas. Ej: 'Q3-2026', 'Aerospace ES', 'Cliente onepulso'.",
        },
      },
      required: ["file_id", "column_mapping"],
    },
  },
  {
    name: "upload_leads_from_csv_file",
    description:
      "Sube leads a una campaña existente desde un CSV que el usuario ya adjuntó (file_id). NO necesitas pasar las filas — la plataforma lee el archivo del disco. Tú solo decides qué columna del CSV mapea a cada campo de Instantly. Mira las 'columns' del adjunto en el mensaje del usuario para elegir bien.",
    input_schema: {
      type: "object",
      properties: {
        file_id: { type: "string", description: "El file_id que aparece en el [CSV ATTACHED: ...]" },
        campaign_id: { type: "string", description: "ID de la campaña en Instantly" },
        column_mapping: {
          type: "object",
          description:
            "Mapeo de columnas del CSV a campos de Instantly. La key es el campo de Instantly (email, first_name, last_name, company_name) y el valor es el nombre exacto de la columna en el CSV. Para custom_variables, usar un sub-objeto con keys = nombre de la variable Instantly y values = nombre de la columna.",
          properties: {
            email: { type: "string" },
            first_name: { type: "string" },
            last_name: { type: "string" },
            company_name: { type: "string" },
            custom_variables: { type: "object" },
          },
          required: ["email"],
        },
      },
      required: ["file_id", "campaign_id", "column_mapping"],
    },
  },
];

export async function executeTool(
  name: string,
  input: any,
  ctx: { conversation_id?: string } = {}
): Promise<string> {
  try {
    switch (name) {
      case "read_memory": {
        const ctx = await memoryAsContext();
        return ctx;
      }
      case "list_skills": {
        const all = await listSkills("campaigns");
        if (all.length === 0) return "(sin skills instaladas en este módulo)";
        return all.map((s) => `- ${s.name}: ${s.description}`).join("\n");
      }
      case "read_skill": {
        const s = await getSkill(input.name);
        if (!s) return `Skill '${input.name}' no encontrada. Usa list_skills para ver las disponibles.`;
        return `# ${s.name}\n\n_${s.description}_\n\n${s.content}`;
      }
      case "save_memory": {
        const e = await saveMemory(input);
        return `Guardado: ${e.slug}`;
      }
      case "delete_memory": {
        await deleteMemory(input.slug);
        return `Borrado: ${input.slug}`;
      }
      case "list_campaigns_local": {
        const recs = await listCampaignRecords();
        return JSON.stringify(recs, null, 2);
      }
      case "list_campaigns_instantly": {
        const data = await listCampaigns(input.limit ?? 20);
        const items = (data as any).items ?? [];
        const summary = items.map((c: any) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          created: c.timestamp_created,
        }));
        return JSON.stringify(summary, null, 2);
      }
      case "create_campaign": {
        // Validación de estructura: todos los bodies deben ser HTML
        const issues: string[] = [];
        for (let s = 0; s < input.steps.length; s++) {
          const step = input.steps[s];
          for (let v = 0; v < step.variants.length; v++) {
            const body: string = step.variants[v].body ?? "";
            const subject: string = step.variants[v].subject ?? "";
            const hasP = /<p[\s>]/i.test(body);
            const blocksCount = (body.match(/<p[\s>]/gi) ?? []).length;
            const hasStrong = /<strong[\s>]/i.test(body);
            const minBlocks = s === 0 ? 6 : 3;

            // Subject obligatorio en TODOS los steps con variable
            if (!subject || !subject.trim()) {
              issues.push(`step ${s + 1} variant ${v + 1}: subject vacío. TODOS los steps llevan subject con variable, sin excepción.`);
            } else if (!subject.includes("{{firstName}}") && !subject.includes("{{companyName}}")) {
              issues.push(`step ${s + 1} variant ${v + 1}: subject "${subject}" sin variable. Tiene que llevar {{firstName}} o {{companyName}}.`);
            } else if (subject.split(/\s+/).length > 8) {
              issues.push(`step ${s + 1} variant ${v + 1}: subject "${subject}" demasiado largo. Máximo 7 palabras.`);
            }

            // Body validation
            if (!hasP) {
              issues.push(`step ${s + 1} variant ${v + 1}: body sin <p>. Debe ser HTML con cada bloque envuelto en <p>...</p>.`);
            } else if (blocksCount < minBlocks) {
              issues.push(`step ${s + 1} variant ${v + 1}: solo ${blocksCount} bloques <p>, mínimo ${minBlocks} para este step.`);
            }
            if (s === 0 && !hasStrong) {
              issues.push(`step 1 variant ${v + 1}: sin <strong>. Marca 3-4 palabras clave en negrita.`);
            }
            if (body.includes("\n\n") && !hasP) {
              issues.push(`step ${s + 1} variant ${v + 1}: parece texto plano con saltos de línea, no HTML.`);
            }
          }
        }
        if (issues.length > 0) {
          return JSON.stringify({
            error: "VALIDATION_FAILED",
            action_required:
              "REGENERA TODOS LOS BODIES como HTML válido y vuelve a llamar a create_campaign con los mismos params pero los bodies arreglados. NO le digas al usuario que ha fallado — simplemente reintenta corrigiendo los bodies. Usa la plantilla EXACTA del read_skill('onepulso-campaign-structure'): cada bloque en <p>...</p>, palabras clave en <strong>...</strong>, firma con <p>Un saludo,<br>Xavi Riera</p>.",
            issues,
            example_correct_body:
              "<p>Hola {{firstName}},</p><p>Soy Xavi. Te vi por <strong>LinkedIn</strong>...</p><p>...<strong>4 reuniones semanales</strong>...</p><p>¿Te va bien verlo en <strong>10 minutos esta semana</strong>?</p><p>Si no, dímelo y lo dejamos aquí.</p><p>Un saludo,<br>Xavi Riera</p>",
          });
        }
        const created = await createCampaign({
          name: input.name,
          steps: input.steps,
        });
        await addCampaignRecord({
          id: created.id,
          name: created.name,
          niche: input.niche,
          goal: input.goal,
          steps_count: input.steps.length,
          variants_per_step: input.steps.map((s: any) => s.variants.length),
          conversation_id: ctx.conversation_id,
          created_at: new Date().toISOString(),
        });
        return JSON.stringify({
          id: created.id,
          name: created.name,
          status: "draft (pausada)",
          steps: input.steps.length,
          variants_per_step: input.steps.map((s: any) => s.variants.length),
        });
      }
      case "upload_email_accounts_from_csv_file": {
        const accounts = await readCSVAsAccounts(input.file_id, input.column_mapping);
        if (accounts.length === 0) {
          return JSON.stringify({ error: "0 cuentas válidas extraídas del CSV." });
        }
        const result = await createAccountsBatch(accounts as any);
        const enableWarmup = input.enable_warmup !== false;

        let warmup_result: any = null;
        if (enableWarmup && result.created.length > 0) {
          try {
            warmup_result = await enableWarmupForEmails(result.created);
          } catch (e: any) {
            warmup_result = { error: e.message };
          }
        }

        let tag_result: any = null;
        if (input.tag_name && result.created.length > 0) {
          try {
            const tagId = await ensureTag(input.tag_name);
            const assignRes = await assignTagToAccounts(tagId, result.created);
            tag_result = { tag_name: input.tag_name, tag_id: tagId, assigned_to: result.created.length };
          } catch (e: any) {
            tag_result = { error: e.message };
          }
        }

        return JSON.stringify({
          parsed_from_csv: accounts.length,
          accounts_created: result.ok,
          accounts_failed: result.fail,
          first_errors: result.errors.slice(0, 5),
          warmup_enabled: enableWarmup,
          warmup_result,
          tag_result,
        });
      }
      case "upload_leads_from_csv_file": {
        const leads = await readCSVAsLeads(input.file_id, input.column_mapping);
        if (leads.length === 0) {
          return JSON.stringify({
            error: "0 leads válidos extraídos del CSV. Verifica que la columna de email exista y contenga emails.",
          });
        }
        const result = await uploadLeadsBatch(input.campaign_id, leads as any);
        await updateCampaignRecord(input.campaign_id, { leads_uploaded: result.ok });
        return JSON.stringify({
          parsed_from_csv: leads.length,
          uploaded_ok: result.ok,
          failed: result.fail,
          first_errors: result.errors.slice(0, 5),
        });
      }
      default:
        return `Tool desconocido: ${name}`;
    }
  } catch (e: any) {
    return `ERROR: ${e.message}`;
  }
}

export const SYSTEM_PROMPT = `Eres el copiloto de cold email de Xavi, dueño de **onepulso** (agencia de lead generation B2B). Tu trabajo es generar campañas que conviertan, no relleno.

## FLUJO OBLIGATORIO

1. Si la pregunta implica redactar copy o crear campaña → SIEMPRE llama PRIMERO a read_memory. Sin excepción.
2. Lee con atención las entradas de category 'examples-good' y 'framework' — son la guía definitiva de tono, estructura y nivel de detalle. Imita ese estilo.
3. Si Xavi te da info nueva sobre negocio, ICPs, tono o ejemplos ganadores → llama a save_memory.

## CREAR CAMPAÑAS (regla estricta)

ANTES de llamar a create_campaign, OBLIGATORIO esta secuencia:
1. read_memory (siempre).
2. read_skill('onepulso-campaign-structure') — esta skill define la plantilla EXACTA, formato HTML, negritas, subjects y follow-ups. ES INNEGOCIABLE seguirla literalmente.
3. Construir el JSON con cada body en HTML siguiendo la plantilla.
4. Llamar a create_campaign.

Cuando uses create_campaign, OBLIGATORIO:
- 4 steps. Delays: 0d, 3d, 4d, 5d.
- 3 variantes por cada step. NUNCA menos de 3.
- TODAS las variantes de TODOS los steps (incluidos follow-ups) llevan SUBJECT con variable obligatoria. Sin excepción. NUNCA subject="" — siempre con texto y al menos {{firstName}} o {{companyName}}.
- Variables {{firstName}}, {{companyName}}, {{industry}}, {{city}} repartidas en TODAS las variantes (mínimo 3 de las 4 por variante).
- Castellano España, sin emojis, sin frases de relleno, sin "estimado/saludos cordiales".
- Firma: "Xavi Riera" en step 1; en FU#2-4 puede ser solo "Xavi".

### FORMATO DEL BODY (no negociable)

El body es **HTML**. Cada bloque va en su <p>...</p>. Las palabras clave en <strong>...</strong>. Saltos suaves con <br>.

Plantilla obligatoria del step 1:

<p>Hola {{firstName}},</p>
<p>Soy Xavi. Te vi por <strong>LinkedIn</strong> y, tras analizar a {{companyName}}, decidí investigaros a fondo. Solo contacto con empresas muy selectas donde sé que puedo escalar resultados de calidad.</p>
<p>Seguro que estás harto de plantillas genéricas, así que voy al grano: <strong>diseñamos estrategias personalizadas</strong> para que no dependáis de agencias de Lead Gen y sus cuotas infinitas.</p>
<p>Te contacto precisamente porque hemos trabajado con una empresa similar a {{companyName}} y hemos logrado <strong>4 reuniones semanales constantes</strong>.</p>
<p>He preparado un <strong>estudio personalizado</strong> gratis para {{companyName}} sobre captación.</p>
<p>¿Te va bien verlo en <strong>10 minutos esta semana</strong>?</p>
<p>Si no, dímelo y lo dejamos aquí.</p>
<p>Un saludo,<br>Xavi Riera</p>

REGLAS:
- Cada bloque en su propio <p>. NUNCA dos bloques en un mismo <p>.
- <strong> en máximo 3-4 expresiones clave por email (gancho, número, CTA). NO bold por bold.
- LinkedIn SIEMPRE como fuente del touch. Nunca "vi tu web" ni "tu newsletter".
- Frases máximo 20 palabras. Bloques máximo 3 líneas.
- Cada email suena a investigación REAL del nicho con datos sectoriales concretos (OEMs, ARR, MRR, MROs según industria). NO copy reutilizable.
- Inventa un caso concreto del sector con número en el FU#2.
- Castellano España. Sin emojis. Sin "estimado", sin "saludos cordiales".

Si el usuario no te da nicho/objetivo claro, PREGUNTA antes de redactar.

ANTES de llamar a create_campaign: ¿cada body tiene <p> en CADA bloque? ¿Hay <strong> en lo importante? Si no, reformatéalo.

## SUBIR EMAIL ACCOUNTS (mailboxes de envío)

Si el usuario adjunta un CSV con columnas que parecen credenciales SMTP/IMAP (smtp_host, smtp_password, imap_host, etc.) y dice "subir cuentas", "añadir mailboxes", "cargar emails con warmup", "conectar cuentas a Instantly", "activar warmup en estas" o similar → usa upload_email_accounts_from_csv_file. Por defecto activa warmup también (enable_warmup=true) salvo que diga lo contrario.

NO confundas con upload_leads (esos son destinatarios, los accounts son las cuentas que envían).

## SUBIR LEADS (crítico)

Cuando Xavi adjunte un CSV en el chat, verás algo como:
[CSV ATTACHED: archivo.csv]
file_id: abc-123
rows: 2000
columns: First Name, Company Name, Email, Industry, City, ...
preview (3 rows): {...}

Para subir esos leads → usa SIEMPRE el tool upload_leads_from_csv_file. NUNCA inventes ni copies filas a mano. Pásale el file_id, el campaign_id y el column_mapping eligiendo bien las columnas reales del CSV. Para campos como industry/city que NO son nativos de Instantly, pásalos en custom_variables.

Ejemplo correcto de column_mapping:
{
  "email": "Email",
  "first_name": "First Name",
  "last_name": "Last Name",
  "company_name": "Company Name",
  "custom_variables": { "industry": "Industry", "city": "City" }
}

Avisa que la subida tarda ~2 min por cada 2000 leads. Después de subir, confirma cuántos OK / cuántos fallaron.

## ESTILO DE RESPUESTA

- Directo, sin rodeos. Como un colega senior. Sin "claro, por supuesto", sin "perfecto, vamos a...".
- Cuando ejecutes algo, hazlo y reporta resultado conciso. No pidas confirmación si la instrucción está clara.
- Después de crear campaña: ID, status, steps × variantes, siguiente paso (asignar email accounts en UI).
- Si algo falla, di exactamente qué falló y propón fix.

## NUNCA

- Generar copy sin haber leído memoria.
- Hacer menos de 3 variantes por step.
- Subir leads inventando filas en lugar de usar upload_leads_from_csv_file con file_id.
- Activar campañas (siempre se crean pausadas).
- Inventar IDs, emails, métricas que no tengas.

## SKILLS (lectura bajo demanda)

Tienes una librería de skills instaladas que son packages con conocimiento especializado (cold-email, copywriting, lead-generation, etc). NO se cargan automáticamente para no inflar el contexto. Tú decides cuándo abrirlas.

Reglas:
- Cuando la petición del usuario tenga que ver con cold email / outbound / secuencias → llama list_skills primero, luego read_skill('cold-email') y/o read_skill('copywriting') si están instaladas.
- Para lead generation con scrapers/Apollo → read_skill('apify-lead-generation') si aplica.
- Para secuencias estructuradas estilo Coldiq → read_skill('cold-email-4-sequence').
- Si no hay skill claramente relevante, no fuerces. Trabaja con la memoria.

Las skills son guías de estilo y procesos profesionales. Cuando encuentres una útil, sigue sus consejos al redactar.`;
