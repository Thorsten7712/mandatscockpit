import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  // Läuft die App ohne Supabase-Zugangsdaten, funktioniert nichts, was Daten lädt.
  // createClient() wirft bei leerer URL sofort eine Exception, die den kompletten
  // React-Tree crashen lässt (weiße Seite ohne erkennbaren Fehler) – daher hier ein
  // Platzhalter, damit die App wenigstens lädt. .env.example nach .env.local kopieren
  // und mit echten Werten befüllen.
  console.warn('Supabase-Umgebungsvariablen fehlen – siehe .env.example')
}

export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseAnonKey || 'placeholder')
