/**
 * Pantalla de carga GLOBAL de Next.js. Se muestra AL INSTANTE al navegar entre
 * módulos mientras la página nueva carga → la navegación deja de "parecer
 * congelada". Sin esto, Next espera en silencio y el usuario cree que no cambia.
 */
export default function Loading() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        background: "var(--bg, #fafbfc)",
        zIndex: 9998,
      }}
    >
      <div
        style={{
          width: 46,
          height: 46,
          borderRadius: 13,
          background: "linear-gradient(135deg, #f9a603 0%, #f59e3a 35%, #d15cfe 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontWeight: 800,
          fontSize: 24,
          fontFamily: "system-ui, sans-serif",
          boxShadow: "0 6px 20px rgba(209,92,254,0.35)",
        }}
      >
        O
      </div>
      <div
        className="opl-loading-spin"
        style={{
          width: 26,
          height: 26,
          border: "3px solid rgba(130,130,150,0.22)",
          borderTopColor: "#d15cfe",
          borderRadius: "50%",
        }}
      />
      <div style={{ fontSize: 13, color: "var(--text-dim, #64748b)", fontFamily: "system-ui, sans-serif" }}>
        Cargando…
      </div>
      <style>{`@keyframes opl-loading-rot{to{transform:rotate(360deg)}} .opl-loading-spin{animation:opl-loading-rot .7s linear infinite}`}</style>
    </div>
  );
}
