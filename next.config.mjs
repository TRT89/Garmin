/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keeps `next build` honest about types — we want real errors, not silence.
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
