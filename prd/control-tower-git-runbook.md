# Control Tower — Git self-hosted + Backups + Mirrors

**Host:** `76.13.168.223` (Control Tower — já rodando Postgres, PgBouncer, MinIO, Caddy)
**Objetivo:** Forgejo como Git central + estratégia de backup 3‑2‑1 + redundância do código via push mirrors.

---

## 0. Arquitetura

```
                        Internet
                           │  (443/HTTPS, 2222/SSH-git)
                     ┌─────▼─────┐
                     │   Caddy   │  TLS + reverse proxy
                     └─────┬─────┘
                           │ 127.0.0.1:3000
                     ┌─────▼─────┐
                     │  Forgejo  │  Git server (web + API + SSH)
                     └──┬─────┬──┘
              Postgres  │     │  MinIO (S3)
        (metadados,     │     │  (LFS, anexos, avatars)
         issues, PRs)   │     │
                  ┌─────▼─┐ ┌─▼──────┐
                  │Postgres│ │ MinIO  │   ← tudo em rede Docker interna,
                  └────────┘ └────────┘     NÃO exposto na internet
```

**Decisões-chave (e o porquê):**

| Decisão | Escolha | Motivo |
|---|---|---|
| DB do Forgejo | Postgres **direto** (não via PgBouncer) | Forgejo/xorm mantém sessões e usa recursos que não gostam de transaction‑pooling. Deixa o PgBouncer dedicado aos apps do Control Tower. |
| Armazenamento LFS/anexos | MinIO | Mantém arquivos grandes fora do Postgres e fora do dump de repos. |
| TLS / proxy | Caddy **dedicado do Forgejo**, cert por host `git.<domínio>` | ⚠️ **Não usar o Caddy do Control Tower.** O control plane publica o config inteiro via admin API `/load` e **sobrescreve** qualquer rota adicionada manualmente — a rota do Git sumiria na primeira republicação. Forgejo roda atrás do próprio Caddy. |
| Backup offsite | **obrigatório**, fora do box | MinIO no mesmo host **não é backup**. Se o box morre, MinIO morre junto. |
| Repos → como entram | **clones locais** (não migração via GitHub) | Suas contas GitHub estão suspensas; migração por URL não funciona. |

> ⚠️ **O pulo do gato do offsite:** o box é a sua cópia primária. A cópia que te salva num desastre é a que sai do box (Cloudflare R2 / Backblaze B2 / seu servidor local). Regra **3‑2‑1**: 3 cópias, 2 lugares, 1 offsite.

> 🔗 **Coordenação com o Control Tower (mesmo VPS):** o Control Tower **é dono do Caddy dele** (publica o config completo via `/load`, sobrescrevendo rotas manuais). Portanto o Forgejo **não compartilha esse Caddy** — sobe o próprio reverse-proxy. Concretamente: um segundo container Caddy, escutando em portas próprias, com um `Caddyfile` que só o Forgejo gerencia. Os dois Caddy coexistem no host desde que **não disputem as mesmas portas** (ver §1.5). Nenhuma mudança no Control Tower ou no PRD dele é necessária.

---

## 1. Forgejo

### 1.1 Banco no Postgres existente

```bash
docker exec -it postgres psql -U postgres
```
```sql
CREATE ROLE forgejo WITH LOGIN PASSWORD 'TROQUE_ESTA_SENHA';
CREATE DATABASE forgejo OWNER forgejo;
\q
```

### 1.2 Bucket no MinIO

Crie o bucket `forgejo` (via console do MinIO ou `mc`):
```bash
mc mb local/forgejo
```

### 1.3 `.env` (guarde com `chmod 600`)

```env
FORGEJO_DB_PASSWORD=TROQUE_ESTA_SENHA
MINIO_ACCESS_KEY=SUA_ACCESS_KEY
MINIO_SECRET_KEY=SUA_SECRET_KEY
```

### 1.4 `docker-compose.yml`

> Ajuste `git.fbr.news` para o subdomínio que você escolher, e `controltower_net` para o nome real da rede Docker que os outros serviços já usam (`docker network ls`). Confira a tag estável mais recente do Forgejo no Codeberg — aqui pino a major `11`.

