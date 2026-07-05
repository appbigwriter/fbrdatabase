# TaskList — Control Tower · Finalização para Produção
> Gerada por Chain-of-Thought em 04/07/2026
> Sprint: control-tower-go-live
> Total de tarefas: 12

## Contexto do Projeto

Control Tower é o control plane self-hosted que substitui a camada SaaS do Supabase para os projetos mais simples da FBR (blogs, revistas), rodando dezenas de bancos Postgres independentes a partir de um único VPS (`76.13.168.223`), cada projeto com seu banco, sua auth (GoTrue), storage e rotas. O código já está ~80% pronto e bem arquitetado: metadata store (JSON dev / Postgres real), provisionamento com rollback, backups reais via `pg_dump`, importer do Supabase, tokens hasheados, MCP read-only e auth admin com cookie assinado.

Duas lacunas de fechamento de ciclo (publicação das rotas no Caddy durante o provisionamento + TLS por-subdomínio) já foram resolvidas em código e entregues no patch `control-tower-caddy-tls.patch` (11 testes verdes). Esta TaskList cobre o que falta para **ligar o server de verdade no VPS**: subir o patch, endurecer segredos, aplicar isolamento real reader/writer no Postgres, corrigir o runtime Docker via Engine API, popular métricas reais e fazer o bring-up + verificação end-to-end.

---

## MÓDULO A — Deploy do fix (Caddy publish + TLS)

### Raciocínio
> O patch já foi validado localmente (typecheck + 11 testes). Falta integrá-lo ao repositório e configurar as variáveis de TLS no ambiente do VPS. Sem o env de TLS ligado, o config gerado continua em HTTP puro, então esta etapa é pré-requisito da verificação HTTPS no Módulo F.

### Tarefas

#### TASK-01 · david · 🔴 Alta
**Ação:** Aplicar o patch `control-tower-caddy-tls.patch` no repositório `fbr-control-tower` em um branch novo (`fix/caddy-publish-tls`), rodar `npm run build:control-plane` e `npm test`, confirmar que os 11 testes passam sem falha, e abrir Pull Request.
**Contexto:** O patch pluga a publicação de rotas no Caddy ao final do provisionamento e adiciona emissão de TLS por-subdomínio — o elo que faltava entre "projeto criado no metadata" e "subdomínio no ar".
**Input esperado:** Repositório limpo na revisão que corresponde aos zips enviados; arquivo do patch.
**Output esperado:** Branch com o patch aplicado, build ok, 11 testes verdes, PR aberto.
**Critério de conclusão:** `npm test` reporta `# pass 11 / # fail 0` e o PR está criado.

#### TASK-02 · david · 🔴 Alta
**Ação:** Adicionar ao `.env` de produção do Control Tower no VPS `76.13.168.223` as três variáveis de TLS: `CONTROL_TOWER_CADDY_TLS_ENABLED=true`, `CONTROL_TOWER_CADDY_HTTPS_LISTEN_ADDRESS=:443` e `CONTROL_TOWER_CADDY_ACME_EMAIL=<email-operacional-fbr>`.
**Contexto:** Sem `TLS_ENABLED=true`, o config gerado pelo Caddy segue em HTTP na porta 80 e os subdomínios de projeto não recebem certificado.
**Input esperado:** Acesso ao `.env` de produção; um email válido para contato ACME/Let's Encrypt.
**Output esperado:** `.env` atualizado com as três chaves.
**Critério de conclusão:** As três variáveis existem no ambiente carregado pelo processo do Control Tower.

---

## MÓDULO B — Segurança pré-produção

### Raciocínio
> O código traz defaults de desenvolvimento perigosos: o segredo de sessão do admin cai para `"change-me-in-production"` se não configurado (permitindo forjar sessão de admin), e a stack usa `postgres/postgres`, `minioadmin` e senha fixa no GoTrue. Nada disso pode ir para um host exposto. Estas tarefas precedem a verificação do Módulo F.

### Tarefas

