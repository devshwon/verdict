import { defineConfig } from "@apps-in-toss/web-framework/config";

export default defineConfig({
  appName: "verdict",
  brand: {
    displayName: "판정단",
    primaryColor: "#534AB7",
    icon: "https://static.toss.im/appsintoss/28075/f7459d48-17f8-4c63-8293-4945082f68c8.png",
  },
  web: {
    host: "localhost",
    port: 5173,
    commands: {
      dev: "vite dev",
      build: "vite build",
    },
  },
  permissions: [],
  outdir: "dist",
});
