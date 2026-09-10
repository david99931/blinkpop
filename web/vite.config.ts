import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Bind IPv4 loopback explicitly. Vite defaults to ::1 only on this machine,
    // which makes http://127.0.0.1:5173 refuse connections — and that is exactly
    // the origin Spotify requires: it rejects the hostname "localhost" outright
    // and only accepts IP literals over plain http. Without this the OAuth
    // callback dies with a connection error after the user has already approved.
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:3001",
    },
  },
});
