# Como rodar no seu computador (Antigravity)

## 1. Antes de começar (só uma vez)
- Instale o **Node.js 20 ou mais novo**: https://nodejs.org (versão "LTS").
- Descompacte o `agente-marlon-v1.2.zip`.
- No Antigravity: **File → Open Folder** e escolha a pasta `agente-marlon`.

## 2. Instalar
Abra o terminal do Antigravity (**Terminal → New Terminal**) e rode:

```bash
npm install
```

## 3. Rodar
```bash
npm run local
```

Esse comando sobe o backend e o painel juntos. Na primeira vez, ele também instala o painel. Espere aparecer a mensagem `Abra: http://localhost:3000/simulador`.

- **Endereço:** http://localhost:3000/simulador
- **Login:** `demo@equipe.local`
- **Senha:** `demo-senha-123`
- **Para parar:** `Ctrl+C` no terminal.

## 4. Usar o Claude de verdade (opcional)
Sem chave, quem responde é o roteiro offline: ele tem frases fixas e só entende o que foi previsto. Para conversar com a IA de verdade:

1. Copie o arquivo `.env.demo.example` para `.env`, na mesma pasta.
2. Preencha `ANTHROPIC_API_KEY=` com a sua chave da Anthropic (console.anthropic.com).
3. Pare com `Ctrl+C` e rode `npm run local` de novo. O topo da tela do simulador passa a mostrar "Claude".

> Não copie o `.env.example` para testar: ele é a configuração de produção e exige todas as chaves (WhatsApp, Hotmart etc.).

## 5. Depois de mexer no agente
| O que você quer mudar | Arquivo |
|---|---|
| Tom, método de venda, objeções | `agent/system_prompt.md` |
| Produtos, preços, links, FAQ | `agent/knowledge/*.md` |
| Regras fixas (opt-out, risco, o que é bloqueado na resposta) | `src/agent/guardrails.ts` |
| Respostas do roteiro offline | `src/agent/brain/offline.ts` |
| Casos de teste | `tests/scenarios/*.yaml` |

Depois de cada mudança, pare (`Ctrl+C`), rode `npm run local` de novo e confira com os testes:

```bash
npm test
```

```bash
npm run test:scenarios
```

Com a chave configurada, `npm run test:scenarios:live` roda os mesmos cenários com o Claude.

## Problemas comuns
- **"npm não é reconhecido":** o Node.js não foi instalado, ou o Antigravity foi aberto antes da instalação. Feche e abra o Antigravity de novo.
- **"porta 3000 (ou 3333) em uso":** já existe outro `npm run local` rodando. Feche o outro terminal ou pare com `Ctrl+C`.
- **A tela pede login de novo:** a sessão do demo some quando você para o servidor. É só entrar de novo.
- **As conversas sumiram:** é esperado. No modo demo tudo fica em memória e recomeça a cada `npm run local`.
