import type {NextConfig} from "next";
import path from "node:path";
const basePath=process.env.ENGINE_PAGES_BASE_PATH??"/engine";
const config:NextConfig={
  output:"export",trailingSlash:true,basePath,
  turbopack:{root:path.resolve(__dirname,"..")},
  env:{NEXT_PUBLIC_ENGINE_BASE_PATH:basePath,NEXT_PUBLIC_ENGINE_API_URL:process.env.ENGINE_API_URL},
  images:{unoptimized:true},
};
export default config;
