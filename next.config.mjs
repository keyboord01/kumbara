/** @type {import('next').NextConfig} */

/**
 * Hosts that used to serve production and now redirect (308) to the canonical
 * domain. kumbara.vercel.app is a deployment alias on another Vercel team, so
 * the redirect cannot live on the project domain; it lives here and applies to
 * whichever deployment that alias points at. Preview hosts
 * (kumbara-<hash>-…vercel.app) are not listed and keep serving themselves.
 */
const LEGACY_HOSTS = ["kumbara.vercel.app", "kumbara-theta.vercel.app", "kumbara-keyboord01s-projects.vercel.app"];
const CANONICAL = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");

const nextConfig = {
  devIndicators: false,
  // Self-contained server for the Docker/Fly path; Vercel builds its own output.
  ...(process.env.VERCEL ? {} : { output: "standalone" }),
  // libsql (and its native binding for file: databases) stays a runtime require.
  serverExternalPackages: ["@libsql/client", "libsql"],
  // smart-account-kit ships extensionless relative ESM imports; let Next
  // transpile/resolve it bundler-style on the server too (same as the
  // Sembol reference app).
  transpilePackages: ["smart-account-kit"],
  // Never expose server-only env to the client bundle; NEXT_PUBLIC_* only.
  poweredByHeader: false,
  async redirects() {
    if (!CANONICAL) return [];
    return LEGACY_HOSTS.map((host) => ({
      source: "/:path*",
      has: [{ type: "host", value: host }],
      destination: `${CANONICAL}/:path*`,
      permanent: true, // 308
    }));
  },
};

export default nextConfig;