#### TASK-03 · david · 🔴 Alta
**Ação:** Gerar um valor aleatório forte de pelo menos 32 bytes (ex.: `openssl rand -base64 48`) e configurá-lo como `CONTROL_TOWER_ADMIN_SESSION_SECRET` no ambiente de produção, garantindo que nenhum fallback `change-me` seja usado.
**Contexto:** O cookie de sessão do admin é assinado com HMAC usando esse segredo; se ele for o default, qualquer pessoa consegue forjar uma sessão de administrador e assumir o painel.
**Input esperado:** Acesso ao ambiente de produção e a um gerenciador de segredos.
**Output esperado:** Segredo forte configurado; default removido.
**Critério de conclusão:** Login de admin funciona e o valor em produção não é `change-me-in-production`.

#### TASK-04 · david · 🔴 Alta
**Ação:** Substituir todas as credenciais default de desenvolvimento (`postgres/postgres` do Postgres, `minioadmin/minioadmin` do MinIO e a senha fixa `password` do DB do GoTrue) por segredos fortes no `docker-compose.real.yml` e no `.env` do VPS, e confirmar que Postgres (5432) e MinIO (9000) estão apenas na rede interna do Docker, sem portas publicadas em `0.0.0.0`.
**Contexto:** São credenciais de dev que não podem existir num host acessível; portas de banco/storage expostas seriam vetor de acesso direto.
**Input esperado:** Arquivos `docker-compose.real.yml` e `.env` do VPS.
**Output esperado:** Credenciais rotacionadas e binds de rede revisados.
**Critério de conclusão:** `docker ps` não mostra 5432/9000 publicados externamente e a stack sobe com as novas senhas.

#### TASK-05 · maria · 🟡 Normal
**Ação:** Escrever um runbook de compliance de segredos do Control Tower listando cada segredo do sistema (session secret, senhas de Postgres/MinIO/GoTrue, chaves JWT por projeto, token Cloudflare), onde cada um é armazenado, política de rotação e quem tem acesso.
**Contexto:** O sistema passa a guardar material sensível de múltiplos projetos; sem um mapa de segredos e política de rotação, a operação vira risco silencioso.
**Input esperado:** Lista de segredos usados (extraível do `_env.example` e do `docker-compose.real.yml`).
**Output esperado:** Documento markdown de política de segredos.
**Critério de conclusão:** O runbook cobre todos os segredos citados, com local, dono e cadência de rotação.

---

## MÓDULO C — Isolamento real reader/writer no Postgres

### Raciocínio
> Hoje `createRoles` cria os roles `<slug>_writer` e `<slug>_reader` com `LOGIN` mas sem senha e sem GRANTs, e a connection string dos projetos usa `postgres:postgres`. Ou seja, a separação read/write só existe no metadata, não no banco. Para o reader ser de fato somente-leitura, faltam senha e privilégios reais.

### Tarefas

#### TASK-06 · david · 🔴 Alta
**Ação:** Estender `RealDatabaseRuntime.createRoles` (em `packages/control-tower/src/postgres.ts`) para (a) atribuir senha forte a cada role writer/reader, (b) aplicar GRANTs reais — writer com privilégios de escrita e reader restrito a `SELECT` — nos schemas `public` e `auth`, incluindo `ALTER DEFAULT PRIVILEGES` para tabelas futuras, e (c) ajustar o template `CONTROL_TOWER_PROJECT_DATABASE_URL_TEMPLATE` para conectar com o role apropriado em vez de `postgres:postgres`. Adicionar teste que verifique que o reader não consegue `INSERT`.
**Contexto:** Sem GRANTs diferenciados, um token "read-only" ainda escreveria no banco pela connection de superusuário — o isolamento prometido não é real.
**Input esperado:** `postgres.ts`, `config.ts` e o `_env.example`.
**Output esperado:** Roles com senha e privilégios corretos; connection template por role; teste de negação de escrita.
**Critério de conclusão:** Um projeto provisionado tem reader que falha ao tentar `INSERT` e writer que consegue; teste novo verde.

---

## MÓDULO D — Correção do runtime Docker (Engine API)

### Raciocínio
> Existem dois caminhos de provisionamento de auth: via Docker CLI (que já anexa `--network`) e via Docker Engine API (`RealAuthRuntime`), que **não** anexa o container à rede. Pela Engine API, o GoTrue sobe fora da `control-tower-net`, então o upstream `http://gotrue-<slug>:9999` não resolve pelo proxy. Precisa anexar a rede explicitamente.

