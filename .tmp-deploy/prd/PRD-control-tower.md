# PRD — Painel de Gestão Multi-Postgres (codinome: "Control Tower")

**Versão:** 1.0 · **Data:** 29/06/2026 · **Dono:** Sergio
**Stack-alvo:** Next.js + React (UI) · Node/TypeScript (API/control plane) · Postgres (metadados) · Docker API (orquestração) · Caddy (roteamento) · GoTrue / PgBouncer / MinIO (data plane)

---

## 1. Visão

Uma aplicação web única que faz dezenas de bancos Postgres independentes — cada um com sua auth, storage e rotas — se comportarem como **uma plataforma só, gerenciável visualmente**. Substitui a parte SaaS do Supabase (o painel que cria/destrói projetos) que não é open-source, reusando os componentes open-source por baixo.

**Problema:** hoje, gerenciar N projetos = N stacks soltas, criadas e configuradas na mão (criar DB + subir GoTrue + registrar rota + emitir tokens). Não escala, é erro-prone, e não há visão unificada.

**Solução:** um painel que provisiona, monitora e opera todos os projetos a partir de uma tela, com um control plane (cérebro) que registra o estado de tudo num banco de metadados.

**Não-objetivos (v1):** edge functions (ficam no Supabase), login social, multi-máquina, billing.

---

## 2. Usuários

- **Admin (Sergio + sócio):** acesso total. Criam/removem projetos, rodam SQL, emitem tokens, importam, veem dados. 2 pessoas.
- **Sistema gerador de conteúdo / CMS** (não-humano): consome via token de serviço; não usa o painel.

Auth do painel: GoTrue dedicado de admin, com emails configuráveis de manutenção de conta. Acesso restrito (basic auth hoje; GoTrue admin na v1).

---

## 3. Conceito central: o que torna "uma coisa só"

O **banco de metadados** (control plane) é a fonte única de verdade. Toda peça consulta ele para saber "onde está a coisa do projeto X".

Entidades:
- `projects` — id, nome, slug, subdomínio, status, criado_em
- `databases` — projeto_id, nome do DB, host, roles (writer/reader)
- `auth_instances` — projeto_id, porta/container do GoTrue, chaves JWT
- `tokens` — projeto_id, escopo (service/anon/mcp), hash, expiração, revogado
- `buckets` — projeto_id, nome, backend (SSD/NAS)
- `routes` — subdomínio → projeto_id → alvos (DB, GoTrue)

O **control plane stateless** (estado só no banco de metadados) → permite escalar p/ várias máquinas depois sem reescrever.

---

## 4. Funcionalidades (priorizadas)

### P0 — núcleo (sem isso não existe produto)

**F1. Provisionar projeto (atômico)**
Botão "Novo projeto" → cria database + roles writer/reader → sobe container GoTrue apontado pro DB → registra rota no Caddy → emite tokens iniciais → grava tudo no metadados. Se qualquer passo falha, **rollback completo**.
*Aceite:* 1 ação cria projeto e dá pra registrar+logar um usuário nele, sem terminal.

**F2. Listar / ver / remover projetos**
Dashboard com todos os projetos: status (verde/vermelho), DB, nº usuários, uso de disco. Desprovisionar com confirmação.

**F3. Editor SQL**
Editor (Monaco/CodeMirror) que roda SQL contra o DB do projeto selecionado. Histórico de queries. Aviso em comandos destrutivos.

**F4. Visualizador de tabelas**
Lista tabelas do projeto, abre como planilha (paginada, virtualizada), filtro/ordenação. Avaliar embutir Supabase Studio por projeto vs. construir.

**F5. Gerador de tokens**
Por projeto, emite 3 escopos: `service` (escrita — gerador de conteúdo), `anon` (leitura), `mcp` (read-only). Lista, revoga, mostra expiração. JWT com chaves assimétricas.

### P1 — migração e dados

**F6. Importador do Supabase**
Cola connection string + token de origem → cria projeto destino → pg_dump de `public` + `auth` → restore → recria roles do Supabase → valida. Relatório: o que entrou / o que precisa de mão. Valida login real com senha antiga (prova bcrypt).
*Escopo enxuto:* sem edge functions, sem login social, sem secrets automáticos.

