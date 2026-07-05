# Stories — Control Tower

## Objetivo

Desmembrar o PRD do Control Tower em stories executaveis que, em conjunto, entreguem exatamente o sistema descrito: um painel unico para provisionar, operar, monitorar e migrar projetos Postgres isolados, com control plane stateless baseado em banco de metadados.

## Regras de decomposicao

- Cada story tem resultado verificavel e criterio de done binario.
- A ordem respeita as dependencias explicitas no PRD e no report.
- O escopo nao inclui itens marcados como nao-objetivo na v1: edge functions, login social, multi-maquina e billing.
- Fase 0 ja esta pronta; as stories abaixo comecam do ponto atual.

## Restricoes que precisam valer no sistema inteiro

- Isolamento entre projetos obrigatorio.
- Provisionamento atomico com rollback completo obrigatorio.
- Postgres nao pode ser exposto publicamente.
- Secrets nao podem ficar soltos em `.env` de aplicacao.
- MCP deve ser read-only por padrao.
- O control plane deve ser stateless fora do banco de metadados.
- Toda operacao critica precisa gerar log estruturado.

## Sequencia macro

1. Enablers operacionais
2. Fase 1: control plane e provisionamento
3. Fase 2: roteamento dinamico e prova de isolamento
4. Fase 3: importador Supabase
5. Fase 4: painel completo
6. Fase 5: storage, MCP e endurecimento

## Enablers operacionais

### CT-001 — Automatizar backup do super Postgres e provar restore

**Como** admin
**Quero** backups agendados do servidor de dados com restore testado
**Para** iniciar a Fase 1 sem risco operacional basico

**Escopo**
- Agendar `pg_dump` do super Postgres
- Definir politica de retencao inicial
- Executar restore de teste documentado
- Registrar status do ultimo backup em algum artefato operacional

**Dependencias**
- Fase 0 pronta

**Done**
- Existe rotina automatizada de backup em execucao
- Existe evidenca de restore bem-sucedido em ambiente de teste
- A politica de retencao esta documentada

### CT-002 — Definir estrategia de emissao TLS para subdominios por projeto

**Como** admin
**Quero** uma estrategia viavel para servir subdominios dinamicos por projeto
**Para** habilitar o roteamento do painel sem depender de suposicoes de infra

**Escopo**
- Resolver o bloqueio atual do wildcard `*.fbr.news` com Cloudflare/Caddy
- Ou formalizar alternativa viavel por subdominio com emissao individual de certificado
- Documentar a escolha e os limites operacionais

**Dependencias**
- Fase 0 pronta

**Done**
- Existe decisao implementavel para TLS dos subdominios
- A decisao foi validada tecnicamente no ambiente atual

## Fase 1 — Control plane e provisionamento

### CT-003 — Criar schema do banco de metadados

**Como** control plane
**Quero** persistir projetos, databases, auth instances, tokens, buckets e rotas
**Para** ter uma fonte unica de verdade sobre a plataforma

**Escopo**
- Tabelas: `projects`, `databases`, `auth_instances`, `tokens`, `buckets`, `routes`
- Campos minimos do PRD
- Chaves, unicidade e integridade referencial
- Estados minimos de provisionamento e desprovisionamento

**Dependencias**
- CT-001

**Done**
- O schema existe em migracao versionada
- As entidades do PRD podem ser persistidas sem campos obrigatorios faltantes
- Relacoes entre projeto e recursos estao protegidas por constraints

### CT-004 — Registrar auditoria estruturada de operacoes do control plane

**Como** admin
**Quero** trilha estruturada das operacoes criticas
**Para** observar provisionamento, rollback e falhas com evidencias

**Escopo**
- Logs estruturados para provisionar, desprovisionar, emitir token, importar e backup
- Correlacao por projeto e por execucao
- Registro de etapa iniciada, concluida e falha

**Dependencias**
- CT-003

**Done**
- Operacoes criticas geram logs estruturados com correlacao
- Falhas mostram claramente em qual etapa ocorreram

### CT-005 — Implementar criacao de database por projeto

**Como** admin
**Quero** que um novo projeto ganhe seu proprio database
**Para** garantir isolamento no data plane

**Escopo**
- Criar database unico por projeto no super Postgres
- Persistir os dados da instancia em `databases`
- Validar naming seguro de projeto, slug e database

