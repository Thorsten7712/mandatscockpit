// PostgREST liefert pro Abfrage höchstens 1.000 Zeilen (Supabase-Voreinstellung
// „Max rows") und schneidet darüber STILLSCHWEIGEND ab - kein Fehler, nur eine
// kürzere Liste. Bei 1.141 Drucksachen fehlten dem Dokumenten-Hub dadurch die
// ältesten, und von 2.324 Sitzungsverknüpfungen kam weniger als die Hälfte an.
//
// Bewusst doppelt zu alleZeilen()/inStuecken() in
// supabase/functions/mcp-server/tools/dokumente.ts: kein gemeinsames
// Build-Tooling zwischen Deno und dem Frontend (siehe CLAUDE.md).

const SEITENGROESSE = 1000

/**
 * Holt seitenweise alle Zeilen. `abfrage` muss eine stabile Sortierung
 * enthalten (z. B. zusätzlich `.order('id')`), sonst überlappen sich die
 * Seiten oder lassen Zeilen aus.
 */
export async function alleZeilen<T>(
  abfrage: (von: number, bis: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<{ zeilen: T[]; fehler: string | null }> {
  const zeilen: T[] = []
  for (let von = 0; ; von += SEITENGROESSE) {
    const { data, error } = await abfrage(von, von + SEITENGROESSE - 1)
    if (error) return { zeilen, fehler: error.message }
    zeilen.push(...((data ?? []) as T[]))
    if (!data || data.length < SEITENGROESSE) return { zeilen, fehler: null }
  }
}

/** Teilt lange Id-Listen für `.in()` auf: Die Ids landen in der URL, und gut
 *  1.000 UUIDs wären rund 40 KB - mehr, als ein Gateway sicher annimmt. */
export function inStuecken<T>(liste: T[], groesse = 150): T[][] {
  const stuecke: T[][] = []
  for (let i = 0; i < liste.length; i += groesse) stuecke.push(liste.slice(i, i + groesse))
  return stuecke
}
