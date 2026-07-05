# TaskList Final - Control Tower em Producao

Host alvo: `76.13.168.223`
Painel: `control-tower.fbr.news`
Email ACME: `sergio@facebrasil.com`
Rede Docker real: `plataforma_backend`

## Estado ja confirmado

- `80/443` pertencem ao container `caddy`
- Postgres compartilhado: `super_postgres`
- MinIO compartilhado: `minio`
- `5432` e `9000` nao estao expostos publicamente
- `oem` tem acesso Docker
- `control-tower.fbr.news` aponta para `76.13.168.223`
- wildcard DNS criado: `*.control-tower.fbr.news -> 76.13.168.223`
- patch local validado: `npm test = 13 pass / 0 fail`

## Decisoes de deploy

- Reutilizar o `caddy` existente
- Usar `plataforma_backend`
- Nao subir outro Caddy na `443`
- Rodar o app do Control Tower em container proprio
- Fazer o painel publicar rotas no Caddy via admin API

## Tarefas finais

### T1. Ajustar o Caddy existente para admin API interna

- Editar `/home/deploy/fase0/caddy/Caddyfile`
- Adicionar bloco global:

```caddy
{
	admin 0.0.0.0:2019
}
```

- Manter o resto temporariamente valido para o primeiro boot
- Editar `/home/deploy/fase0/docker-compose.yml`
- No servico `caddy`, adicionar:

```yaml
ports:
  - "80:80"
  - "443:443"
  - "127.0.0.1:2019:2019"
extra_hosts:
  - "host.docker.internal:host-gateway"
```

- Recriar so o `caddy`
- Validar:

```bash
docker exec caddy wget -qO- http://127.0.0.1:2019/config/
curl http://127.0.0.1:2019/config/
```

Gate:
- admin API responde no host e no container

### T2. Copiar o repo final para o VPS

- Diretório sugerido: `/home/oem/fbr-control-tower`
- Levar codigo sem `.git`, `node_modules`, `.next`, `dist`, `.data`
- Garantir que o repo remoto contenha:
  - patch Caddy/TLS
  - ajuste do painel no Caddy
  - template configuravel de subdominio
  - `Dockerfile.control-tower`

Gate:
- `package.json` existe no VPS

### T3. Criar `.env` real do Control Tower

Arquivo: `/home/oem/fbr-control-tower/.env`

Valores essenciais:

```env
NODE_ENV=production
CONTROL_TOWER_MODE=real

CONTROL_TOWER_METADATA_DATABASE_URL=postgres://admin:<PG_SUPERPASS>@postgres:5432/control_tower_meta
CONTROL_TOWER_SUPER_POSTGRES_URL=postgres://admin:<PG_SUPERPASS>@postgres:5432/postgres
CONTROL_TOWER_PROJECT_DATABASE_URL_TEMPLATE=postgres://{roleName}:{rolePassword}@postgres:5432/{databaseName}
CONTROL_TOWER_PROJECT_DB_HOST=postgres://postgres:5432

CONTROL_TOWER_DOCKER_SOCKET_PATH=/var/run/docker.sock
CONTROL_TOWER_DOCKER_NETWORK_NAME=plataforma_backend

CONTROL_TOWER_GOTRUE_IMAGE=supabase/auth:v2.192.0
CONTROL_TOWER_GOTRUE_DB_URL_TEMPLATE=postgres://admin:<PG_SUPERPASS>@postgres:5432/{databaseName}?sslmode=disable
CONTROL_TOWER_GOTRUE_SITE_URL_TEMPLATE=https://{subdomain}
CONTROL_TOWER_GOTRUE_EXTERNAL_URL_TEMPLATE=https://{subdomain}/auth
CONTROL_TOWER_GOTRUE_URI_ALLOW_LIST=https://*.fbr.news,https://*.control-tower.fbr.news

CONTROL_TOWER_CADDY_ADMIN_ORIGIN=http://caddy:2019
CONTROL_TOWER_CADDY_LISTEN_ADDRESS=:80
CONTROL_TOWER_CADDY_TLS_ENABLED=true
CONTROL_TOWER_CADDY_HTTPS_LISTEN_ADDRESS=:443
CONTROL_TOWER_CADDY_ACME_EMAIL=sergio@facebrasil.com
CONTROL_TOWER_CADDY_PANEL_DOMAIN=control-tower.fbr.news
CONTROL_TOWER_CADDY_PANEL_UPSTREAM=http://control-tower-app:3000

CONTROL_TOWER_ADMIN_ALLOWED_EMAILS=sergio@facebrasil.com
CONTROL_TOWER_ADMIN_SESSION_SECRET=<forte>
CONTROL_TOWER_ADMIN_BOOTSTRAP_EMAIL=sergio@facebrasil.com
CONTROL_TOWER_ADMIN_BOOTSTRAP_PASSWORD=<forte>

NEXT_PUBLIC_CONTROL_TOWER_PROJECT_SUBDOMAIN_TEMPLATE={slug}.control-tower.fbr.news
NEXT_PUBLIC_CONTROL_TOWER_PROJECT_IMPORT_SUBDOMAIN_TEMPLATE={slug}-import.control-tower.fbr.news
```