### Tarefas

#### TASK-07 · david · 🟡 Normal
**Ação:** Corrigir `RealAuthRuntime.createInstance` (em `packages/control-tower/src/docker.ts`) para anexar o container GoTrue à rede definida em `CONTROL_TOWER_DOCKER_NETWORK_NAME`, via `HostConfig.NetworkMode` (ou `NetworkingConfig.EndpointsConfig`), de modo que o nome DNS `gotrue-<slug>` seja resolvível pelo proxy. Adicionar teste ou verificação que confirme o container na rede correta.
**Contexto:** No caminho Engine API, o container fica isolado e o roteamento por nome de serviço quebra; o caminho CLI já faz isso corretamente.
**Input esperado:** `docker.ts` e a `DockerRuntimeConfig`.
**Output esperado:** Container GoTrue conectado à `control-tower-net` quando provisionado via Engine API.
**Critério de conclusão:** `docker inspect` do container mostra a rede `control-tower-net`; o upstream resolve.

---

## MÓDULO E — Métricas reais do dashboard

### Raciocínio
> `buildDashboard` retorna `userCount: 0` e `diskUsageGb: 0` fixos. O painel funciona mas não informa uso real. É melhoria de baixa prioridade (não bloqueia o go-live), mas fecha a experiência do operador.

### Tarefas

#### TASK-08 · david · 🟢 Baixa
**Ação:** Substituir os placeholders `userCount: 0` e `diskUsageGb: 0` em `buildDashboard` (`packages/control-tower/src/services.ts`) por valores reais: `userCount` via `COUNT(*)` na tabela `auth.users` do banco de cada projeto e `diskUsageGb` via `pg_database_size` do banco do projeto, convertido para GB.
**Contexto:** Métricas zeradas escondem crescimento e problemas de capacidade; o operador precisa ver uso real por projeto.
**Input esperado:** `services.ts` e acesso de leitura aos bancos dos projetos.
**Output esperado:** Dashboard exibindo contagem de usuários e uso de disco reais por projeto.
**Critério de conclusão:** Um projeto com N usuários mostra `userCount = N` e um `diskUsageGb` > 0 coerente.

---

## MÓDULO F — Bring-up e verificação end-to-end no `76.13.168.223`

### Raciocínio
> Com o patch aplicado, segredos endurecidos e isolamento corrigido, esta é a etapa de prova: subir a stack real, provisionar um projeto de teste e confirmar que o subdomínio responde por HTTPS com auth funcionando. É o gate que declara o server "finalizado".

### Tarefas

#### TASK-09 · erick · 🔴 Alta
**Ação:** No VPS `76.13.168.223`, aplicar a schema de metadados (`packages/control-tower/sql/001_control_plane.sql`) no banco `control_tower_meta` e subir a stack real com `docker compose -f docker-compose.real.yml up -d`, confirmando que os quatro serviços (postgres, caddy, minio-hot, minio-cold) sobem saudáveis.
**Contexto:** A stack real é a base sobre a qual o control plane provisiona projetos; a schema de metadados é o estado do sistema.
**Input esperado:** Patch aplicado (TASK-01), env configurado (TASK-02, TASK-03, TASK-04).
**Output esperado:** Stack real no ar com a schema de metadados aplicada.
**Critério de conclusão:** `docker compose ps` mostra os quatro serviços `healthy`/`running` e as tabelas de metadados existem em `control_tower_meta`.

#### TASK-10 · erick · 🔴 Alta
**Ação:** Rodar `npm run smoke:real` no VPS e, em seguida, provisionar um projeto de teste via API/CLI; confirmar no banco de metadados que a rota foi registrada e que o `audit_logs` contém um registro `action=route.publish` com `phase=completed`.
**Contexto:** Valida que o provisionamento agora publica a rota no Caddy automaticamente (o comportamento novo do patch).
**Input esperado:** TASK-09 concluída.
**Output esperado:** Projeto de teste provisionado com rota publicada e auditada.
**Critério de conclusão:** Existe uma linha em `audit_logs` com `route.publish` / `completed` para o projeto de teste.

