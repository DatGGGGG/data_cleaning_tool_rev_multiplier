import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath,
  allowedDevOrigins: ["192.168.236.137", "localhost", "127.0.0.1"],
};

export default nextConfig;
