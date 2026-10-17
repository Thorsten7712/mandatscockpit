import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Edge Functions (Deno) und Node-Skripte haben eigene Laufzeiten und werden
// hier nicht gelintet - Deno prüft per `deno check`, siehe CLAUDE.md.
export default defineConfig([
  globalIgnores(['dist', 'supabase/functions', 'scripts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Neue Regel aus react-hooks 7 (React-Compiler-Vorbereitung). Sie meldet
      // das im ganzen Projekt verwendete Lade-Muster `useEffect(() => {
      // loadX() }, [...])`, weil loadX vor dem ersten await synchron State
      // setzt. Das ist beabsichtigt (Ladezustand), ein Umbau auf
      // Suspense/Data-Router wäre ein eigenes Vorhaben.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
])
