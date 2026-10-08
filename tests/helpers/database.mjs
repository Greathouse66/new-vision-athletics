import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

export async function testDatabase() {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth; create schema extensions;
    -- Minimal Storage SQL contract for report RLS tests, not an HTTP Storage emulator.
    create schema storage;
    grant usage on schema storage to anon, authenticated, service_role;
    create table storage.buckets(id text primary key, name text, public boolean,
      file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),
      bucket_id text references storage.buckets(id), name text, metadata jsonb,
      unique(bucket_id, name));
    alter table storage.objects enable row level security;
    grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
    grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users(id uuid primary key, email varchar(255), email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
  `);
  const directory = new URL("../../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    if (file.includes("receipt_scheduler_extensions")) continue;
    if (file.includes("weekly_slots_and_dated_classes")) {
      await db.exec("insert into public.skill_groups(name) values ('Foundational'), ('Post-Bigs'), ('Advanced')");
    }
    await db.exec(await readFile(new URL(file, directory), "utf8"));
  }
  return db;
}
