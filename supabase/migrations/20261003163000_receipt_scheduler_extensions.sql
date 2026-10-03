-- Infrastructure for scheduled receipt delivery. No job is created.
create schema if not exists extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