```yaml
services:
  forgejo:
    image: codeberg.org/forgejo/forgejo:11
    container_name: forgejo
    restart: unless-stopped
    env_file: .env
    environment:
      - USER_UID=1000
      - USER_GID=1000
      # --- banco ---
      - FORGEJO__database__DB_TYPE=postgres
      - FORGEJO__database__HOST=postgres:5432
      - FORGEJO__database__NAME=forgejo
      - FORGEJO__database__USER=forgejo
      - FORGEJO__database__PASSWD=${FORGEJO_DB_PASSWORD}
      # --- servidor / URLs ---
      - FORGEJO__server__DOMAIN=git.fbr.news
      - FORGEJO__server__ROOT_URL=https://git.fbr.news/
      - FORGEJO__server__SSH_DOMAIN=git.fbr.news
      - FORGEJO__server__SSH_PORT=2222
      - FORGEJO__server__START_SSH_SERVER=true
      # --- segurança: instância privada da empresa ---
      - FORGEJO__service__DISABLE_REGISTRATION=true
      - FORGEJO__service__REQUIRE_SIGNIN_VIEW=true
      # --- storage no MinIO (LFS + anexos + avatars + packages) ---
      - FORGEJO__lfs__STORAGE_TYPE=minio
      - FORGEJO__storage__STORAGE_TYPE=minio
      - FORGEJO__storage__MINIO_ENDPOINT=minio:9000
      - FORGEJO__storage__MINIO_ACCESS_KEY_ID=${MINIO_ACCESS_KEY}
      - FORGEJO__storage__MINIO_SECRET_ACCESS_KEY=${MINIO_SECRET_KEY}
      - FORGEJO__storage__MINIO_BUCKET=forgejo
      - FORGEJO__storage__MINIO_USE_SSL=false
    volumes:
      - ./forgejo/data:/data
      - /etc/timezone:/etc/timezone:ro
      - /etc/localtime:/etc/localtime:ro
    ports:
      - "2222:2222"              # git over SSH
      - "127.0.0.1:3000:3000"    # HTTP só local — Caddy faz o proxy
    networks:
      - controltower_net

networks:
  controltower_net:
    external: true
```

```bash
docker compose up -d
docker compose logs -f forgejo   # acompanhe a inicialização
```

Abra `https://git.fbr.news`, complete a instalação inicial e crie o **primeiro usuário** (será o admin). Depois crie uma **org** (ex.: `fbr`) que vai receber os repos.

### 1.5 Caddy dedicado do Forgejo (NÃO usar o do Control Tower)

> ⚠️ **Regra de ouro:** num único host/IP, **só um processo escuta a porta 443**. O Control Tower vai querer a 443 para os subdomínios de projeto (e é dono do config dele, sobrescrevendo via `/load`). Portanto o Forgejo sobe um **Caddy próprio numa porta dedicada** e o **Cloudflare** (que você já usa) faz o roteamento por hostname para essa porta. Assim não há disputa de porta e **nada muda no Control Tower**.

**Passo 1 — Caddy dedicado do Forgejo (numa porta própria, ex.: 8443).** Adicione este serviço ao mesmo `docker-compose.yml`:

```yaml
  caddy-git:
    image: caddy:2
    container_name: caddy-git
    restart: unless-stopped
    ports:
      - "127.0.0.1:8443:8443"   # porta dedicada — NÃO 443 (essa é do Control Tower)
    volumes:
      - ./caddy-git/Caddyfile:/etc/caddy/Caddyfile:ro
      - ./caddy-git/data:/data
    networks:
      - controltower_net
```

`./caddy-git/Caddyfile` (TLS terminado no Cloudflare → aqui o origin fala HTTP na 8443):
```caddy
{
    auto_https off
}
:8443 {
    reverse_proxy forgejo:3000
}
```

**Passo 2 — Cloudflare roteia `git.<domínio>` para a 8443.** No painel Cloudflare da zona `fbr.news`:
1. Registro DNS `git` → IP do VPS, **proxied** (nuvem laranja). O Cloudflare termina o TLS público na 443.
2. **Rules → Origin Rules:** para `Host = git.fbr.news`, sobrescreva a **Origin Port** para `8443`. Isso manda o tráfego desse hostname pro Caddy do Forgejo, enquanto `*.fbr.news` (projetos) continua indo pra 443 (Control Tower).

> Alternativa sem Origin Rules: um **Cloudflare Tunnel** (`cloudflared`) apontando `git.fbr.news` → `http://forgejo:3000`. Aí você nem abre porta no firewall.

**Passo 3 — Firewall.** A 8443 só precisa aceitar o Cloudflare (ou nada, se usar Tunnel). Mantenha 443 livre pro Control Tower:
```bash
ufw allow 2222     # git over SSH
# NÃO abrir 8443 pra internet aberta — restrinja aos IPs do Cloudflare ou use Tunnel
```

Depois abra `https://git.fbr.news`, complete a instalação inicial, crie o **primeiro usuário** (admin) e a **org** `fbr` que vai receber os repos.