**Dependencias**
- CT-003
- CT-004

**Done**
- Uma chamada do control plane cria o database do projeto
- O database fica registrado no banco de metadados
- Nomes conflitantes ou invalidos sao rejeitados

### CT-006 — Criar roles writer e reader por projeto

**Como** control plane
**Quero** gerar roles dedicadas por projeto
**Para** separar acessos basicos de escrita e leitura

**Escopo**
- Criar roles `writer` e `reader` vinculadas ao projeto
- Persistir mapeamento no banco de metadados
- Garantir que roles de um projeto nao acessem outro projeto

**Dependencias**
- CT-005

**Done**
- Cada novo projeto recebe roles `writer` e `reader`
- As roles ficam registradas no metadados
- Teste de isolamento entre databases e roles passa

### CT-007 — Subir instancia GoTrue dedicada por projeto

**Como** admin
**Quero** que cada projeto tenha sua propria auth
**Para** manter usuarios e sessoes isolados entre projetos

**Escopo**
- Subir container `supabase/auth` via Docker API
- Configurar a instancia apontando para o database do projeto
- Gerar e persistir chaves JWT assimetricas
- Persistir detalhes em `auth_instances`

**Dependencias**
- CT-005
- CT-006

**Done**
- Um projeto provisionado ganha uma instancia GoTrue funcional
- As chaves JWT do projeto foram geradas e armazenadas com seguranca
- A instancia ficou registrada no metadados

### CT-008 — Registrar rota do projeto no plano de controle

**Como** control plane
**Quero** registrar a rota de cada projeto
**Para** permitir que o proxy descubra o destino correto

**Escopo**
- Persistir subdominio e alvos do projeto em `routes`
- Impedir colisao de subdominios
- Preparar o contrato de leitura para o roteador

**Dependencias**
- CT-003
- CT-002

**Done**
- Cada projeto provisionado possui rota persistida
- Nao existem subdominios duplicados no metadados

### CT-009 — Emitir tokens iniciais `service`, `anon` e `mcp`

**Como** admin
**Quero** que cada projeto ja nasca com os tokens iniciais
**Para** viabilizar consumo pelo CMS e acessos controlados

**Escopo**
- Emitir 3 escopos iniciais: `service`, `anon`, `mcp`
- Armazenar hash, expiracao, escopo e status de revogacao
- Garantir `mcp` com postura read-only por padrao

**Dependencias**
- CT-007
- CT-003

**Done**
- Projeto novo recebe os tres tokens iniciais
- Os tokens ficam persistidos sem armazenar segredo em texto puro
- O token `mcp` nasce marcado para acesso read-only

### CT-010 — Orquestrar provisionamento atomico com rollback completo

**Como** admin
**Quero** criar um projeto em uma unica acao
**Para** nao depender de terminal nem correr risco de stack parcial

**Escopo**
- Encadear database, roles, GoTrue, rota e tokens
- Implementar rollback completo se qualquer etapa falhar
- Persistir status final do projeto

**Dependencias**
- CT-005
- CT-006
- CT-007
- CT-008
- CT-009

**Done**
- Uma unica chamada provisiona o projeto inteiro
- Qualquer falha intermediaria remove os recursos ja criados
- O estado final no metadados fica consistente apos sucesso ou falha

### CT-011 — Validar o criterio de aceite de provisionamento da F1

**Como** admin
**Quero** provar que um projeto criado funciona sem terminal
**Para** encerrar a Fase 1 com evidencia

**Escopo**
- Criar projeto pelo fluxo principal
- Registrar usuario no projeto criado
- Efetuar login real no projeto criado

**Dependencias**
- CT-010

**Done**
- Existe evidencia de que 1 acao cria o projeto
- Existe evidencia de cadastro e login real no projeto provisionado

### CT-012 — Implementar desprovisionamento com confirmacao e limpeza completa

**Como** admin
**Quero** remover um projeto com seguranca
**Para** desfazer ambientes sem lixo operacional

**Escopo**
- Remover rota, GoTrue, tokens, metadados e database do projeto
- Exigir confirmacao explicita
- Registrar auditoria da operacao

**Dependencias**
- CT-010

**Done**
- O fluxo remove todos os recursos ligados ao projeto
- A operacao exige confirmacao explicita
- O projeto nao fica parcialmente removido

## Fase 2 — Roteamento dinamico e prova de isolamento

