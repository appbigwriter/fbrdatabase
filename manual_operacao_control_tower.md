# Manual de Operação do Control Tower

O **Control Tower** é o painel de gestão centralizado (Control Plane) desenvolvido para gerenciar múltiplos projetos e bancos de dados (Postgres) de forma atômica e unificada. Abaixo está o passo a passo de como utilizar cada um dos seus recursos.

> [!NOTE]
> O Control Tower orquestra projetos reais nos bastidores. Quando o ambiente está no modo `real`, ele gerencia o banco de dados via Supabase Pooler e cria containers Docker reais para a autenticação (GoTrue).

---

## 1. Gestão de Projetos

A tela inicial do Control Tower lista todos os seus projetos ativos, além do seu plano de fundo (uso de disco e conexões) e uma visão consolidada de saúde da plataforma.

### Criar um Novo Projeto
1. Na tela inicial, clique no botão **"Novo projeto"**.
2. O sistema iniciará a criação atômica. Ele irá:
   - Criar um novo banco de dados.
   - Criar permissões/roles separadas (Reader e Writer).
   - Subir a instância de Autenticação (GoTrue).
   - Registrar as rotas dinâmicas (no Caddy) para acesso externo.
   - Emitir os tokens primários da API e do banco.
3. Se qualquer uma das etapas falhar, todo o processo sofrerá **rollback automático** (é cancelado por segurança).

> [!CAUTION]
> **Aviso sobre Ambiente Local (Desenvolvimento):** Se você criar um projeto na sua própria máquina executando localmente (`npm run dev`), o sistema tentará usar o serviço Docker local. Certifique-se de que o **Docker Desktop está aberto e rodando** antes de tentar adicionar um projeto novo.

---

## 2. Editor SQL e Querying

Você não precisa de ferramentas externas (como o DBeaver) para rodar instruções em seu banco.
1. Abra um projeto através da tela inicial.
2. Acesse a aba **"Editor SQL"**.
3. Escreva sua query no editor (ex: `SELECT * FROM auth.users`).
4. Clique em **Executar**. O resultado será exibido imediatamente na tela.
5. Suas consultas mais recentes ficarão salvas em um histórico na mesma janela.

> [!WARNING]
> Tenha muito cuidado com as operações `DROP`, `TRUNCATE`, `ALTER` e `DELETE`. Como trata-se de um sistema de orquestração direto, comandos destrutivos apagarão tabelas permanentemente.

---

## 3. Visualizador de Tabelas

Uma maneira rápida de analisar dados de forma amigável:
1. Abra um projeto na tela inicial.
2. Acesse a aba **"Tabelas"**.
3. Escolha uma tabela da lista suspensa ou pesquise usando a barra de busca lateral.
4. A tabela abrirá como uma planilha interativa onde é possível ler os dados paginados e ordenar registros.

---

## 4. Gestão de Tokens de Acesso (API Keys)

O painel fornece segurança reforçada limitando escopos via tokens JWT assimétricos emitidos por projeto.

1. Dentro de um projeto, acesse a aba **"Tokens"**.
2. Escolha o tipo/escopo do Token que você quer gerar:
   - **Service:** Token de serviço com capacidade de gravação (`read-write`), usado por robôs do CMS ou APIs.
   - **Anon:** Token anônimo e público com capacidade apenas de leitura (`read-only`), usado no frontend por usuários não logados.
   - **MCP:** Token read-only usado especificamente para servidores MCP.
3. Clique em **Emitir Token**. A chave final será mostrada a você. Copie-a (ela não será exibida novamente de forma integral).
4. Para **revogar** um token ativo, clique na opção de exclusão (lixeira/revogar) na lista de tokens exibida abaixo do botão de criação.

---

## 5. Storage (Buckets via MinIO)

O gerenciamento de arquivos quentes (SSD) ou frios (NAS) também é orquestrado de forma central:
1. Acesse a aba **"Buckets"**.
2. Preencha o nome do novo bucket e determine sua visibilidade (`Público` ou `Privado`) e o armazenamento desejado.
3. Para testar o envio, você pode anexar e fazer **upload de arquivos** usando as ferramentas da própria tela.
4. Os links dos arquivos podem ser referenciados nos seus aplicativos externos via subdomínio direto.

---

## 6. Importação e Migração (Ferramenta SaaS to Self-hosted)

Você pode clonar projetos diretamente de provedores externos como a nuvem do Supabase! O sistema se conectará na fonte, fará um `pg_dump` dos dados do usuário (`auth`) e do esquema `public`, depois recriará tudo na sua plataforma Control Tower.

1. Dentro da aba de projeto ou menu superior, localize a ferramenta de **Importação**.
2. Cole a *Connection String* do banco de dados antigo e as credenciais.
3. O painel extrairá as tabelas, funções e migrará de forma inteligente **todos os hashes de senhas (bcrypt)**, garantindo que nenhum usuário do projeto clonado perceba a mudança de provedor.
4. Você será capaz de testar as senhas no painel imediatamente após o término do dump.

---

## 7. Backups (Snapshots e Restaurações)

Sua torre de controle agenda rotinas, mas você também pode forçá-las manualmente.
1. No menu do seu projeto ativo, acesse **Backups**.
2. Clique em **Criar Backup Agora**.
3. O painel executará um snapshot das estruturas e dados e criará um pacote.
4. Você pode **Restaurar (Restore)** um snapshot da lista com um clique (use essa opção apenas se souber que os dados atuais serão sobrepostos).

---

## Checklist de Troubleshooting (Solução de Problemas Comuns)

- **Problema de Limite de Conexões (EMAXCONNSESSION):** Caso o Postgres/Painel acuse excesso de conexões e não abra, certifique-se que o seu `.env` usa a porta do pool transacional (`6543`) do Supabase e o parâmetro `?pgbouncer=true`.
- **Erro ao provisionar projeto novo:** O passo de subida do Auth (GoTrue) aciona o Docker via "Engine API". Se você tentar fazer essa criação no seu Windows via `localhost`, seu `Docker Desktop` precisa obrigatoriamente estar com a Engine iniciada em background, senão o `docker run` acusará *"The system cannot find the file specified"*.
- **Admin Lockout:** Se esquecer sua senha, ela não depende de banco. Lembre-se que ela pode ser substituída pelas chaves estáticas (bootstrap credentials) fixadas no seu arquivo `.env` (ex: `admin@facebrasil.com`).
