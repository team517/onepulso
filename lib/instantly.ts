import { envVar } from "./env";

const BASE = "https://api.instantly.ai/api/v2";

function authHeaders() {
  const key = envVar("INSTANTLY_API_KEY");
  if (!key) throw new Error("INSTANTLY_API_KEY missing in .env.local");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "User-Agent": "curl/8.4.0",
    Accept: "*/*",
  };
}

export async function listCampaigns(limit = 50) {
  const r = await fetch(`${BASE}/campaigns?limit=${limit}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`Instantly listCampaigns ${r.status}`);
  return r.json();
}

export async function getCampaign(id: string) {
  const r = await fetch(`${BASE}/campaigns/${id}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`Instantly getCampaign ${r.status}`);
  return r.json();
}

type Variant = { subject: string; body: string };
type Step = { delay: number; variants: Variant[] };

export async function createCampaign(
  opts: {
    name: string;
    steps: Step[];
    timezone?: string;
    daily_limit?: number;
  },
  attempt = 0
): Promise<any> {
  const body = {
    name: opts.name,
    campaign_schedule: {
      schedules: [
        {
          name: "Lun-Vie horario Madrid",
          timing: { from: "09:00", to: "18:00" },
          days: { "0": false, "1": true, "2": true, "3": true, "4": true, "5": true, "6": false },
          timezone: opts.timezone ?? "Europe/Belgrade",
        },
      ],
    },
    daily_limit: opts.daily_limit ?? 30,
    stop_on_reply: true,
    open_tracking: false,
    link_tracking: false,
    text_only: false,
    sequences: [
      {
        steps: opts.steps.map((s) => ({
          type: "email",
          delay: s.delay,
          variants: s.variants,
        })),
      },
    ],
  };
  const r = await fetch(`${BASE}/campaigns`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (r.ok) return r.json();
  // Retry on 429/5xx
  if ((r.status === 429 || r.status >= 500) && attempt < 3) {
    await new Promise((res) => setTimeout(res, Math.min(2 ** attempt * 1000, 8000)));
    return createCampaign(opts, attempt + 1);
  }
  const txt = await r.text().catch(() => "");
  throw new Error(`Instantly createCampaign ${r.status}: ${txt.slice(0, 400)}`);
}

export async function uploadLead(campaignId: string, lead: {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  custom_variables?: Record<string, string>;
}, attempt = 0): Promise<any> {
  const r = await fetch(`${BASE}/leads`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ campaign: campaignId, ...lead }),
  });
  if (r.ok) return r.json();
  // Retry with backoff for 429/5xx
  if ((r.status === 429 || r.status >= 500) && attempt < 4) {
    await new Promise((res) => setTimeout(res, Math.min(2 ** attempt * 500, 8000)));
    return uploadLead(campaignId, lead, attempt + 1);
  }
  const t = await r.text().catch(() => "");
  throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
}

// ===== Email Accounts (sending mailboxes) =====

export type EmailAccountInput = {
  email: string;
  first_name?: string;
  last_name?: string;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_password: string;
  daily_limit?: number;
  warmup_limit?: number;
  reply_to?: string;
};