### CT-013 — Expor configuracao dinamica de rotas para o proxy

**Como** proxy de plataforma
**Quero** consultar o control plane para descobrir os destinos dos projetos
**Para** rotear requests por subdominio

**Escopo**
- Fornecer contrato de leitura das rotas por projeto
- Entregar alvos de DB e auth conforme o metadados
- Garantir consistencia com o estado do projeto

**Dependencias**
- CT-008

**Done**
- O proxy consegue obter rotas de projetos ativos via control plane
- Projetos inativos ou removidos nao aparecem como rotas validas

### CT-014 — Configurar Caddy para rotear por projeto usando o control plane

**Como** admin
**Quero** que cada subdominio chegue ao projeto correto
**Para** operar varios projetos como uma plataforma unica

**Escopo**
- Integrar Caddy ao mecanismo de descoberta definido na CT-013
- Garantir encaminhamento para os alvos corretos por subdominio
- Considerar a estrategia TLS definida na CT-002

**Dependencias**
- CT-002
- CT-013

**Done**
- Dois projetos distintos respondem em subdominios distintos
- O proxy encaminha cada request ao destino correto

### CT-015 — Comprovar isolamento de usuarios entre projetos

**Como** plataforma
**Quero** impedir autenticacao cruzada
**Para** cumprir o requisito nao-funcional central de isolamento

**Escopo**
- Teste negativo: usuario de um projeto nao autentica em outro
- Validacao com duas instancias reais de projeto

**Dependencias**
- CT-014
- CT-007

**Done**
- Existe evidencia automatizada ou reproduzivel de falha na autenticacao cruzada

### CT-016 — Aplicar cache de leitura para conteudo publico

**Como** plataforma
**Quero** cachear leituras publicas
**Para** suportar carga read-heavy de blogs e revistas

**Escopo**
- Definir camada de cache para conteudo publico
- Garantir que o cache nao viole isolamento entre projetos

**Dependencias**
- CT-014

**Done**
- Leituras publicas passam por cache
- O cache respeita separacao por projeto

## Fase 3 — Importador Supabase

### CT-017 — Criar fluxo de entrada do importador

**Como** admin
**Quero** informar connection string e token da origem
**Para** iniciar uma migracao a partir do Supabase

**Escopo**
- Receber credenciais da origem
- Validar conectividade minima antes da migracao
- Disparar criacao do projeto destino

**Dependencias**
- CT-010

**Done**
- O importador aceita os dados de origem e inicia uma migracao valida

### CT-018 — Importar schemas `public` e `auth` via dump e restore

**Como** admin
**Quero** trazer dados e auth juntos
**Para** preservar aplicacao e login dos usuarios

**Escopo**
- Executar dump de `public` e `auth`
- Restaurar no projeto destino criado pelo control plane

**Dependencias**
- CT-017

**Done**
- Os schemas `public` e `auth` foram migrados para o destino

### CT-019 — Recriar roles minimas compativeis com Supabase

**Como** plataforma
**Quero** restaurar a estrutura minima de roles do Supabase
**Para** evitar quebra silenciosa de policies e acessos

**Escopo**
- Recriar `authenticated`, `anon` e `service_role`
- Ajustar o destino para manter compatibilidade basica com RLS e auth

**Dependencias**
- CT-018

**Done**
- As roles minimas existem no destino apos a importacao

### CT-020 — Validar login real no projeto migrado com senha antiga

**Como** admin
**Quero** provar que hashes bcrypt foram preservados
**Para** encerrar a migracao com evidencia forte

**Escopo**
- Testar autenticacao de usuario migrado com senha antiga
- Registrar evidencia do resultado

**Dependencias**
- CT-018
- CT-019

**Done**
- Pelo menos um usuario migrado autentica com a senha antiga no destino

### CT-021 — Gerar relatorio de migracao com pendencias manuais

**Como** admin
**Quero** saber o que entrou e o que ficou de fora
**Para** operar o escopo enxuto do importador com transparencia

**Escopo**
- Informar recursos importados
- Informar itens fora de escopo: edge functions, login social e secrets automaticos
- Sinalizar qualquer ajuste manual necessario

**Dependencias**
- CT-020

**Done**
- Cada importacao gera relatorio de resultado e lacunas

## Fase 4 — Painel Next.js completo

### CT-022 — Implementar autenticacao forte do painel admin

