"use client";
/**
 * Límite de error de Next.js. Si una página falla al renderizar, en vez de
 * quedarse en pantalla muerta ("se bugea y no cambia"), muestra esto con un
 * botón para reintentar sin recargar toda la app.
 */
import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[page error]", error?.message, error?.digest);
  }, [error]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: 24,
        textAlign: "center",
        background: "var(--bg, #fafbfc)",
        fontFamily: "system-ui, sans-serif",
        zIndex: 9998,
      }}
    >
      <div style={{ fontSize: 40 }}>⚠️</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text, #0f172a)" }}>
        Esta pantalla no cargó bien
      </div>
      <div style={{ fontSize: 13, color: "var(--text-dim, #64748b)", maxWidth: 420, lineHeight: 1.5 }}>
        Ha habido un fallo al cargar el módulo. Puedes reintentar; no se ha perdido nada.
        {error?.message ? <><br /><span style={{ fontSize: 11, opacity: 0.7 }}>{String(error.message).slice(0, 200)}</span></> : null}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        <button
          onClick={() => reset()}
          style={{
            padding: "10px 20px",
            background: "linear-gradient(135deg, #f9a603 0%, #d15cfe 100%)",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            fontWeight: 700,
            fontSize: 14,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Reintentar
        </button>
        <button
          onClick={() => { window.location.href = "/"; }}
          style={{
            padding: "10px 20px",
            background: "var(--bg-elev-2, #eef1f5)",
            color: "var(--text, #0f172a)",
            border: "1px solid var(--border, #d9dee6)",
            borderRadius: 10,
            fontWeight: 700,
            fontSize: 14,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Ir a Inicio
        </button>
      </div>
    </div>
  );
}
