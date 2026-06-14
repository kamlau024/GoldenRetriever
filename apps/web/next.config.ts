import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@gr/config", "@gr/core", "@gr/db", "@gr/ai", "@gr/ingest", "@gr/retrieval"],
  serverExternalPackages: ["postgres", "jsdom"],
};
export default config;