**Como** admin
**Quero** entrar no painel com auth dedicada
**Para** substituir o acesso basico atual por auth apropriada na v1

**Escopo**
- GoTrue dedicado de admin
- Emails configuraveis para manutencao de conta
- Restricao de acesso aos administradores definidos

**Dependencias**
- CT-007

**Done**
- O painel so permite acesso aos admins autorizados
- A manutencao de conta usa emails configuraveis

### CT-023 — Construir dashboard de projetos

**Como** admin
**Quero** ver todos os projetos em uma tela
**Para** acompanhar estado, usuarios e uso sem terminal

**Escopo**
- Lista de projetos
- Status verde/vermelho
- Database associado
- Numero de usuarios
- Uso de disco
- Acao de criar e remover projeto

**Dependencias**
- CT-011
- CT-012
- CT-022

**Done**
- O dashboard mostra todos os campos exigidos pelo PRD
- As acoes principais de criar e remover projeto estao disponiveis

### CT-024 — Exibir detalhe do projeto com navegacao por ferramentas

**Como** admin
**Quero** abrir um projeto e navegar por suas operacoes
**Para** operar o ciclo completo sem sair do painel

**Escopo**
- Tela de detalhe por projeto
- Tabs: Visao, SQL, Tabelas, Tokens, Buckets, Auth/Emails, Backups

**Dependencias**
- CT-023

**Done**
- Ao clicar em um projeto, o detalhe abre com as tabs previstas

### CT-025 — Entregar editor SQL com historico e aviso destrutivo

**Como** admin
**Quero** executar SQL no projeto selecionado
**Para** operar e investigar dados pelo painel

**Escopo**
- Editor Monaco ou CodeMirror
- Execucao no DB do projeto selecionado
- Historico de queries
- Aviso em comandos destrutivos

**Dependencias**
- CT-024

**Done**
- E possivel executar SQL no projeto correto pelo painel
- O historico fica acessivel
- Comandos destrutivos exibem aviso antes da execucao

### CT-026 — Entregar visualizador de tabelas paginado e virtualizado

**Como** admin
**Quero** navegar pelos dados como planilha
**Para** inspecionar tabelas sem escrever SQL para tudo

**Escopo**
- Lista de tabelas do projeto
- Grade paginada e virtualizada
- Filtro e ordenacao
- Decisao implementada: embutir Supabase Studio por projeto ou construir nativo

**Dependencias**
- CT-024

**Done**
- Tabelas do projeto podem ser abertas e navegadas com paginacao
- Filtro e ordenacao funcionam
- A abordagem escolhida para Studio foi aplicada

### CT-027 — Entregar gestao de tokens por projeto

**Como** admin
**Quero** emitir, listar e revogar tokens
**Para** controlar os acessos `service`, `anon` e `mcp`

**Escopo**
- Listar tokens por projeto
- Emitir novos tokens por escopo
- Revogar tokens
- Mostrar expiracao

**Dependencias**
- CT-024
- CT-009

**Done**
- O painel permite listar, emitir e revogar tokens
- Expiracao e escopo sao visiveis

### CT-028 — Entregar tela do importador no painel

**Como** admin
**Quero** disparar migracao pelo painel
**Para** cumprir a meta de operar tudo pela UI

**Escopo**
- Formulario do importador
- Exibicao do relatorio de migracao

**Dependencias**
- CT-021
- CT-024

**Done**
- E possivel iniciar importacao e ler o relatorio pela UI

### CT-029 — Exibir visao de saude do sistema no painel

**Como** admin
**Quero** enxergar recursos e containers da plataforma
**Para** detectar problemas de operacao cedo

**Escopo**
- RAM, CPU e disco
- Status de cada container
- Alertas: DB caido, disco cheio, GoTrue em restart

**Dependencias**
- CT-024

**Done**
- A tela de saude mostra os recursos e alertas pedidos no PRD

### CT-030 — Exibir status do ultimo backup no dashboard

**Como** admin
**Quero** ver o ultimo backup por projeto
**Para** operar com seguranca pela UI

**Escopo**
- Associar o status de backup ao projeto
- Mostrar a informacao no dashboard e no detalhe

**Dependencias**
- CT-001
- CT-023

**Done**
- O ultimo backup aparece no painel para cada projeto aplicavel

