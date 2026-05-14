import { listTasks, markReminderSent, Task } from "./tasks";
import { sendEmail } from "./email-send";

const REMINDER_EMAIL = "xaviriera03@gmail.com";

/** Tarea cuyo due_at está dentro de la próxima hora (60 min) y aún no se notificó. */
function shouldNotify(t: Task, now: number): boolean {
  if (t.status !== "pending") return false;
  if (!t.due_at) return false;
  if (t.reminder_sent_at) return false;
  const dueMs = new Date(t.due_at).getTime();
  if (isNaN(dueMs)) return false;
  const diff = dueMs - now;
  // Avisar si quedan entre 0 y 60 min, o si ya está vencida menos de 30 min (por si el scheduler durmió)
  return diff > -30 * 60_000 && diff < 60 * 60_000;
}

function fmtDueRelative(due: string, now: number): string {
  const dueMs = new Date(due).getTime();
  const diff = dueMs - now;
  if (diff < 0) {
    const mins = Math.round(-diff / 60_000);
    return `Vencida hace ${mins} min`;
  }
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `En ${mins} min`;
  const h = Math.floor(mins / 60);
  const rest = mins % 60;
  return `En ${h}h${rest > 0 ? ` ${rest}min` : ""}`;
}

/** Revisa todas las tareas pending y envía email a xaviriera03 si falta poco. */
export async function processTaskReminders(): Promise<{ checked: number; sent: number; errors: number }> {
  const tasks = await listTasks();
  const now = Date.now();
  let sent = 0;
  let errors = 0;

  for (const t of tasks) {
    if (!shouldNotify(t, now)) continue;
    try {
      const dueDate = new Date(t.due_at!);
      const dueLocal = dueDate.toLocaleString("es-ES", {
        weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
      });
      const relative = fmtDueRelative(t.due_at!, now);
      const isOverdue = dueDate.getTime() < now;
      const accent = isOverdue ? "#ef4444" : "#f59e0b";
      const clientLine = t.client_name
        ? `<p style="margin:6px 0;color:#475569;font-size:14px;"><strong>Cliente:</strong> ${escapeHtml(t.client_name)}${t.client_email ? ` <span style="color:#94a3b8;">&lt;${escapeHtml(t.client_email)}&gt;</span>` : ""}</p>`
        : "";
      const descLine = t.description
        ? `<div style="margin-top:12px;padding:12px 14px;background:#f8fafc;border-left:3px solid #cbd5e1;border-radius:6px;font-size:13.5px;color:#334155;line-height:1.55;">${escapeHtml(t.description).replace(/\n/g, "<br>")}</div>`
        : "";

      const subject = isOverdue
        ? `⚠️ Tarea VENCIDA: ${t.title}`
        : `⏰ Recordatorio: ${t.title} — ${relative}`;

      const body = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;color:#0f172a;">
  <div style="background:linear-gradient(135deg,${accent},${shade(accent)});color:#fff;padding:18px 22px;border-radius:14px 14px 0 0;">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;opacity:0.85;">
      ${isOverdue ? "Tarea vencida" : "Recordatorio de tarea"}
    </div>
    <div style="font-size:20px;font-weight:700;margin-top:4px;letter-spacing:-0.01em;">
      ${escapeHtml(t.title)}
    </div>
  </div>
  <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 14px 14px;padding:18px 22px;">
    <p style="margin:0 0 8px 0;font-size:14px;color:#475569;">
      <strong style="color:#0f172a;">Vencimiento:</strong> ${dueLocal}
    </p>
    <p style="margin:0;font-size:13.5px;color:${accent};font-weight:700;">
      ${relative}
    </p>
    ${clientLine}
    ${descLine}
    <div style="margin-top:18px;padding-top:14px;border-top:1px solid #f1f5f9;">
      <a href="https://onepulso.up.railway.app/tareas" style="display:inline-block;background:#0071e3;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:700;">
        Ver en onepulso →
      </a>
    </div>
  </div>
  <p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:12px;">
    Recordatorio automático · onepulso · ${new Date().toLocaleString("es-ES")}
  </p>
</div>`.trim();

      await sendEmail({
        to: REMINDER_EMAIL,
        subject,
        body_html: body,
      });
      await markReminderSent(t.id);
      console.log(`[tasks-reminder] ✓ enviado para "${t.title}" → ${REMINDER_EMAIL}`);
      sent++;
    } catch (e: any) {
      console.error(`[tasks-reminder] ✗ falló para "${t.title}": ${e.message}`);
      errors++;
    }
  }

  return { checked: tasks.length, sent, errors };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shade(hex: string): string {
  // Oscurecer ~20%
  const c = hex.replace("#", "");
  const r = Math.max(0, parseInt(c.slice(0, 2), 16) - 50);
  const g = Math.max(0, parseInt(c.slice(2, 4), 16) - 50);
  const b = Math.max(0, parseInt(c.slice(4, 6), 16) - 50);
  return `rgb(${r},${g},${b})`;
}
