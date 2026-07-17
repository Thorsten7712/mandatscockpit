import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Hinweis: "base" muss dem GitHub-Repo-Namen entsprechen, damit GitHub Pages
// die Assets unter https://<user>.github.io/<repo>/ korrekt findet.
export default defineConfig({
  plugins: [react()],
  base: '/mandatscockpit/',
})