#### TASK-11 · erick · 🔴 Alta
**Ação:** Verificar que o subdomínio do projeto de teste responde por HTTPS executando `curl -I https://<subdomain-do-teste>` e confirmando certificado válido emitido pelo Caddy; validar também que o endpoint de auth do projeto responde (ex.: `GET /auth/health` ou equivalente do GoTrue).
**Contexto:** Prova final de que o ciclo criar-projeto → subdomínio-no-ar-com-HTTPS funciona ponta a ponta.
**Input esperado:** TASK-10 concluída; DNS do subdomínio de teste apontando para o VPS.
**Output esperado:** Resposta HTTPS 200/301 com cert válido e auth do projeto acessível.
**Critério de conclusão:** `curl -I` retorna cabeçalhos por HTTPS sem erro de certificado e o auth do projeto responde.

#### TASK-12 · david · 🟡 Normal
**Ação:** Revogar o token Cloudflare que ficou exposto durante a Fase 0 e emitir um novo; se houver intenção de usar wildcard TLS futuramente, validar o DNS challenge do Caddy com o novo formato de token (`cfut_`), caso contrário manter a estratégia per-subdomain (já suportada pelo patch).
**Contexto:** Fecha as pendências soltas da Fase 0; o token exposto é risco de segurança e a decisão de wildcard vs per-subdomain precisa ser registrada.
**Input esperado:** Acesso ao painel Cloudflare da zona `fbr.news`.
**Output esperado:** Token antigo revogado, novo token em uso, decisão de TLS registrada.
**Critério de conclusão:** Token antigo inativo; emissão de certificado funcionando pela estratégia escolhida.

---

## Mapa de Dependências

- TASK-01 → pré-requisito de TASK-09, TASK-10, TASK-11
- TASK-02, TASK-03, TASK-04 → pré-requisitos de TASK-09 (não expor sem segredos)
- TASK-06 (isolamento) e TASK-07 (network) → independentes entre si; recomendável antes de TASK-11 para a verificação refletir o estado final
- TASK-09 → TASK-10 → TASK-11 (sequência estrita de verificação)
- TASK-05, TASK-08, TASK-12 → paralelizáveis, não bloqueiam o go-live

## Ordem de Execução Sugerida

1. **Bloco código (paralelo):** TASK-01, TASK-06, TASK-07
2. **Bloco segredos (paralelo):** TASK-03, TASK-04 → depois TASK-02
3. **Bring-up:** TASK-09 → TASK-10 → TASK-11
4. **Fechamento:** TASK-12, TASK-05, TASK-08

---

## Payload JSON — Sprint API