**F7. Buckets de imagem (MinIO)**
Por projeto: criar bucket, upload, listar, política pública/privada. Quente no SSD, frio no NAS. Cache de leitura.

### P2 — operação e segurança

**F8. Acesso via MCP**
Servidor MCP por projeto, **read-only por padrão**, autenticado por token MCP. Ferramentas: listar tabelas, descrever schema, query read-only. Escrita exige confirmação explícita.

**F9. Backups**
pg_dump agendado por projeto, retenção, restore testável pela UI. Status do último backup no dashboard.

**F10. Saúde do sistema**
Visão de recursos: RAM/CPU/disco, status de cada container, alertas (DB caído, disco cheio, GoTrue em restart).

---

## 5. Telas (esboço visual)

```
┌────────────────────────────────────────────────────────┐
│  CONTROL TOWER          [admin]  [saúde: ●]  [+ Projeto] │
├────────────┬───────────────────────────────────────────┤
│ PROJETOS   │  DASHBOARD                                  │
│ ● blog-a   │  ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│ ● revista  │  │ blog-a  │ │ revista │ │ blog-c  │        │
│ ● blog-c   │  │ ● up    │ │ ● up    │ │ ⚠ restart│       │
│ + novo     │  │ 1.2k usr│ │ 800 usr │ │ ...     │        │
│            │  │ 3.4 GB  │ │ 1.1 GB  │ │         │        │
│ ─────────  │  └─────────┘ └─────────┘ └─────────┘        │
│ FERRAMENTAS│                                              │
│  SQL       │  [ao clicar num projeto, abre detalhe:]     │
│  Tabelas   │   tabs: Visão | SQL | Tabelas | Tokens |     │
│  Tokens    │         Buckets | Auth/Emails | Backups      │
│  Importar  │                                              │
│  Buckets   │                                              │
│  Saúde     │                                              │
└────────────┴───────────────────────────────────────────┘
```

Princípio de UX: **operar o ciclo completo de um projeto sem sair do painel** (criar → SQL → ver dados → token → importar → backup).

---

## 6. Requisitos não-funcionais

- **Isolamento:** usuário de um projeto nunca autentica em outro (prova obrigatória nos testes).
- **Atomicidade:** provisionamento ou completa inteiro ou reverte limpo.
- **Segurança:** Postgres nunca exposto; secrets em cofre (não .env solto); MCP read-only default; painel atrás de auth forte.
- **Performance:** alvo de blogs/revistas — read-heavy, cache agressivo. Dezenas de DBs leves em 16 GB com folga.
- **Escala:** control plane stateless → adicionar máquinas (NAS/2ª VPS) sem reescrever.
- **Observabilidade:** log estruturado de cada operação de provisionamento.

---

## 7. Fases de entrega (ligadas ao plano de ação)

| Fase | Entrega | Funcs |
|------|---------|-------|
| 0 ✅ | Fundação data plane | infra |
| 1 | Control plane: metadados + provisionamento | F1, F2 |
| 2 | Roteamento dinâmico | (F1 completa) |
| 3 | Importador | F6 |
| 4 | Painel Next.js completo | F3, F4, F5, F9, F10 |
| 5 | Storage + endurecimento | F7, F8 |

Fases 0→1→2 são corrente obrigatória. 3/4/5 reordenáveis por urgência.

---

## 8. Riscos

- **Provisionamento atômico (F1):** orquestrar Docker + Postgres transacional é o ponto mais denso. Folga de cronograma aqui.
- **Wildcard TLS:** plugin caddy-dns/cloudflare incompatível com token novo `cfut_`. Subdomínios dinâmicos dependem de resolver isso.
- **Importador (F6):** RLS do Supabase referencia roles/`auth.uid()` — recriar estrutura mínima de auth no destino, senão policies quebram silenciosamente.
- **Over-engineering:** resistir a recriar o Supabase inteiro. Construir só o orquestrador.

---

## 9. Métricas de sucesso

- Criar um projeto novo: < 60s, 1 ação, zero terminal.
- Migrar um projeto do Supabase: usuário loga no destino com senha antiga.
- Operar tudo (CRUD projeto, SQL, dados, tokens, import, backup) pela UI.
- Dezenas de projetos rodando em 1 VPS com folga de RAM.
