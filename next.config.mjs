/** @type {import('next').NextConfig} */
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
};

export default nextConfig;
