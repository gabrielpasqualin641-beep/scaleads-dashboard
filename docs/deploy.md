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
| `CORS_ORIGIN` | URL do front, quando ele estiver em outro domínio |
| `NODE_ENV` | `production` |
| `ANTHROPIC_API_KEY` | Opcional — só para o estudo de estratégia |

Gere segredos **novos** para produção. Não reaproveite os do ambiente local.

`PORT` é injetada pela plataforma; não defina manualmente.

## Arquitetura dividida: Vercel + Render

Front no Vercel, backend no Render. As duas pontas em domínios diferentes, o
que exige URL de API configurada e CORS restrito.

### 1. Backend no Render (faça primeiro — o front precisa da URL dele)

1. **New → Web Service** → conecte o repositório.
2. Runtime **Node**, Build Command `npm run build`, Start Command `npm start`.
3. Plano **Starter** ou superior — o free não tem disco persistente.
4. **Disks → Add Disk**, Mount Path `/var/data`.
5. Em **Environment**, as variáveis da tabela acima com:
   - `DATA_DIR=/var/data`
   - `NODE_ENV=production`
   - `CORS_ORIGIN` — deixe vazio por enquanto; você preenche no passo 3.
6. Anote a URL gerada, algo como `https://scaleads-api.onrender.com`.

### 2. Front no Vercel

1. **Add New → Project** → importe o repositório.
2. O `vercel.json` já define build e diretório de saída. Não altere.
3. Em **Environment Variables**, adicione:
   - `VITE_API_URL` = a URL do Render, sem barra no final
4. Deploy. Anote a URL, algo como `https://scaleads.vercel.app`.

> `VITE_API_URL` é embutida no bundle **em tempo de build**. Mudou a URL do
> backend? É preciso refazer o deploy do front, não basta editar a variável.

### 3. Ligue as duas pontas

Volte ao Render e defina `CORS_ORIGIN` com a URL do Vercel:

```
CORS_ORIGIN=https://scaleads.vercel.app
```

Mais de uma origem (domínio próprio, previews) separa por vírgula. O serviço
reinicia sozinho. No log deve aparecer:

```
🌐 [CORS] Origens liberadas: https://scaleads.vercel.app
```

### Por que o CORS é restrito

Uma API que responde `Access-Control-Allow-Origin: *` permite que qualquer site
faça requisições em nome de quem estiver logado. Com `CORS_ORIGIN`, só o
domínio do seu front recebe resposta legível.

Chamadas sem cabeçalho `Origin` — o script de ingestão, `curl` — continuam
passando: não vêm de navegador e não estão sujeitas à mesma política.

### Coleta do MCP na arquitetura dividida

`DASHBOARD_URL` no `.env` local aponta para o **Render**, não para o Vercel — a
ingestão fala com a API.

```bash
DASHBOARD_URL=https://scaleads-api.onrender.com
```

---

## Alternativa: tudo junto no Railway

Um processo servindo interface e API na mesma origem. Um deploy, uma URL, sem
CORS e sem variável de build.

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
