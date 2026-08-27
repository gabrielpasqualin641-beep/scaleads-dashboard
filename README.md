# ScaleAds — Performance Hub

Painel de performance para gestão de tráfego em Meta Ads, com dados reais vindos
do MCP Meta Ads.

O princípio que orienta o projeto: **nenhuma métrica é inventada**. O que a Meta
não reporta aparece como N/D, nunca como estimativa. Recomendação gerada por IA
fica visualmente separada do que foi medido.

## Funcionalidades

| Área | O que faz |
|---|---|
| **Visão Geral** | KPIs consolidados, funil, evolução diária e detalhamento por dia |
| **Campanhas / Conjuntos / Anúncios** | Tabelas com métricas reais e gráficos de série diária por entidade |
| **Criativos** | Miniatura real de cada anúncio, vinda do CDN da Meta |
| **Análise de Campanhas** | Classifica em Escalar / Otimizar / Cortar por regras determinísticas, com o número que disparou cada veredito |
| **Projeto** | Briefing do cliente e metas. O CPL alvo vira a referência da análise |
| **Estudo de estratégia** | Pesquisa web + síntese pela API da Claude, marcado como conteúdo de IA |
| **Relatório & WhatsApp** | Resumo pronto para envio, só com métricas reportadas |
| **Usuários & Acessos** | Três níveis de permissão com escopo por cliente |

## Stack

React 19 + TypeScript + Vite no front, Express + TypeScript no back, Chart.js
para gráficos. Persistência em arquivo JSON — sem banco externo.

## Requisitos

- Node.js 20 ou superior
- Acesso ao MCP Meta Ads pelo cliente Claude (para a coleta de dados)
- Chave da API Anthropic (opcional — só para o estudo de estratégia)

## Instalação

```bash
npm install
cp .env.example .env
```

Preencha o `.env`:

```bash
# Administrador inicial
ADMIN_NAME="Seu Nome"
ADMIN_EMAIL=voce@exemplo.com
ADMIN_PASSWORD_HASH=      # gere com: npm run auth:hash -- "sua-senha"
AUTH_SECRET=              # node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# Coleta automática do MCP
MCP_INGEST_KEY=           # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Estudo de estratégia (opcional)
ANTHROPIC_API_KEY=

PORT=3001
```

## Executando

```bash
npm run dev     # desenvolvimento: API na 3001, Vite na 5173
npm start       # produção: build + processo único na 3001 servindo tudo
```

No primeiro boot o administrador é criado a partir do `.env`. Depois disso o
`.env` deixa de ser consultado no login — os usuários vivem no banco.

## Como os dados entram

O servidor Express **não consegue** chamar o MCP Meta Ads: o conector é remoto e
autenticado dentro do cliente Claude, sem endpoint acessível ao processo Node.

O fluxo é: uma sessão do Claude executa as ferramentas do MCP e envia o
resultado para `POST /api/meta-mcp/snapshot`, autenticada pela `MCP_INGEST_KEY`.

```bash
node scripts/ingest-snapshot.mjs caminho/do/payload.json
```

O procedimento completo está em [`docs/coleta-mcp.md`](docs/coleta-mcp.md).

As URLs das miniaturas de criativo expiram em cerca de 4 dias, por isso a coleta
é recorrente.

## Níveis de acesso

| | Visualizador | Editor | Administrador |
|---|---|---|---|
| Dashboards dos clientes atribuídos | ✓ | ✓ | ✓ (todos) |
| Sincronizar dados | — | ✓ | ✓ |
| Manter clientes e contas | — | ✓ | ✓ |
| Gerenciar usuários | — | — | ✓ |

A autorização é aplicada no servidor, rota a rota. Cliente fora do escopo
responde 404, não 403 — um 403 confirmaria que aquele cliente existe.

## Limitações conhecidas

- **MQL, agendamento e venda** não existem na Meta Ads API nesta integração.
  Aparecem como N/D e não são derivados de leads por fator algum.
- **Dados demográficos e lista nominal de leads** não vêm pela integração.
- **Google Ads** não tem integração. O estudo de estratégia trata Google como
  recomendação genérica de mercado e diz isso explicitamente.
- A coleta agendada roda enquanto o app do Claude estiver aberto.

## Estrutura

```
client/          React + Vite
  src/pages/       telas
  src/components/  UI reutilizável
  src/context/     auth, cliente, período, tema
server/          Express + TypeScript
  routes/          endpoints
  services/        regras de negócio
  providers/       fontes de dados (MCP, Graph API, mock)
  integrations/    parser e store do snapshot MCP
  data/            banco local — ignorado pelo git
scripts/         ingestão e inicialização
docs/            procedimentos operacionais
```

## Licença

Projeto privado. Todos os direitos reservados.
