"use client";
/**
 * Límite de error de ÚLTIMO recurso (falla el propio layout raíz). Debe traer
 * su propio <html>/<body>. Evita la pantalla en blanco total.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#fafbfc" }}>
        <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 40 }}>⚠️</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>La aplicación tuvo un fallo</div>
          <div style={{ fontSize: 13, color: "#64748b", maxWidth: 420 }}>Recarga para volver a intentarlo.</div>
          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            <button onClick={() => reset()} style={{ padding: "10px 20px", background: "linear-gradient(135deg,#f9a603,#d15cfe)", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Reintentar</button>
            <button onClick={() => window.location.reload()} style={{ padding: "10px 20px", background: "#eef1f5", color: "#0f172a", border: "1px solid #d9dee6", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Recargar</button>
          </div>
        </div>
      </body>
    </html>
  );
}
