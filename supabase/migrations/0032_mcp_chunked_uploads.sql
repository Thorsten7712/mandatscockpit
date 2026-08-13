-- Chunked File-Upload für den MCP-Server: der aufrufende MCP-Client
-- (Claude) schneidet beim Erzeugen sehr langer Base64-Tool-Argumente
-- irgendwo zwischen ~18.000 und 20.000 Zeichen ab - eine technische Grenze
-- der Tool-Aufruf-Generierung selbst, nicht des MandatsCockpit-Servers.
-- Eine 54,6-KB-PDF ergibt bereits 72.792 Base64-Zeichen und lässt sich damit
-- nicht mehr in einem einzigen create_*_note-Aufruf übertragen. Lösung:
-- die Datei in mehreren kleinen Häppchen über mehrere Tool-Aufrufe
-- übertragen (start_file_upload/append_file_chunk/finish_file_upload,
-- siehe supabase/functions/mcp-server/tools/uploads.ts), serverseitig
-- zwischenspeichern und erst beim Abschluss zusammensetzen.
create table public.mcp_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  dateiname text not null,
  erstellt_am timestamptz not null default now()
);

-- Eine Zeile pro Häppchen statt eines wachsenden Array-/Text-Felds auf
-- mcp_uploads - ein erneuter append_file_chunk-Aufruf mit derselben
-- chunk_index (z. B. nach einem Netzwerk-Retry) überschreibt dadurch per
-- Upsert einfach dasselbe Häppchen, statt Duplikate anzuhängen.
create table public.mcp_upload_chunks (
  upload_id uuid not null references public.mcp_uploads(id) on delete cascade,
  chunk_index int not null,
  chunk_base64 text not null,
  primary key (upload_id, chunk_index)
);

alter table public.mcp_uploads enable row level security;
alter table public.mcp_upload_chunks enable row level security;

create policy "mcp_uploads_manage_own"
  on public.mcp_uploads for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- mcp_upload_chunks hat kein eigenes user_id-Feld - Zugriff läuft über den
-- Besitz der zugehörigen mcp_uploads-Zeile (analog todo_placements/
-- antrag_shares-Mustern in anderen Migrationen).
create policy "mcp_upload_chunks_manage_via_upload"
  on public.mcp_upload_chunks for all
  using (exists (select 1 from public.mcp_uploads u where u.id = upload_id and u.user_id = auth.uid()))
  with check (exists (select 1 from public.mcp_uploads u where u.id = upload_id and u.user_id = auth.uid()));