> **Se a 443 estiver LIVRE no host** (Control Tower rodando o Caddy dele em outra porta, ex.: 8080): aí o Caddy do Forgejo pode escutar 80/443 direto e emitir o próprio cert Let's Encrypt — sem depender do Cloudflare pro roteamento. Confirme com `ss -ltnp | grep -E ':(80|443)'` quem já ocupa as portas antes de decidir.

---

## 2. Importar os repos (clones locais)

Como o GitHub está suspenso, o caminho é empurrar os **clones que você já tem** no devserver/VPS/máquina local para o Forgejo.

### 2.1 Inventário primeiro

```bash
# lista todo repo git abaixo de um diretório e mostra o último commit
find ~/projects -type d -name .git 2>/dev/null | while read g; do
  d=$(dirname "$g")
  echo "$(git -C "$d" log -1 --format=%cd --date=short 2>/dev/null) — $d"
done | sort
```

Isso te diz **o que você tem localmente**. O que aparecer aqui está salvo. O que **só existe no GitHub e não tem clone** é o único material realmente em risco — anote pra recuperar quando a conta voltar (repo público qualquer um clona; privado precisa de um colaborador).

### 2.2 Script de import

Gere um **token** no Forgejo (Settings → Applications → Generate Token, escopo `write:repository` / `write:organization`).

```bash
#!/usr/bin/env bash
# import-repos.sh — empurra clones locais para o Forgejo
set -euo pipefail

FORGEJO_URL="https://git.fbr.news"
FORGEJO_USER="sergio"
FORGEJO_TOKEN="COLE_O_TOKEN_AQUI"
ORG="fbr"                              # dono/org de destino
SEARCH_ROOT="${1:-$HOME/projects}"     # onde estão seus clones

find "$SEARCH_ROOT" -type d -name '.git' | while read -r gitdir; do
  repo_path="$(dirname "$gitdir")"
  repo_name="$(basename "$repo_path")"
  echo ">> $repo_name"

  # cria o repo no Forgejo (ignora se já existir)
  curl -s -o /dev/null -X POST "$FORGEJO_URL/api/v1/orgs/$ORG/repos" \
    -H "Authorization: token $FORGEJO_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$repo_name\",\"private\":true}" || true

  # empurra tudo (branches + tags) — cópia fiel
  git -C "$repo_path" push --mirror \
    "https://$FORGEJO_USER:$FORGEJO_TOKEN@git.fbr.news/$ORG/$repo_name.git"
done
```

```bash
chmod +x import-repos.sh
./import-repos.sh ~/projects
```

> Rode primeiro num diretório pequeno pra validar. `--mirror` copia todos os refs; se algum repo reclamar, troca por `git push --all` seguido de `git push --tags`.

---

## 3. Push mirrors (redundância geográfica do código)

Backup no seu box protege contra falha de disco. Mirror externo protege contra **o box inteiro sumir**. Configure, por repo, um *push mirror* pra um segundo host Git.

No Forgejo: **Repo → Settings → Mirror Settings → Push Mirror** → URL do destino (GitHub quando voltar, **Codeberg**, GitLab) + token. Ele sincroniza sozinho no intervalo definido.

Para fazer em massa depois, dá pra scriptar via API (`POST /repos/{owner}/{repo}/push_mirrors`). Recomendo pelo menos **um** destino externo gratuito (Codeberg é ótimo e é da mesma gente do Forgejo).

---

## 4. Backups (3‑2‑1)

Três camadas: dump local (rápido) → criptografa → manda offsite.

### 4.1 Gerar chave de criptografia (uma vez)

```bash
age-keygen -o ct-backup-key.txt
# guarde a CHAVE PRIVADA FORA do box (gerenciador de senhas!)
# a linha "public key: age1..." vai no .env abaixo
```

### 4.2 `.env` do backup (`chmod 600`)

```env
AGE_PUBLIC_KEY=age1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Configure o rclone pro destino offsite (`rclone config` → remote `r2` apontando pro Cloudflare R2, ou B2/Wasabi).

### 4.3 `backup.sh`

```bash
#!/usr/bin/env bash
# backup.sh — Control Tower nightly backup (3-2-1)
set -euo pipefail
source /opt/controltower/.env

STAMP="$(date +%Y%m%d-%H%M)"
WORK="/backups/$STAMP"
mkdir -p "$WORK"

# 1) Postgres — todos os bancos (apps + forgejo)
docker exec postgres pg_dumpall -U postgres | gzip > "$WORK/postgres-all.sql.gz"

