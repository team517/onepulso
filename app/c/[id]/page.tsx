"use client";
import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/**
 * Página raíz del unibox: redirige a /login o /inbox según el estado
 * de autenticación. Evita el 404 cuando el usuario entra a /u/[id]
 * sin la subruta.
 */
export default function UniboxRootRedirect() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  useEffect(() => {
    fetch("/api/unibox-client/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d?.authenticated && d?.uniboxId === id) {
          router.replace(`/c/${id}/inbox`);
        } else {
          router.replace(`/c/${id}/login`);
        }
      })
      .catch(() => {
        router.replace(`/c/${id}/login`);
      });
  }, [id, router]);

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "linear-gradient(145deg, #fafbfc 0%, #f4f1ff 50%, #fff5e8 100%)",
      fontFamily: "'Plus Jakarta Sans', -apple-system, sans-serif",
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16,
          background: "linear-gradient(145deg, #f9a603, #d15cfe)",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 24, color: "#fff", marginBottom: 16,
          boxShadow: "0 10px 30px rgba(209,92,254,0.3)",
        }}>✉</div>
        <div style={{
          display: "inline-block", width: 22, height: 22,
          border: "3px solid rgba(209,92,254,0.2)",
          borderTopColor: "#d15cfe", borderRadius: "50%",
          animation: "spin 0.8s linear infinite", marginBottom: 14,
          marginLeft: 10, verticalAlign: "middle",
        }} />
        <div style={{ color: "#64748b", fontSize: 14, marginTop: 8 }}>
          Redirigiendo a tu unibox…
        </div>
      </div>
      <style jsx>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