## Fase 5 — Storage, MCP e endurecimento

### CT-031 — Criar buckets MinIO por projeto

**Como** admin
**Quero** criar e gerenciar bucket de imagem por projeto
**Para** suportar storage integrado a cada ambiente

**Escopo**
- Criar bucket
- Listar buckets por projeto
- Persistir metadados em `buckets`

**Dependencias**
- CT-003
- CT-024

**Done**
- Cada projeto pode ter bucket criado e listado pelo painel

### CT-032 — Implementar upload e politicas publica/privada

**Como** admin
**Quero** subir arquivos e definir acesso
**Para** operar assets do projeto no storage

**Escopo**
- Upload
- Politica publica/privada
- Integracao com bucket do projeto

**Dependencias**
- CT-031

**Done**
- O painel faz upload e aplica a politica escolhida ao bucket correto

### CT-033 — Implementar estrategia quente SSD e frio NAS com cache de leitura

**Como** plataforma
**Quero** separar storage quente e frio
**Para** equilibrar desempenho e custo para imagens

**Escopo**
- Definir backend SSD/NAS por bucket ou classe
- Aplicar cache de leitura

**Dependencias**
- CT-032

**Done**
- A estrategia de armazenamento quente/frio esta ativa e documentada

### CT-034 — Expor servidor MCP por projeto com leitura por padrao

**Como** sistema consumidor
**Quero** consultar schema e dados de um projeto via MCP
**Para** automatizar investigacao e leitura segura

**Escopo**
- Autenticacao por token MCP
- Ferramentas: listar tabelas, descrever schema, query read-only

**Dependencias**
- CT-009
- CT-024

**Done**
- Cada projeto expoe MCP autenticado por token proprio
- As ferramentas read-only funcionam

### CT-035 — Exigir confirmacao explicita para escrita via MCP

**Como** admin
**Quero** que escritas por MCP so ocorram mediante confirmacao
**Para** reduzir risco operacional

**Escopo**
- Bloqueio padrao de escrita
- Mecanismo de confirmacao explicita para excecoes

**Dependencias**
- CT-034

**Done**
- Escrita via MCP nao acontece sem confirmacao explicita

### CT-036 — Entregar backups por projeto com retencao e restore testavel pela UI

**Como** admin
**Quero** operar backup e restore por projeto
**Para** fechar o ciclo operacional pela interface

**Escopo**
- `pg_dump` por projeto
- Retencao
- Restore disparado e acompanhado pela UI

**Dependencias**
- CT-024
- CT-001

**Done**
- O painel executa e mostra backups por projeto
- O restore pode ser testado a partir da UI

### CT-037 — Endurecer gestao de secrets e superficie de rede

**Como** plataforma
**Quero** proteger segredos e acessos internos
**Para** cumprir os requisitos de seguranca da v1

**Escopo**
- Tirar secrets de configuracoes soltas de aplicacao
- Garantir que Postgres siga nao exposto
- Revisar acessos internos do control plane, auth e storage

**Dependencias**
- CT-010
- CT-034

**Done**
- Secrets sensiveis estao em mecanismo seguro definido pela equipe
- Nao ha exposicao publica indevida do Postgres

## Marcos de aceite por fase

### Marco A — Fase 1 pronta
- CT-003 a CT-012 concluidas
- Evidencia de criacao, cadastro e login real sem terminal

### Marco B — Fase 2 pronta
- CT-013 a CT-016 concluidas
- Dois projetos ativos em subdominios distintos
- Prova de isolamento entre usuarios concluida

### Marco C — Fase 3 pronta
- CT-017 a CT-021 concluidas
- Projeto piloto migrado com login real via senha antiga

### Marco D — Fase 4 pronta
- CT-022 a CT-030 concluidas
- Ciclo de operacao principal executavel pela UI

### Marco E — Fase 5 pronta
- CT-031 a CT-037 concluidas
- Storage, MCP, backups e endurecimento entregues

## Observacoes importantes

- O PRD pede "operar tudo pela UI", mas a ordem correta continua sendo control plane antes de painel.
- O maior risco do sistema segue concentrado no provisionamento atomico com rollback.
- O item de TLS dinamico precisa ser resolvido cedo porque afeta a prova completa de roteamento por subdominio.
- O importador deve permanecer enxuto: sem edge functions, sem login social e sem automacao de secrets fora do que o PRD define.
