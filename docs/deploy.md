# Hospedagem do painel

O painel é um processo Node único que serve API e interface na mesma porta, e
guarda dados em arquivos JSON.

**Isso exige uma plataforma com disco persistente.** Em ambiente serverless
(Vercel, Netlify Functions, Lambda) o disco é efêmero: a aplicação sobe, aceita
escrita, e perde tudo na próxima hibernação — usuários criados, briefings,
estudos e a coleta do Meta Ads. O painel *parece* funcionar e some com os dados.

Railway e Render resolvem isso com um volume montado.

## Variáveis de ambiente

Todas obrigatórias, exceto onde indicado.

| Variável | O que é |
|---|---|
| `ADMIN_NAME` | Nome do administrador inicial |
| `ADMIN_EMAIL` | E-mail do administrador inicial |
| `ADMIN_PASSWORD_HASH` | `npm run auth:hash -- "sua-senha"` |
| `AUTH_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `MCP_INGEST_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DATA_DIR` | Caminho do volume montado |
| `NODE_ENV` | `production` |
| `ANTHROPIC_API_KEY` | Opcional — só para o estudo de estratégia |

Gere segredos **novos** para produção. Não reaproveite os do ambiente local.

`PORT` é injetada pela plataforma; não defina manualmente.

## Railway

1. **New Project → Deploy from GitHub repo** → selecione `scaleads-dashboard`.
2. Em **Settings → Build**:
   - Build Command: `npm run build`
   - Start Command: `npm start`
3. Em **Variables**, adicione as variáveis acima com `DATA_DIR=/data`.
4. Em **Settings → Volumes**, adicione um volume com Mount Path `/data`.
5. **Settings → Networking → Generate Domain** para obter a URL pública.

## Render

1. **New → Web Service** → conecte o repositório.
2. Runtime **Node**, Build Command `npm run build`, Start Command `npm start`.
3. Plano **Starter** ou superior — o plano free não tem disco persistente.
4. **Disks → Add Disk**, Mount Path `/var/data`.
5. Em **Environment**, as variáveis acima com `DATA_DIR=/var/data`.

## Primeiro acesso

No primeiro boot o administrador é criado a partir das variáveis. Entre com
`ADMIN_EMAIL` e a senha que gerou o hash, e troque a senha em seguida.

Daí em diante o `.env` não é mais consultado no login — os usuários vivem no
banco, no volume.

## Coleta do Meta Ads no ambiente hospedado

A coleta continua saindo de uma sessão do Claude na sua máquina — o servidor
não alcança o MCP. O que muda é o destino: em vez de `localhost`, o script
aponta para a URL pública.

No `.env` **local** (não no da plataforma):

```bash
DASHBOARD_URL=https://seu-painel.up.railway.app
MCP_INGEST_KEY=<a mesma chave configurada na plataforma>
```

O `scripts/ingest-snapshot.mjs` passa a enviar para lá. A `MCP_INGEST_KEY`
precisa ser idêntica nos dois lados.

Ajuste também o passo 0 da tarefa agendada `coleta-meta-ads`: hospedado, não é
mais preciso subir servidor local — basta conferir que a URL pública responde.

## Backup

O volume guarda tudo que não está no git: usuários, clientes, briefings,
estudos e a coleta. Vale baixar `store.json` periodicamente.

Railway e Render oferecem snapshot de volume nos planos pagos.

## O que muda em produção

Com `NODE_ENV=production`:

- O CORS aberto é desativado. A interface é servida pela mesma origem e não
  precisa dele; deixá-lo ligado permitiria que qualquer site chamasse a API
  com o token do usuário.
- O Express passa a confiar no proxy da plataforma para ler IP e protocolo
  originais.
