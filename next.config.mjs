/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  // Fly.io image: self-contained server in .next/standalone.
  output: "standalone",
  // Native SQLite binding stays a runtime require, not a bundled module.
  serverExternalPackages: ["better-sqlite3"],
  // smart-account-kit ships extensionless relative ESM imports; let Next
  // transpile/resolve it bundler-style on the server too (same as the
  // Sembol reference app).
  transpilePackages: ["smart-account-kit"],
  // Never expose server-only env to the client bundle; NEXT_PUBLIC_* only.
  poweredByHeader: false,
};

export default nextConfig;
