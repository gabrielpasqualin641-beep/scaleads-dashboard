# Coleta de dados do MCP Meta Ads

Procedimento da atualização do painel. Serve tanto para rodar à mão quanto para
a tarefa agendada `coleta-meta-ads`.

## Por que existe este passo manual

O servidor Express **não consegue** chamar o MCP Meta Ads. O MCP é um conector
remoto autenticado dentro do cliente Claude: não há entrada em `.mcp.json`, nem
transporte local, nem credencial acessível ao processo Node. Quem executa as
ferramentas é o Claude; o resultado entra no backend por
`POST /api/meta-mcp/snapshot`.

Enquanto isso não mudar, "automático" significa: uma sessão do Claude roda a
coleta sozinha, num horário agendado.

## Pré-requisitos

- Backend no ar em `http://localhost:3001`.
- `MCP_INGEST_KEY` presente no `.env` — autoriza só o POST do snapshot.

### Como o servidor sobe

Um atalho na pasta Inicializar do Windows chama
`scripts/start-dashboard-hidden.vbs`, que roda `scripts/start-dashboard.cmd`
sem janela de console. O script compila o painel se faltar o build e sobe
**um processo único na porta 3001**, servindo API e interface.

Se já houver algo escutando na 3001, ele não sobe uma segunda instância.

- Ver o painel: <http://localhost:3001>
- Para desenvolver: encerre esse processo e use `npm run dev` (Vite na 5173).
- Para desativar o início automático: remova o atalho "ScaleAds Dashboard" de
  `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`.

## Contas ativas

Só estas três têm veiculação. As demais do catálogo estão pausadas ou sem o
Ads MCP liberado, e não precisam de coleta.

| Conta | ID |
|---|---|
| CA02 - Alberto Pompeu | `1610921712941910` |
| CA04 - Alberto Pompeu | `2113422056113465` |
| CA05 - Alberto Pompeu | `764177629712794` |

## Janela

Últimos 30 dias encerrando **ontem** (a Meta ainda consolida o dia corrente).
Formato `YYYY-MM-DD`.

## Passo 1 — Catálogo

`ads_get_ad_accounts` sem argumentos extras. A saída inteira vira
`accountsPayload` no payload.

## Passo 2 — Por conta ativa

Para cada uma das três contas, com `ads_get_ad_entities`:

| Campo do payload | level | time_increment | fields |
|---|---|---|---|
| `daily` | `ad_account` | `"1"` | id, name, amount_spent, impressions, reach, frequency, clicks, lead, omni_purchase_values |
| `campaigns` | `campaign` | — | id, name, status, objective, amount_spent, impressions, reach, frequency, clicks, lead, omni_purchase_values |
| `adSets` | `adset` | — | id, name, status, campaign_id, + mesmas métricas |
| `ads` | `ad` | — | id, name, status, adset_id, campaign_id, creative_id, + mesmas métricas |

Use `sort: "amount_spent_descending"` e `limit: 12` nos três níveis de entidade.

## Passo 3 — Miniaturas dos criativos

1. Junte os `creative_id` que vieram no nível `ad`.
2. `ads_get_creatives` com `creative_ids` e
   `fields: ["id","thumbnail_url","image_url","object_type","video_id"]`.
3. A saída vira `creatives` no payload.

> As URLs do CDN da Meta são assinadas e expiram em cerca de **4 dias**
> (parâmetro `oe`, um timestamp Unix em hexadecimal). É o motivo de a coleta
> rodar diariamente: passou disso, a coluna Criativo vira o ícone de "sem
> imagem" até a próxima coleta.

## Passo 4 — Séries diárias por entidade

Alimentam os gráficos de evolução. Para cada nível, pegue os **4 ids de maior
investimento** do passo 2 e chame `ads_get_ad_entities` com:

- `time_increment: "1"`
- `fields: ["id", "amount_spent", "lead"]`
- `filtering: [{ field: "<level>.id", operator: "IN", value: [ids] }]`

Resultado em `campaignsDaily`, `adSetsDaily` e `adsDaily`.

Pule o nível quando a conta não reportar `lead` nele — a CA04 é assim em adset
e ad, e o gráfico de CPL ficaria vazio de qualquer forma.

## Passo 5 — Montar e enviar

Grave um JSON com este formato:

```json
{
  "toolsUsed": ["ads_get_ad_accounts", "ads_get_ad_entities", "ads_get_creatives"],
  "generatedAt": "<ISO-8601>",
  "accountsPayload": { },
  "accounts": [
    {
      "accountId": "1610921712941910",
      "range": { "since": "YYYY-MM-DD", "until": "YYYY-MM-DD" },
      "fetchedAt": "<ISO-8601>",
      "daily":          { "ad_entities": "<json string ou array>" },
      "campaigns":      { "ad_entities": "..." },
      "adSets":         { "ad_entities": "..." },
      "ads":            { "ad_entities": "..." },
      "creatives":      { "ad_creatives": [ ] },
      "campaignsDaily": { "ad_entities": "..." },
      "adSetsDaily":    { "ad_entities": "..." },
      "adsDaily":       { "ad_entities": "..." }
    }
  ]
}
```

`ad_entities` aceita tanto a string JSON crua devolvida pelo MCP quanto um
array já parseado. Valores monetários funcionam como `"R$ 1.234,56 BRL"` ou
como número — `buildSnapshot` normaliza os dois.

Envie:

```bash
node scripts/ingest-snapshot.mjs caminho/do/payload.json
```

## Passo 6 — Conferir

O script imprime as contas ingeridas. Duas verificações que pegam erro de
transcrição:

1. A soma da série diária de cada entidade tem que bater com o total dela.
2. O painel deve mostrar "coletado hoje" no cabeçalho da Visão Geral.

```bash
curl -s -H "Authorization: Bearer <token>" \
  "http://localhost:3001/api/dashboard/campaigns?clientId=client_alberto_pompeu&accountId=acc_ap_ca02&startDate=<since>&endDate=<until>"
```

## O que nunca fazer

- Não preencher métrica que a Meta não devolveu. MQL, agendamento e venda não
  existem na Ads API desta integração: ficam `null` e aparecem como N/D.
- Não derivar série diária a partir do total do período. Se o nível não tiver
  série real, o gráfico mostra o aviso de ausência.
- Não inventar conta que não esteja no catálogo do MCP.
