/** @type {import('next').NextConfig} */
const nextConfig = {
  // PERFORMANCE: compresión gzip de respuestas (Next la activa por defecto
  // en prod pero la hacemos explícita).
  compress: true,
  // PERFORMANCE: deshabilita x-powered-by header (1 header menos por request).
  poweredByHeader: false,
  // NOTA: output "standalone" daría imagen Docker más pequeña pero requiere
  // copiar manualmente .next/static y public/ al directorio standalone tras
  // el build → mantenemos el modo normal por simplicidad.
  // PERFORMANCE: cache-control para assets estáticos (1 año, son immutable).
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Imágenes públicas tienen hash en el nombre → cache largo
        source: "/img/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400" }, // 1 día
        ],
      },
    ];
  },
  experimental: {
    serverActions: { bodySizeLimit: "100mb" },
    // PERFORMANCE: optimizePackageImports tree-shake estas libs grandes.
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-icons",
      "date-fns",
    ],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};
export default nextConfig;
