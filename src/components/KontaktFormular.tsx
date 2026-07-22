import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'

/**
 * Öffentliches Kontaktformular auf der Impressum-Seite - funktioniert ohne
 * Login (siehe kontakt_anfragen_insert_all-Policy, erste anonyme
 * Insert-Policy im Projekt). Eingehende Nachrichten landen im
 * "Kontaktanfragen"-Bereich der Settings (nur für Admins, siehe
 * Settings.tsx).
 */
export function KontaktFormular() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [nachricht, setNachricht] = useState('')
  // Honeypot: für Menschen unsichtbares Feld, das leer bleiben muss - simple
  // Bot-Abwehr ohne externen Captcha-Dienst. Kein Ersatz für echten
  // Spam-Schutz, aber hält die naivsten Formular-Bots ab.
  const [website, setWebsite] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (website) {
      // Honeypot ausgelöst - so tun, als wäre alles gut, ohne zu speichern.
      setSent(true)
      return
    }
    setSending(true)
    setError(null)
    const { error } = await supabase
      .from('kontakt_anfragen')
      .insert({ name: name.trim(), email: email.trim(), nachricht: nachricht.trim() })
    if (error) {
      setError('Nachricht konnte nicht gesendet werden. Bitte versuche es später erneut.')
      setSending(false)
      return
    }
    setSent(true)
    setSending(false)
  }

  if (sent) {
    return (
      <div className="mc-card p-4 text-sm text-slate-700">
        Danke, deine Nachricht ist angekommen! Ich melde mich so schnell wie möglich.
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mc-card space-y-2.5 p-4">
      <input
        type="text"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="mc-input w-full"
        required
      />
      <input
        type="email"
        placeholder="E-Mail"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="mc-input w-full"
        required
      />
      <textarea
        placeholder="Deine Nachricht"
        value={nachricht}
        onChange={(e) => setNachricht(e.target.value)}
        className="mc-input w-full"
        rows={4}
        required
      />
      <input
        type="text"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={sending} className="mc-btn-primary">
        {sending ? 'Senden...' : 'Nachricht senden'}
      </button>
    </form>
  )
}