```json
{
  "sprintName": "control-tower-go-live",
  "context": "Finalizar o control plane self-hosted Control Tower no VPS 76.13.168.223. O código está ~80% pronto; o patch de publicação de rotas no Caddy + TLS por-subdomínio já foi validado (11 testes verdes). Falta subir o patch, endurecer segredos, aplicar isolamento real reader/writer no Postgres, corrigir o runtime Docker via Engine API, popular métricas reais e fazer o bring-up + verificação end-to-end com HTTPS.",
  "tasks": [
    {
      "agent": "david",
      "action": "Aplicar o patch control-tower-caddy-tls.patch no repositório fbr-control-tower em um branch novo (fix/caddy-publish-tls), rodar npm run build:control-plane e npm test, confirmar que os 11 testes passam sem falha, e abrir Pull Request.",
      "priority": "high",
      "due_date": "2026-07-07"
    },
    {
      "agent": "david",
      "action": "Adicionar ao .env de producao do Control Tower no VPS 76.13.168.223 as tres variaveis de TLS: CONTROL_TOWER_CADDY_TLS_ENABLED=true, CONTROL_TOWER_CADDY_HTTPS_LISTEN_ADDRESS=:443 e CONTROL_TOWER_CADDY_ACME_EMAIL=<email-operacional-fbr>.",
      "priority": "high",
      "due_date": "2026-07-08"
    },
    {
      "agent": "david",
      "action": "Gerar um valor aleatorio forte de pelo menos 32 bytes (ex.: openssl rand -base64 48) e configura-lo como CONTROL_TOWER_ADMIN_SESSION_SECRET no ambiente de producao, garantindo que nenhum fallback change-me seja usado.",
      "priority": "high",
      "due_date": "2026-07-07"
    },
    {
      "agent": "david",
      "action": "Substituir todas as credenciais default de desenvolvimento (postgres/postgres do Postgres, minioadmin/minioadmin do MinIO e a senha fixa password do DB do GoTrue) por segredos fortes no docker-compose.real.yml e no .env do VPS, e confirmar que Postgres 5432 e MinIO 9000 estao apenas na rede interna do Docker, sem portas publicadas em 0.0.0.0.",
      "priority": "high",
      "due_date": "2026-07-08"
    },
    {
      "agent": "maria",
      "action": "Escrever um runbook de compliance de segredos do Control Tower listando cada segredo do sistema (session secret, senhas de Postgres/MinIO/GoTrue, chaves JWT por projeto, token Cloudflare), onde cada um e armazenado, politica de rotacao e quem tem acesso.",
      "priority": "normal",
      "due_date": "2026-07-14"
    },
    {
      "agent": "david",
      "action": "Estender RealDatabaseRuntime.createRoles (em packages/control-tower/src/postgres.ts) para atribuir senha forte a cada role writer/reader, aplicar GRANTs reais (writer com escrita e reader restrito a SELECT nos schemas public e auth, incluindo ALTER DEFAULT PRIVILEGES) e ajustar o template CONTROL_TOWER_PROJECT_DATABASE_URL_TEMPLATE para conectar com o role apropriado em vez de postgres:postgres. Adicionar teste que verifique que o reader nao consegue INSERT.",
      "priority": "high",
      "due_date": "2026-07-10"
    },
    {
      "agent": "david",
      "action": "Corrigir RealAuthRuntime.createInstance (em packages/control-tower/src/docker.ts) para anexar o container GoTrue a rede definida em CONTROL_TOWER_DOCKER_NETWORK_NAME, via HostConfig.NetworkMode ou NetworkingConfig.EndpointsConfig, de modo que o nome DNS gotrue-<slug> seja resolvivel pelo proxy. Adicionar teste ou verificacao que confirme o container na rede correta.",
      "priority": "normal",
      "due_date": "2026-07-11"
    },
    {
      "agent": "david",
      "action": "Substituir os placeholders userCount:0 e diskUsageGb:0 em buildDashboard (packages/control-tower/src/services.ts) por valores reais: userCount via COUNT na tabela auth.users do banco de cada projeto e diskUsageGb via pg_database_size do banco do projeto, convertido para GB.",
      "priority": "low",
      "due_date": "2026-07-18"
    },
    {
      "agent": "erick",
      "action": "No VPS 76.13.168.223, aplicar a schema de metadados (packages/control-tower/sql/001_control_plane.sql) no banco control_tower_meta e subir a stack real com docker compose -f docker-compose.real.yml up -d, confirmando que os quatro servicos (postgres, caddy, minio-hot, minio-cold) sobem saudaveis.",
      "priority": "high",
      "due_date": "2026-07-11"
    },
    {
      "agent": "erick",
      "action": "Rodar npm run smoke:real no VPS e provisionar um projeto de teste via API/CLI; confirmar no banco de metadados que a rota foi registrada e que o audit_logs contem um registro action=route.publish com phase=completed.",
      "priority": "high",
      "due_date": "2026-07-12"
    },
    {
      "agent": "erick",
      "action": "Verificar que o subdominio do projeto de teste responde por HTTPS executando curl -I https://<subdomain-do-teste> e confirmando certificado valido emitido pelo Caddy; validar tambem que o endpoint de auth do projeto responde.",
      "priority": "high",
      "due_date": "2026-07-12"
    },
    {
      "agent": "david",
      "action": "Revogar o token Cloudflare que ficou exposto durante a Fase 0 e emitir um novo; se houver intencao de usar wildcard TLS futuramente, validar o DNS challenge do Caddy com o novo formato de token cfut_, caso contrario manter a estrategia per-subdomain ja suportada pelo patch.",
      "priority": "normal",
      "due_date": "2026-07-14"
    }
  ]
}
```
