import { defineConfig } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    // Lets the dev server be reached through an ngrok tunnel (used to test
    // the ssconf:// dynamic key flow against a real public host) without
    // hard-coding one specific random subdomain.
    allowedHosts: [
      ".ngrok-free.dev",
      ".ngrok-free.app",
      ".ngrok.io",
      ".ngrok.app",
    ],
  },
  preview: {
    // The build's prerender step (spa.enabled forces it on) spins up this
    // preview server internally and fetches it back via Bun's fetch(). Some
    // container network setups (BuildKit's docker-container driver) resolve
    // the hostname "localhost" to ::1 on the client side while this server
    // only binds IPv4, so the fetch gets ECONNREFUSED. Pinning a literal
    // loopback IP sidesteps hostname resolution entirely.
    host: "127.0.0.1",
  },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackStart({ spa: { enabled: true } }),
    viteReact(),
  ],
})

export default config
