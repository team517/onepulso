"use client";
import { useState } from "react";

/**
 * Página de mantenimiento de DB con botones — para limpiar el disco sin
 * usar la consola del navegador. Llama a /api/admin/db-maintenance.
 * Requiere estar logueado como admin (la cookie va automática en el fetch).
 */
export default function AdminDbPage() {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function add(line: string) {
    setLog((l) => [...l, `${new Date().toLocaleTimeString("es")} · ${line}`]);
  }

  async function run(action: string, label: string) {
    setBusy(true);
    add(`▶ ${label}…`);
    try {
      const method = action === "diag" ? "GET" : "POST";
      const url = action === "diag"
        ? "/api/admin/db-maintenance"
        : `/api/admin/db-maintenance?action=${action}`;
      const r = await fetch(url, { method });
      const d = await r.json();
      if (!r.ok) {
        add(`❌ Error: ${d.error || r.status}`);
      } else {
        add(`✅ ${label} OK:`);
        add(JSON.stringify(d, null, 2));
      }
    } catch (e: any) {
      add(`❌ ${e.message}`);
    }
    setBusy(false);
  }

  return (
    <div style={{ maxWidth: 760, margin: "40px auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>🛠 Mantenimiento de base de datos</h1>
      <p style={{ color: "#64748b", fontSize: 14, marginBottom: 24 }}>
        Limpia el disco de Postgres. Ejecuta en orden: <b>1) Diagnóstico</b> → <b>2) Limpiar basura</b> → <b>3) VACUUM</b>.
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
        <button onClick={() => run("diag", "Diagnóstico")} disabled={busy} style={btn("#0071e3")}>
          1 · Ver tamaño DB
        </button>
        <button onClick={() => run("purge-big", "Limpiar basura")} disabled={busy} style={btn("#f59e0b")}>
          2 · Limpiar basura
        </button>
        <button onClick={() => run("vacuum", "VACUUM FULL (tarda 5-15 min)")} disabled={busy} style={btn("#10b981")}>
          3 · VACUUM (recupera GB)
        </button>
        <button onClick={() => run("checkpoint", "Checkpoint + limpiar WAL")} disabled={busy} style={btn("#6366f1")}>
          4 · Limpiar WAL (vaciar volumen)
        </button>
      </div>

      {busy && (
        <div style={{ padding: 12, background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          ⏳ Trabajando… El VACUUM puede tardar 5-15 min. NO cierres esta página.
        </div>
      )}

      <pre style={{
        background: "#0f172a", color: "#e2e8f0", padding: 16, borderRadius: 10,
        fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word",
        minHeight: 200, maxHeight: 500, overflow: "auto",
      }}>
        {log.length === 0 ? "Los resultados aparecerán aquí…" : log.join("\n")}
      </pre>
    </div>
  );
}

function btn(color: string): React.CSSProperties {
  return {
    padding: "12px 18px", background: color, color: "#fff", border: 0,
    borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer",
    fontFamily: "inherit",
  };
}