Gerar segredos fortes reais:

```bash
openssl rand -base64 48
```

Gate:
- nada com `change-me`
- nada com `postgres/postgres`
- nada com `minioadmin/minioadmin`

### T4. Aplicar schema no Postgres real

Criar DB se necessario:

```bash
docker exec -it super_postgres psql -U admin -c "CREATE DATABASE control_tower_meta;"
```

Aplicar schema:

```bash
docker exec -i super_postgres psql -U admin -d control_tower_meta < packages/control-tower/sql/001_control_plane.sql
```

Gate:
- tabelas `projects`, `routes`, `audit_logs` existem

### T5. Subir o app em container proprio

Criar um `docker-compose.real.yml` remoto simplificado, so para o app:

```yaml
services:
  control-tower-app:
    build:
      context: .
      dockerfile: Dockerfile.control-tower
    container_name: control-tower-app
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      - ./.data:/app/.data
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - plataforma_backend

networks:
  plataforma_backend:
    external: true
```

Subir:

```bash
docker compose -f docker-compose.real.yml up -d --build
```

Gate:
- `control-tower-app` em `running`

### T6. Validar o painel

- publicar rota do painel no Caddy
- acessar:

```bash
curl -I https://control-tower.fbr.news
```

Gate:
- responde por HTTPS
- tela de login sobe

### T7. Rodar smoke real

Dentro do repo no VPS:

```bash
npm run smoke:real
```

Se o smoke depender de hostnames antigos, ajustar para `*.control-tower.fbr.news`

Gate:
- smoke sem erro fatal

### T8. Provisionar projeto de teste

Criar projeto pelo painel ou API com slug de teste, exemplo:

- slug: `ct-smoke`
- subdominio: `ct-smoke.control-tower.fbr.news`

Gate:
- projeto criado
- DB criado
- container `gotrue-ct-smoke` criado
- rota registrada

### T9. Provar publish no audit log

Consultar `control_tower_meta.audit_logs`

Gate:
- existe linha com:
  - `action = route.publish`
  - `phase = completed`

### T10. Provar HTTPS do subdominio

```bash
curl -I https://ct-smoke.control-tower.fbr.news
```

Gate:
- resposta HTTPS valida
- sem erro de certificado

### T11. Provar auth do projeto

Exemplos:

```bash
curl -i https://ct-smoke.control-tower.fbr.news/auth/health
curl -i https://ct-smoke.control-tower.fbr.news/health
```

Gate:
- GoTrue responde

## Saida final esperada

- `npm test`: `13 pass / 0 fail`
- `control-tower.fbr.news` servindo HTTPS
- projeto de teste provisionado
- `route.publish = completed`
- `curl -I https://ct-smoke.control-tower.fbr.news` com HTTPS valido
- auth do projeto respondendo
- Postgres e MinIO continuam privados em `127.0.0.1`

## Bloqueios restantes

- abrir admin API do Caddy para a rede interna
- subir o container `control-tower-app`
- aplicar schema e smoke no VPS