# 2) Forgejo — dump completo (repos + config + metadados de issues/PRs)
docker exec -u git forgejo forgejo dump \
  -c /data/gitea/conf/app.ini -f - > "$WORK/forgejo-dump.zip"

# 3) MinIO — espelha o object storage localmente
mc mirror --overwrite local/ "$WORK/minio/" >/dev/null

# 4) Empacota + CRIPTOGRAFA antes de sair do box
tar czf - -C /backups "$STAMP" \
  | age -r "$AGE_PUBLIC_KEY" > "/backups/$STAMP.tar.gz.age"
rm -rf "$WORK"

# 5) Offsite (Cloudflare R2 / B2 / Wasabi)
rclone copy "/backups/$STAMP.tar.gz.age" r2:fbr-backups/controltower/

# 6) Retenção local: 7 dias
find /backups -maxdepth 1 -name '*.tar.gz.age' -mtime +7 -delete
```

```bash
chmod +x backup.sh
```

### 4.4 Agendar

```bash
crontab -e
```
```cron
0 3 * * * /opt/controltower/backup.sh >> /var/log/ct-backup.log 2>&1
```

No destino offsite, configure uma **lifecycle rule** (ex.: apagar objetos com mais de 30–90 dias) pra não crescer sem controle.

**Camada extra (opcional, fecha o 3‑2‑1 de verdade):** puxar do R2 pro seu servidor local 1x/dia (`rclone copy r2:fbr-backups ~/backups-mirror`). Aí você tem: box + R2 + local.

---

## 5. Restore (TESTE ISSO — backup não testado não existe)

```bash
# 1) baixar do offsite
rclone copy r2:fbr-backups/controltower/AAAAMMDD-HHMM.tar.gz.age .

# 2) descriptografar (precisa da chave privada que você guardou fora do box)
age -d -i ct-backup-key.txt AAAAMMDD-HHMM.tar.gz.age | tar xzf -

# 3) Postgres
gunzip -c AAAAMMDD-HHMM/postgres-all.sql.gz | docker exec -i postgres psql -U postgres

# 4) Forgejo: descompacte o forgejo-dump.zip e siga o guia de restore
#    (restaura o diretório /data, o app.ini e importa o dump do banco)
```

Marca no calendário um **teste de restore trimestral** num container/VM descartável.

---

## 6. Segurança / firewall

```bash
ufw allow 22       # SSH do host
ufw allow 80       # HTTP/ACME — pertence ao Control Tower (edge)
ufw allow 443      # HTTPS — pertence ao Control Tower (subdomínios de projeto)
ufw allow 2222     # git over SSH (Forgejo)
ufw enable
```

- **A 443 é do Control Tower, não do Forgejo.** O Git chega via Cloudflare → porta dedicada `8443` (ou via Cloudflare Tunnel, sem abrir porta). **Não** exponha a 8443 pra internet aberta — restrinja aos [IPs do Cloudflare](https://www.cloudflare.com/ips/) ou use Tunnel.
- **Postgres (5432) e MinIO (9000) NÃO ficam expostos** — só na rede Docker interna. Confirme que não há `ports:` publicando eles em `0.0.0.0`.
- Forgejo com `DISABLE_REGISTRATION=true` e `REQUIRE_SIGNIN_VIEW=true` — instância privada.
- Backups são **código-fonte + dumps de banco**: nunca saem do box sem passar pelo `age`. A chave privada fica no seu gerenciador de senhas, **fora** da VPS.
- Se o provedor oferecer **snapshots agendados** do VPS, ligue — é uma rede de segurança grosseira além dos backups.

---

## Checklist de decisões (me confirma pra eu ajustar tudo)

- [ ] **Subdomínio** do Git: `git.fbr.news`? `git.facebrasil.com`? outro?
- [ ] **Destino offsite**: Cloudflare R2 (natural, já usa Cloudflare, sem egress), Backblaze B2, ou seu servidor local?
- [ ] **Seus repos têm clones locais?** Se muitos só existem no GitHub suspenso, a etapa 2 não cobre eles — precisamos de um plano de recuperação separado.
- [ ] Nome real da **rede Docker** e do container do Postgres/MinIO (pra bater os hostnames no compose).
- [ ] **Quem ocupa 80/443 no host hoje?** Rode `ss -ltnp | grep -E ':(80|443)'`. Se for o Caddy do Control Tower → Git vai via Cloudflare/8443 (§1.5). Se estiverem livres → o Caddy do Forgejo pode pegar 80/443 direto.
- [ ] **Roteamento do Git:** Cloudflare Origin Rule (`git.fbr.news` → origin port 8443) **ou** Cloudflare Tunnel? (Tunnel dispensa abrir porta no firewall.)
