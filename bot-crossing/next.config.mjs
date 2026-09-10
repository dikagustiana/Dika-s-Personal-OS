/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // three, drei and postprocessing ship ESM that Next 14's webpack handles
  // natively; transpilePackages is kept explicit so a future drei release
  // that leans on a bare `three/examples/jsm` import does not break the build.
  transpilePackages: ['three', '@react-three/drei', '@react-three/postprocessing'],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
