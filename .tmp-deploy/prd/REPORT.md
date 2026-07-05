# Report — Plataforma "Supabase próprio" (multi-DB Postgres)

**Data:** 29/06/2026
**VPS:** srv1300318 — `76.13.168.223` — Ubuntu 24.04 — 12 cores / 16 GB / ~176 GB livres

---

## Arquitetura definida (decisões fechadas)

- **1 Super Postgres** (um container) com **N databases** — um por projeto. Não é multi-schema (auth quebraria), não são vários Supabase instalados.
- **N GoTrue** (`supabase/auth`) — um leve por projeto/base de usuários. Não construir: usar pronto. Chaves assimétricas.
- **3 camadas:**
  - Data plane (instalar): Postgres + PgBouncer + Caddy + MinIO
  - Control plane (construir): banco de metadados + orquestração — o cérebro
  - Painel (construir): Next.js sobre o control plane
- **Migração:** só projetos sem edge functions vêm pro self-host; os complexos ficam no Supabase. Modelo híbrido permanente.
- **Auth:** todos os projetos têm usuários reais (email/senha). Hashes bcrypt migram limpos via pg_dump. Sem login social hoje (Google é desejo futuro — fazer DEPOIS de migrar, nunca junto).
- **Domínio:** `fbr.news` (Cloudflare). Servidor de produção atual = `148.230.94.24` (NÃO mexer). VPS nova testada via `lab.fbr.news`.

---

## FEITO — Fase 0 (fundação no ar)

- [x] VPS limpa + Ubuntu 24.04 + Docker
- [x] Usuário `deploy` (acesso por senha)
- [x] Firewall ufw: só SSH + 80 + 443
- [x] Super Postgres 16 (healthy) — tunado p/ 16 GB
- [x] PgBouncer (pooler) — auth_type=plain, escuta 127.0.0.1:6432
- [x] MinIO (healthy) — storage, 127.0.0.1:9000/9001
- [x] Caddy com TLS automático (HTTP challenge)
- [x] Certificado real Let's Encrypt em `lab.fbr.news` — cadeado válido
- [x] Backup do servidor antigo (133 GB) salvo na máquina local

**Testes do critério "pronto" — 4/4 passaram:**
postgres cria DB / pgbouncer encaminha / web+TLS / firewall fechado.

---

## PENDÊNCIAS IMEDIATAS (não bloqueiam, mas fazer)

1. **Revogar token Cloudflare** `cfut_n2sgRsBW...` — apareceu no chat. Gerar outro.
2. **Wildcard `*.fbr.news`** — plugin caddy-dns/cloudflare incompatível com o novo formato de token `cfut_`. HTTP challenge resolveu o domínio único; wildcard precisa de DNS challenge. Resolver quando o painel precisar de subdomínios dinâmicos (opções: downgrade do formato de token, outro método, ou cert por subdomínio).
3. **Backup automatizado** — pg_dump agendado + **restore testado**. Fazer ANTES da Fase 1.

---

## A FAZER — próximas fases

### Fase 1 — Control plane (o coração) ← próximo grande passo
- [ ] Schema do banco de metadados: `projects`, `databases`, `auth_instances`, `tokens`, `buckets`
- [ ] API de provisionamento atômico: criar DB → roles writer/reader → subir GoTrue (via Docker API) → registrar rota → emitir tokens
- [ ] Caminho de desprovisionamento (rollback)
- [ ] Critério pronto: 1 chamada cria projeto e consegue registrar+logar usuário nele
- **Risco concentrado aqui** (orquestração Docker+Postgres transacional)

### Fase 2 — Roteamento dinâmico
- [ ] Caddy roteando por projeto lendo o control plane (API de config dinâmica)
- [ ] Cache de leitura p/ conteúdo público
- [ ] Critério pronto: 2 projetos em subdomínios distintos, isolamento de usuários comprovado

### Fase 3 — Importador (minimalista)
- [ ] pg_dump/restore trazendo `public` + `auth` juntos
- [ ] Recriar roles do Supabase (authenticated, anon, service_role)
- [ ] Validar login real com senha antiga (prova dos hashes bcrypt)
- [ ] Critério pronto: projeto-piloto migrado e usuário loga no destino

### Fase 4 — Painel Next.js
- [ ] CRUD de projetos, editor SQL, visualizador de tabelas, gestão de tokens/buckets, tela do importador
- [ ] Auth do painel (GoTrue admin) + emails configuráveis de manutenção de conta
- [ ] Avaliar embutir Supabase Studio por projeto

### Fase 5 — Storage + endurecimento
- [ ] Buckets de imagem por projeto (quente SSD / frio NAS) + cache
- [ ] MCP read-only por padrão
- [ ] Revisão de segurança (cofre de secrets, nada exposto)

---

## Stack de construção (definida)
Control plane/API: TypeScript + Node (NestJS/Fastify) · Metadados: Postgres dedicado ·
Painel: Next.js + React · Proxy: Caddy · Orquestração: Docker API · Pooling: PgBouncer (→ Supavisor se escalar)

## Componentes open-source reusados
Postgres · PgBouncer · GoTrue (`supabase/auth`) · PostgREST · MinIO · Caddy.
Sem solução pronta única p/ multi-projeto (SelfDB existe mas imaturo). Control plane é o que se constrói.

---

## Arquivos da stack (em ~/fase0 na VPS)
docker-compose.yml · .env · postgres/postgresql.conf · caddy/Caddyfile · caddy/Dockerfile · pgbouncer/pgbouncer.ini · pgbouncer/userlist.txt

## Comandos úteis
- status: `cd ~/fase0 && docker compose ps`
- logs: `docker compose logs --tail=30 <serviço>`
- criar DB: `docker exec super_postgres psql -U admin -d postgres -c "CREATE DATABASE x;"`
