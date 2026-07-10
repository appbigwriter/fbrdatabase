# Lista de Tarefas Restantes — Forgejo & Control Tower

## Forgejo (Git Self-Hosted)
- [ ] Criar o script de backup 3-2-1 no VPS (`/home/deploy/forgejo/backup.sh`)
- [ ] Configurar cron job diário para o backup
- [ ] Rodar o backup manualmente para testar o envio ao R2 via rclone
- [ ] Testar restore completo em container descartável no VPS

## Control Tower
- [ ] Executar e passar o Smoke Test final (`smoke:real`) no container
- [ ] Provisionar projeto de teste via API/Painel
- [ ] Validar a publicação das rotas e HTTPS no subdomínio de teste
- [ ] Validar o funcionamento do GoTrue (Auth) no subdomínio
