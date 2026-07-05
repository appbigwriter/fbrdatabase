# Workflow: Implementação de Stories

Este documento descreve o workflow fixo para a execução da implementação do código de stories previamente descritas para diversos projetos.

**Pré-requisito:** Os PRDs já foram analisados e transformados em stories detalhadas e validadas pela equipe de QA.

---

## Estrutura do Fluxo

O fluxo de trabalho deve ser seguido exatamente nesta ordem:

### 1. Sprint Planning & Team Assignment
- **Responsável:** `@aiox-master`
- **Ação:** Revisa todas as stories disponíveis e as divide em Sprints organizadas.
- **Distribuição:** Estas Sprints são atribuídas a dois ou mais times de desenvolvimento.
- **Composição de cada time:**
  - 1 `@dev`
  - 1 `@qa`
  - 1 `@ux-design-expert`

### 2. Database Modeling & Setup
- **Responsável:** `@data-engineer`
- **Ação:** Modela o banco de dados e cria as tabelas, relacionamentos e seeds necessários.
- **Entrada:** Os dados do banco e demais informações complementares serão passados através do prompt/instrução do usuário.

### 3. Implementation Cycle (Por Time)
Cada time receberá um número de Sprints para implementar de forma independente, seguindo o ciclo interno abaixo:

1. **Desenvolvimento:** `@dev` e `@ux-design-expert` trabalham em conjunto na implementação da story.
2. **Validação QA:** `@qa` analisa a implementação e:
   - **Aprova**, avançando a story.
   - **Retorna para ajustes**, caso encontre inconformidades.
3. **Escalonamento:** Se houver um **segundo retorno** de inconformidade na mesma story, o problema é escalonado para resolução pelos papéis:
   - `@analyst`
   - `@architect`
   *(Eles darão a solução estrutural para recolocar a story no fluxo normal até sua conclusão.)*
4. **Conclusão:** Ao final deste ciclo, as stories assumirão o status de `"Ready to Review"`.

### 4. Database Review
- **Responsável:** `@data-engineer`
- **Ação:** Revisa a estrutura do banco de dados agora integrado com o código recém-implementado pelos times, garantindo estabilidade e aderência ao modelo esperado.

### 5. Code Review & Deployment
- **Responsável (Revisão):** `@architect`
  - **Ação:** Revisa e aprova tecnicamente todas as implementações das stories unificadas.
- **Responsável (Deploy):** `@devops`
  - **Ação:** Realiza os procedimentos de commit e push definitivos, de acordo com o encaminhamento do `@architect`.

### 6. Final Approval
- **Responsável:** `@aiox-master`
- **Ação:** Revisa de ponta a ponta todas as entregas do ciclo de Sprints e efetiva a **aprovação final** do pacote implementado.
