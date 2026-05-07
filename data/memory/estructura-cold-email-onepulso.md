---
title: Estructura cold email Xavi (onepulso) — HTML, plantilla y subjects
category: framework
---

# FORMATO: HTML CON ESTRUCTURA Y NEGRITAS

Los emails se escriben en **HTML**. Cada bloque va en su propio `<p>...</p>`. Las palabras clave importantes (1-3 por email) van en `<strong>...</strong>`. Para forzar un salto suave dentro del mismo párrafo (como en la firma), `<br>`.

## Plantilla obligatoria del primer email (step 1)

```html
<p>Hola {{firstName}},</p>

<p>Soy Xavi. Te vi por <strong>LinkedIn</strong> y, tras analizar a {{companyName}}, decidí investigaros a fondo. Solo contacto con empresas muy selectas donde sé que puedo escalar resultados de calidad.</p>

<p>Seguro que estás harto de plantillas genéricas, así que voy al grano: <strong>diseñamos estrategias personalizadas</strong> para que no dependáis de agencias de Lead Gen y sus cuotas infinitas. Os montamos vuestro propio canal para captar decisores dispuestos a comprar sin depender de terceros.</p>

<p>Te contacto precisamente porque hemos trabajado con una empresa muy similar a {{companyName}} y hemos logrado <strong>una media de 4 reuniones semanales constantes</strong>. Sé exactamente cómo conseguirlo también para vosotros.</p>

<p>He preparado un <strong>estudio personalizado</strong> y una IA gratis para {{companyName}} para que os ayude con la captación.</p>

<p>¿Te va bien verlo en <strong>10 minutos esta semana</strong>?</p>

<p>Si no, dímelo y lo dejamos aquí.</p>

<p>Un saludo,<br>Xavi Riera</p>
```

## Reglas de la estructura (orden fijo, 8 bloques)

1. **Saludo personal** en `<p>`: `<p>Hola {{firstName}},</p>`
2. **Apertura — touch + selectividad** en `<p>`:
   - **SIEMPRE LinkedIn** como fuente. Nunca "vi tu web", "tu newsletter", "leí un artículo", etc.
   - Frase tipo: *"Te vi por LinkedIn y, tras analizar a {{companyName}}, decidí investigaros a fondo."*
   - Cierra con la línea de selectividad ("solo contacto con empresas muy selectas...").
3. **Propuesta directa** en `<p>`:
   - "voy al grano" o equivalente.
   - Lo que hacemos: estrategia propia + canal propio + sin cuotas/dependencias.
   - Negrita en el concepto core (`<strong>diseñamos estrategias personalizadas</strong>`).
4. **Prueba social específica** en `<p>`:
   - Empresa similar a {{companyName}} + número concreto.
   - Negrita en el número-resultado (`<strong>4 reuniones semanales constantes</strong>`).
5. **Gancho personalizado** en `<p>`:
   - Algo CONCRETO ya preparado: estudio, audit, IA personalizada, lista de cuentas.
   - Negrita en lo que se ofrece (`<strong>estudio personalizado</strong>`).
6. **CTA** en `<p>`:
   - "¿Te va bien verlo en 10 minutos esta semana?"
   - Negrita en el tiempo (`<strong>10 minutos esta semana</strong>`).
7. **Salida sin presión** en `<p>`:
   - "Si no, dímelo y lo dejamos aquí."
8. **Despedida** en `<p>` con `<br>`:
   - `<p>Un saludo,<br>Xavi Riera</p>` (en step 1 nombre completo; en FU solo "Xavi").

## Reglas de las negritas

- **Máximo 3-4 `<strong>` por email**. Si pones 10, pierde fuerza.
- Ponlas SOLO en:
  - El concepto principal de la propuesta
  - El número/resultado de la prueba social
  - Lo que ofreces como gancho
  - El tiempo del CTA ("10 minutos", "esta semana")
- NUNCA en palabras decorativas ("hola", "saludos", "gracias", "Xavi").
- NUNCA bold sobre frases enteras de 10+ palabras.

## Formato general (no negociable)

- Cada bloque en su propio `<p>`. **NUNCA** dos bloques en un mismo `<p>`.
- Frases máximo 20 palabras. Si pasa, partirla en dos.
- Bloques máximo 3 líneas seguidas.
- Sin emojis, sin "✅".
- Idioma: castellano España. Sin "estimado", sin "saludos cordiales", sin "atte.".

## Variables a usar

- `{{firstName}}` → saludo y posiblemente CTA si encaja natural.
- `{{companyName}}` → investigación, gancho personalizado, prueba social.
- `{{industry}}`, `{{city}}` → solo si añaden credibilidad real, no relleno.

---

# SUBJECTS — REGLAS

El subject decide si se abre. Aplican estas reglas SIEMPRE:

1. **Variable obligatoria** ({{companyName}} o {{firstName}}).
2. **Cortos**: 4-7 palabras máximo.
3. **Minúscula inicial**: "idea para X" (NO "Idea para X").
4. **Sin emojis. Sin signos de exclamación.**
5. **Sonar a mensaje personal**, no a marketing.
6. **Despertar curiosidad**: el lector no debería saber qué hay dentro hasta abrir.

## Patrones que funcionan (rotar entre variantes A/B/C)

- `idea para {{companyName}}`
- `una idea para {{companyName}}`
- `te dejaste esto en {{companyName}}`
- `pregunta sobre {{companyName}}`
- `{{firstName}}, una propuesta`
- `{{firstName}}, idea rápida`
- `{{firstName}}, tema {{companyName}}`
- `{{companyName}} + pipeline`
- `por curiosidad, {{firstName}}`
- `{{companyName}} → 10 min`
- `vi a {{companyName}} y…`

## Patrones a EVITAR

- Subjects largos descriptivos.
- Mayúsculas tipo corporate.
- Spammy: "ÚLTIMA OPORTUNIDAD", "OFERTA", "GRATIS".
- Genéricos sin variable.

---

# FOLLOW-UPS (steps 2-4)

- Subject `""` (vacío) para mantener thread.
- Mismo formato HTML con `<p>` por bloque y `<strong>` en lo clave.
- Cada FU aporta algo nuevo:
  - **FU#1 (delay 3d)**: subir el thread + recordar el gancho personalizado.
  - **FU#2 (delay 4d)**: caso real concreto del nicho con número + pregunta de cualificación.
  - **FU#3 (delay 5d)**: breakup invitando ("cuando lo retoméis, escríbeme").
- Firma: en step 1 "Xavi Riera"; en FU#2-FU#4 puede ser solo "Xavi".
