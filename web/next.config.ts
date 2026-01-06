import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloudflare Pages에 정적 산출물을 배포하기 위해 export 모드 사용
  output: "export",
  reactCompiler: true,
};

export default nextConfig;