export async function createEmailAccount(input: EmailAccountInput, attempt = 0): Promise<any> {
  // Detectar provider automáticamente:
  // 1 = Custom IMAP/SMTP, 2 = Google, 3 = Microsoft, 4 = AWS, 8 = AirMail
  const smtpHostLower = (input.smtp_host ?? "").toLowerCase();
  let provider_code = 1; // default custom IMAP/SMTP
  if (smtpHostLower.includes("gmail") || smtpHostLower.includes("google")) provider_code = 2;
  else if (smtpHostLower.includes("outlook") || smtpHostLower.includes("office365") || smtpHostLower.includes("microsoft")) provider_code = 3;
  else if (smtpHostLower.includes("amazonaws") || smtpHostLower.includes("ses")) provider_code = 4;

  const body: any = {
    email: input.email,
    first_name: input.first_name || input.email.split("@")[0],
    last_name: input.last_name || ".",
    provider_code,
    smtp_host: input.smtp_host,
    smtp_port: Number(input.smtp_port),
    smtp_username: input.smtp_username || input.email,
    smtp_password: input.smtp_password,
    imap_host: input.imap_host,
    imap_port: Number(input.imap_port),
    imap_username: input.imap_username || input.email,
    imap_password: input.imap_password,
    daily_limit: input.daily_limit ?? 30,
    warmup: {
      limit: input.warmup_limit ?? 30,
      advanced: { warm_ctd: false, weekday_only: false },
    },
  };
  if (input.reply_to) body.reply_to = input.reply_to;

  const r = await fetch(`${BASE}/accounts`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (r.ok) return r.json();
  if ((r.status === 429 || r.status >= 500) && attempt < 3) {
    await new Promise((res) => setTimeout(res, Math.min(2 ** attempt * 800, 6000)));
    return createEmailAccount(input, attempt + 1);
  }
  const txt = await r.text().catch(() => "");
  throw new Error(`HTTP ${r.status}: ${txt.slice(0, 240)}`);
}

// ===== Custom Tags =====

export async function listCustomTags(): Promise<any> {
  const r = await fetch(`${BASE}/custom-tags`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`listCustomTags ${r.status}`);
  return r.json();
}

export async function createCustomTag(label: string, description?: string): Promise<any> {
  const r = await fetch(`${BASE}/custom-tags`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ label, description: description ?? null }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`createCustomTag ${r.status}: ${t.slice(0, 240)}`);
  }
  return r.json();
}

/**
 * Resuelve un tag por nombre. Si existe, devuelve su id; si no, lo crea.
 */
export async function ensureTag(label: string): Promise<string> {
  const existing: any = await listCustomTags();
  const items = existing.items ?? existing.data ?? existing;
  const list = Array.isArray(items) ? items : items?.items ?? [];
  const found = list.find((t: any) => (t.label ?? t.name)?.toLowerCase() === label.toLowerCase());
  if (found) return found.id;
  const created = await createCustomTag(label);
  return created.id;
}

export async function assignTagToAccounts(tagId: string, emails: string[]): Promise<any> {
  if (emails.length === 0) return { ok: true, count: 0 };
  const r = await fetch(`${BASE}/custom-tags/toggle-resource`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      tag_ids: [tagId],
      resource_type: 1, // 1 = Account
      resource_ids: emails,
      assign: true,
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`assignTag ${r.status}: ${t.slice(0, 240)}`);
  }
  return r.json();
}

export async function enableWarmupForEmails(emails: string[]): Promise<any> {
  if (emails.length === 0) return { ok: true, count: 0 };
  const r = await fetch(`${BASE}/accounts/warmup/enable`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ emails }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`enableWarmup HTTP ${r.status}: ${t.slice(0, 240)}`);
  }
  return r.json();
}

export async function createAccountsBatch(
  accounts: EmailAccountInput[],
  concurrency = 3
): Promise<{ ok: number; fail: number; errors: Array<{ email: string; error: string }>; created: string[] }> {
  let ok = 0;
  let fail = 0;
  const created: string[] = [];
  const errors: Array<{ email: string; error: string }> = [];
  const queue = [...accounts];
  async function worker() {
    while (queue.length) {
      const a = queue.shift();
      if (!a) return;
      try {
        await createEmailAccount(a);
        created.push(a.email);
        ok++;
      } catch (e: any) {
        fail++;
        if (errors.length < 10) errors.push({ email: a.email, error: e.message });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { ok, fail, errors, created };
}

export async function uploadLeadsBatch(
  campaignId: string,
  leads: Array<Parameters<typeof uploadLead>[1]>,
  concurrency = 6,
  onProgress?: (done: number, total: number, ok: number, fail: number) => void
) {
  let ok = 0;
  let fail = 0;
  let done = 0;
  const errors: Array<{ email: string; error: string }> = [];
  const queue = [...leads];
  const total = queue.length;
  async function worker() {
    while (queue.length) {
      const lead = queue.shift();
      if (!lead) return;
      try {
        await uploadLead(campaignId, lead);
        ok++;
      } catch (e: any) {
        fail++;
        if (errors.length < 10) {
          errors.push({ email: lead.email, error: e.message ?? String(e) });
        }
      }
      done++;
      onProgress?.(done, total, ok, fail);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { ok, fail, total, errors };
}
