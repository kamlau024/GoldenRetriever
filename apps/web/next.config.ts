import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@gr/config", "@gr/core", "@gr/db", "@gr/ai", "@gr/ingest", "@gr/retrieval"],
  serverExternalPackages: ["postgres", "jsdom"],
  // Our TS source uses explicit `.js` extensions on relative imports (Bundler/NodeNext
  // style). Webpack needs this alias to resolve `foo.js` -> `foo.ts`/`foo.tsx` at build.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};
export default config;
