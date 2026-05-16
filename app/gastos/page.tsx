"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardNav from "../components/DashboardNav";

type Expense = {
  id: string;
  name: string;
  amount: number;
  frequency: "monthly" | "yearly" | "quarterly" | "weekly" | "one-time";
  category?: string;
  vendor?: string;
  next_charge_date?: string;
  notes?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

const FREQUENCIES: Array<{ key: Expense["frequency"]; label: string; short: string }> = [
  { key: "monthly",   label: "Mensual",      short: "/mes" },
  { key: "yearly",    label: "Anual",        short: "/año" },
  { key: "quarterly", label: "Trimestral",   short: "/trim" },
  { key: "weekly",    label: "Semanal",      short: "/sem" },
  { key: "one-time",  label: "Pago único",   short: "única" },
];

export default function GastosPage() {
  const [items, setItems] = useState<Expense[]>([]);
  const [totals, setTotals] = useState<{ monthly: number; yearly: number; by_category: Record<string, number> }>({ monthly: 0, yearly: 0, by_category: {} });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [hideInactive, setHideInactive] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);

  // Form
  const [fName, setFName] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fFreq, setFFreq] = useState<Expense["frequency"]>("monthly");
  const [fCategory, setFCategory] = useState("");
  const [fVendor, setFVendor] = useState("");
  const [fNextCharge, setFNextCharge] = useState("");
  const [fNotes, setFNotes] = useState("");
  const [fActive, setFActive] = useState(true);
  const [fSaving, setFSaving] = useState(false);
  const [fError, setFError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const j = await fetch("/api/expenses").then((r) => r.json());
      setItems(j.expenses || []);
      setTotals(j.totals || { monthly: 0, yearly: 0, by_category: {} });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditing(null);
    setFName("");
    setFAmount("");
    setFFreq("monthly");
    setFCategory("");
    setFVendor("");
    setFNextCharge("");
    setFNotes("");
    setFActive(true);
    setFError(null);
    setModalOpen(true);
  }

  function openEdit(e: Expense) {
    setEditing(e);
    setFName(e.name);
    setFAmount(String(e.amount));
    setFFreq(e.frequency);
    setFCategory(e.category || "");
    setFVendor(e.vendor || "");
    setFNextCharge(e.next_charge_date ? e.next_charge_date.slice(0, 10) : "");
    setFNotes(e.notes || "");
    setFActive(e.active);
    setFError(null);
    setModalOpen(true);
  }

  async function save() {
    setFError(null);
    if (!fName.trim()) { setFError("El nombre es obligatorio"); return; }
    const amount = parseFloat(fAmount.replace(",", "."));
    if (isNaN(amount) || amount < 0) { setFError("El importe debe ser un número válido (>= 0)"); return; }

    setFSaving(true);
    try {
      const payload = {
        name: fName.trim(),
        amount,
        frequency: fFreq,
        category: fCategory.trim() || undefined,
        vendor: fVendor.trim() || undefined,
        next_charge_date: fNextCharge ? new Date(fNextCharge).toISOString() : undefined,
        notes: fNotes.trim() || undefined,
        active: fActive,
      };
      let res: Response;
      if (editing) {
        res = await fetch(`/api/expenses/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/api/expenses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setFError(j.error || `Error: ${res.status}`);
        return;
      }
      setModalOpen(false);
      await load();
    } catch (e: any) {
      setFError(e.message);
    } finally {
      setFSaving(false);
    }
  }

  async function toggleActive(e: Expense) {
    await fetch(`/api/expenses/${e.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !e.active }),
    });
    load();
  }

  async function remove(e: Expense) {
    if (!confirm(`¿Eliminar "${e.name}"?`)) return;
    await fetch(`/api/expenses/${e.id}`, { method: "DELETE" });
    load();
  }

  const filtered = useMemo(() => {
    let list = items.slice();
    if (hideInactive) list = list.filter((e) => e.active);
    if (filter.trim()) {
      const q = filter.toLowerCase();
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.category?.toLowerCase().includes(q) ||
          e.vendor?.toLowerCase().includes(q) ||
          e.notes?.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => monthlyEq(b) - monthlyEq(a));
    return list;
  }, [items, filter, hideInactive]);

  return (
    <div className="dash-shell">
      <DashboardNav />
      <div className="dash-content" style={{ padding: "28px 32px", overflow: "auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
              💸 Gastos
            </h1>
            <p style={{ color: "var(--text-dim)", marginTop: 4, fontSize: 13.5 }}>
              Apunta tus gastos fijos. Te calculo el total mensual y anual al vuelo.
            </p>
          </div>
          <button onClick={openCreate} style={btnPrimary}>+ Nuevo gasto</button>
        </header>

        {/* Totales */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12, marginBottom: 22, maxWidth: 960 }}>
          <TotalCard label="Total mensual" amount={totals.monthly} color="#0071e3" emphasized />
          <TotalCard label="Total anual" amount={totals.yearly} color="#7c3aed" />
          <TotalCard label="Gastos activos" amount={items.filter((e) => e.active).length} color="#22c55e" isCount />
          <TotalCard label="Inactivos" amount={items.filter((e) => !e.active).length} color="#94a3b8" isCount />
        </div>

        {/* Categorías */}
        {Object.keys(totals.by_category).length > 0 && (
          <div style={{ marginBottom: 22, maxWidth: 960 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
              Por categoría (mensual)
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {Object.entries(totals.by_category)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, amount]) => (
                  <div
                    key={cat}
                    style={{
                      padding: "5px 11px", borderRadius: 99,
                      background: "rgba(0,113,227,0.08)",
                      color: "var(--accent)",
                      fontSize: 12, fontWeight: 700,
                      display: "inline-flex", alignItems: "center", gap: 6,
                    }}
                  >
                    {cat} <span style={{ opacity: 0.7, fontWeight: 600 }}>{fmtEUR(amount)}/mes</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Buscador + filtros */}
        <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="🔎 Buscar nombre, categoría, proveedor…"
            style={{
              flex: 1, minWidth: 200, maxWidth: 380,
              padding: "8px 12px",
              border: "1px solid var(--border)",
              borderRadius: 9, fontSize: 13, outline: "none",
              fontFamily: "inherit",
            }}
          />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text-dim)", cursor: "pointer" }}>
            <input type="checkbox" checked={hideInactive} onChange={(e) => setHideInactive(e.target.checked)} />
            Ocultar inactivos
          </label>
        </div>

        {/* Lista */}
        {loading ? (
          <div className="loading-pulse"><span/><span/><span/></div>
        ) : filtered.length === 0 ? (
          <div style={empty}>
            <div style={{ fontSize: 38, marginBottom: 8 }}>💸</div>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
              {items.length === 0 ? "No tienes gastos todavía" : "Sin resultados"}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 14 }}>
              {items.length === 0 ? "Añade el primero con el botón de arriba." : "Cambia el filtro o quita 'Ocultar inactivos'."}
            </div>
            {items.length === 0 && (
              <button onClick={openCreate} style={btnPrimary}>+ Nuevo gasto</button>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 960 }}>
            {filtered.map((e) => (
              <ExpenseRow
                key={e.id}
                expense={e}
                onClick={() => openEdit(e)}
                onToggleActive={() => toggleActive(e)}
                onDelete={() => remove(e)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modal nuevo / editar */}
      {modalOpen && (
        <div onClick={() => !fSaving && setModalOpen(false)} style={modalBackdrop}>
          <div onClick={(ev) => ev.stopPropagation()} style={modalBox}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>
                {editing ? "Editar gasto" : "Nuevo gasto"}
              </h3>
              <button onClick={() => setModalOpen(false)} disabled={fSaving} style={{ background: "transparent", border: "none", fontSize: 22, cursor: "pointer", color: "var(--text-faint)" }}>×</button>
            </div>

            <label style={label}>Nombre *</label>
            <input
              value={fName}
              onChange={(ev) => setFName(ev.target.value)}
              placeholder="Ej: Railway, Adobe, Café oficina"
              style={input}
              autoFocus
            />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={label}>Importe (€) *</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={fAmount}
                  onChange={(ev) => setFAmount(ev.target.value)}
                  placeholder="20.00"
                  style={input}
                />
              </div>
              <div>
                <label style={label}>Frecuencia</label>
                <select
                  value={fFreq}
                  onChange={(ev) => setFFreq(ev.target.value as any)}
                  style={input}
                >
                  {FREQUENCIES.map((f) => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <label style={label}>Categoría <span style={labelOpt}>opcional</span></label>
            <input
              value={fCategory}
              onChange={(ev) => setFCategory(ev.target.value)}
              placeholder="Ej: Software, Oficina, Marketing"
              list="cat-suggest"
              style={input}
            />
            <datalist id="cat-suggest">
              <option value="Software" />
              <option value="Hosting" />
              <option value="Oficina" />
              <option value="Marketing" />
              <option value="Personal" />
              <option value="Impuestos" />
              <option value="Suscripciones" />
            </datalist>

            <label style={label}>Proveedor <span style={labelOpt}>opcional</span></label>
            <input
              value={fVendor}
              onChange={(ev) => setFVendor(ev.target.value)}
              placeholder="Ej: Stripe, Resend, Hostinger"
              style={input}
            />

            <label style={label}>Próximo cobro <span style={labelOpt}>opcional</span></label>
            <input
              type="date"
              value={fNextCharge}
              onChange={(ev) => setFNextCharge(ev.target.value)}
              style={input}
            />

            <label style={label}>Notas <span style={labelOpt}>opcional</span></label>
            <textarea
              value={fNotes}
              onChange={(ev) => setFNotes(ev.target.value)}
              placeholder="Ej: Renovar antes del 15, plan Pro"
              rows={2}
              style={{ ...input, resize: "vertical", fontFamily: "inherit" }}
            />

            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13, color: "var(--text)", cursor: "pointer" }}>
              <input type="checkbox" checked={fActive} onChange={(ev) => setFActive(ev.target.checked)} />
              Activo <span style={{ color: "var(--text-faint)", fontSize: 12 }}>· se cuenta en los totales</span>
            </label>

            {fError && (
              <div style={{
                marginTop: 12, padding: "10px 12px",
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.25)",
                borderRadius: 9, color: "#b91c1c", fontSize: 12.5,
              }}>
                ⚠ {fError}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
              <button onClick={save} disabled={fSaving || !fName.trim()} style={{ ...btnPrimary, flex: 1 }}>
                {fSaving ? "Guardando…" : editing ? "💾 Guardar cambios" : "+ Crear gasto"}
              </button>
              <button onClick={() => setModalOpen(false)} disabled={fSaving} style={btnGhost}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TotalCard({ label, amount, color, isCount, emphasized }: { label: string; amount: number; color: string; isCount?: boolean; emphasized?: boolean }) {
  return (
    <div style={{
      background: emphasized ? `linear-gradient(135deg, ${color}, ${color}cc)` : "#fff",
      border: `1px solid ${emphasized ? "transparent" : "var(--border)"}`,
      borderRadius: 12,
      padding: "14px 16px",
      boxShadow: emphasized ? `0 2px 10px ${color}33` : "0 1px 3px rgba(15,23,42,0.04)",
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: emphasized ? "rgba(255,255,255,0.85)" : "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: emphasized ? "#fff" : color, letterSpacing: "-0.02em" }}>
        {isCount ? amount : fmtEUR(amount)}
      </div>
    </div>
  );
}

function ExpenseRow({ expense, onClick, onToggleActive, onDelete }: { expense: Expense; onClick: () => void; onToggleActive: () => void; onDelete: () => void }) {
  const freq = FREQUENCIES.find((f) => f.key === expense.frequency);
  const isInactive = !expense.active;
  return (
    <div style={{
      background: "#fff",
      border: "1px solid var(--border)",
      borderLeft: `4px solid ${isInactive ? "#cbd5e1" : "#0071e3"}`,
      borderRadius: 11,
      padding: "12px 14px",
      display: "flex",
      alignItems: "center",
      gap: 12,
      opacity: isInactive ? 0.55 : 1,
      transition: "all 0.15s",
    }}>
      <div onClick={onClick} style={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.01em" }}>
            {expense.name}
          </span>
          {expense.category && (
            <span style={{
              fontSize: 10.5, padding: "1px 7px", borderRadius: 99,
              background: "rgba(99,102,241,0.1)", color: "#4f46e5",
              fontWeight: 700,
            }}>{expense.category}</span>
          )}
          {expense.vendor && (
            <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
              · {expense.vendor}
            </span>
          )}
          {isInactive && (
            <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 99, background: "var(--bg-elev-2)", color: "var(--text-faint)", fontWeight: 700 }}>
              INACTIVO
            </span>
          )}
        </div>
        {expense.notes && (
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {expense.notes}
          </div>
        )}
        {expense.next_charge_date && (
          <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 3 }}>
            📅 Próximo: {new Date(expense.next_charge_date).toLocaleDateString("es-ES", { day: "numeric", month: "long" })}
          </div>
        )}
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text)" }}>
          {fmtEUR(expense.amount)}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 600 }}>
          {freq?.short}
        </div>
        {expense.frequency !== "monthly" && expense.frequency !== "one-time" && expense.active && (
          <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 2 }}>
            ≈ {fmtEUR(monthlyEq(expense))}/mes
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <button onClick={onClick} title="Editar" style={iconBtn}>✏️</button>
        <button onClick={onToggleActive} title={expense.active ? "Desactivar" : "Reactivar"} style={iconBtn}>{expense.active ? "⏸" : "▶"}</button>
        <button onClick={onDelete} title="Eliminar" style={{ ...iconBtn, color: "#dc2626" }}>🗑</button>
      </div>
    </div>
  );
}

function monthlyEq(e: Expense): number {
  if (!e.active) return 0;
  switch (e.frequency) {
    case "monthly": return e.amount;
    case "yearly": return e.amount / 12;
    case "quarterly": return e.amount / 3;
    case "weekly": return e.amount * 52 / 12;
    case "one-time": return 0;
    default: return 0;
  }
}

function fmtEUR(n: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

// Styles
const btnPrimary: React.CSSProperties = {
  padding: "10px 18px",
  background: "linear-gradient(135deg, #0071e3, #1d4ed8)",
  color: "#fff", border: "none", borderRadius: 10,
  fontSize: 13.5, fontWeight: 700, cursor: "pointer",
  fontFamily: "inherit",
  boxShadow: "0 2px 8px rgba(0,113,227,0.25)",
};
const btnGhost: React.CSSProperties = {
  padding: "10px 16px",
  background: "transparent", color: "var(--text-dim)",
  border: "1px solid var(--border)", borderRadius: 10,
  fontSize: 13.5, fontWeight: 600, cursor: "pointer",
  fontFamily: "inherit",
};
const empty: React.CSSProperties = {
  padding: "60px 20px", textAlign: "center",
  background: "#fff", border: "1px dashed var(--border)",
  borderRadius: 14, maxWidth: 920, color: "var(--text-faint)",
};
const iconBtn: React.CSSProperties = {
  padding: "4px 8px",
  background: "transparent", border: "1px solid var(--border)",
  borderRadius: 6, fontSize: 12, cursor: "pointer",
  fontFamily: "inherit", color: "var(--text-dim)",
};
const modalBackdrop: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000, padding: 20, backdropFilter: "blur(4px)",
};
const modalBox: React.CSSProperties = {
  background: "#fff", borderRadius: 14, padding: 24,
  maxWidth: 540, width: "100%", maxHeight: "90vh", overflowY: "auto",
  boxShadow: "0 20px 60px rgba(15,23,42,0.25)",
};
const label: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 700,
  color: "var(--text-dim)", textTransform: "uppercase",
  letterSpacing: "0.06em", marginBottom: 5, marginTop: 12,
};
const labelOpt: React.CSSProperties = {
  fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--text-faint)", marginLeft: 6,
};
const input: React.CSSProperties = {
  width: "100%", padding: "9px 12px",
  border: "1.5px solid var(--border)",
  borderRadius: 9, fontSize: 13.5, color: "var(--text)",
  outline: "none", boxSizing: "border-box", fontFamily: "inherit", background: "#fff",
};
