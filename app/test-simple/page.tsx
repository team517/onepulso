export default function TestSimple() {
  return (
    <html>
      <body style={{ fontFamily: "sans-serif", padding: 40, textAlign: "center" }}>
        <h1>✅ La página carga correctamente</h1>
        <p>Si ves esto, tu conexión a Railway funciona.</p>
        <p style={{ marginTop: 30, fontSize: 14, color: "#666" }}>
          Hora servidor: <span suppressHydrationWarning>{new Date().toISOString()}</span>
        </p>
        <p style={{ marginTop: 30 }}>
          <a href="/u/3861c3c4679f0e92/login">→ Ir al login del unibox</a>
        </p>
      </body>
    </html>
  );
}
