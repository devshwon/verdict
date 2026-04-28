import { defineConfig } from "@apps-in-toss/web-framework/config";

export default defineConfig({
  appName: "verdict",
  brand: {
    displayName: "판정단",
    primaryColor: "#534AB7",
    icon: "", // TODO: 앱 아이콘 이미지 주소 설정 필요
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
