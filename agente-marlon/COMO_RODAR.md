# Como rodar no seu computador (Antigravity)

## 1. Antes de começar (só uma vez)
- Instale o **Node.js 20 ou mais novo**: https://nodejs.org (versão "LTS").
- Descompacte o `agente-marlon-v1.2.zip`.
- No Antigravity: **File → Open Folder** e escolha a pasta `agente-marlon`.

## 2. Instalar
Abra o terminal do Antigravity (**Terminal → New Terminal**). Confira se o caminho termina na pasta que tem o `package.json`. Depois rode:

```powershell
npm install
```

## 3. Rodar e falar com o agente
```powershell
npm run demo
```

Quando aparecer `SIMULADOR: abra http://localhost:3333`, abra **http://localhost:3333** no navegador. Não precisa de login.

- Escreva como se você fosse o lead, ou clique nos atalhos.
- Troque para **Ligação** para testar a conversa por telefone.
- No lado direito aparece o que o agente fez por dentro: a regra fixa ativada, as ferramentas usadas e o estado do lead.
- Para parar, use `Ctrl+C` no terminal.

> Painel completo da equipe (conversas, funil, ligações), opcional: `npm run local` e depois http://localhost:3000, com login `demo@equipe.local` / `demo-senha-123`. Ele demora mais para abrir (prepara o painel em cerca de 1 minuto). Para só conversar com o agente, use o `npm run demo`.

## 3.1 Ligação por voz (falar e ouvir)
1. Com o `npm run demo` rodando, abra http://localhost:3333 no **Google Chrome** ou no **Microsoft Edge**, no computador.
2. Clique na aba **Ligação** e depois em **📞 Receber ligação (voz)**. O telefone toca.
3. Clique em **Atender**. A assistente fala primeiro, em voz alta.
4. Quando aparecer **"ouvindo… pode falar"**, responda falando no microfone. Na primeira vez, o navegador pede permissão para o microfone: clique em **Permitir**.
5. Para encerrar, clique em **Desligar**. Ou diga "não me liga mais" e veja a assistente encerrar sozinha.

Dicas:
- **Voz:** escolha em **Voz da ligação**, no painel da direita. No Edge, as vozes "Online (Natural)" (Francisca, Thalita, Antonio) soam bem mais naturais.
- **Use fone de ouvido**, para o microfone não captar a voz da assistente.
- **"Interromper e falar"** corta a fala da assistente para você responder.
- **O silêncio também é um teste:** se você não falar nada, a assistente pergunta de novo e depois encerra de forma neutra.
- Isto simula a conversa da ligação. A voz e o tempo de resposta da ligação real (Vapi/Twilio) serão diferentes. O reconhecimento de voz do Chrome e do Edge é feito pelos servidores do Google e da Microsoft: use só para testes.

## 4. Usar o Claude de verdade (opcional)
Sem chave, quem responde é o roteiro offline: ele tem frases fixas e só entende o que foi previsto. Para conversar com a IA de verdade:

1. Copie o arquivo `.env.demo.example` para `.env`, na mesma pasta.
2. Preencha `ANTHROPIC_API_KEY=` com a sua chave da Anthropic (console.anthropic.com).
3. Pare com `Ctrl+C` e rode `npm run demo` de novo. O topo da tela do simulador passa a mostrar "Claude".

> Não copie o `.env.example` para testar: ele é a configuração de produção e exige todas as chaves (WhatsApp, Hotmart etc.).

## 4.2 Conectar no WhatsApp por QR code (TESTE)

> ⚠️ **Conexão NÃO-oficial (Baileys).** Escanear o QR usa o WhatsApp como o WhatsApp Web — isso **viola os termos do WhatsApp e pode BANIR o número**. Use um **número descartável** (um chip/linha de teste), **nunca o do Marlon**, e **não dispare mensagem em massa** (queima o número na hora). Para produção, o certo é a API oficial (Cloud API da Meta).

1. Tenha o `.env` configurado (com `BRAIN=gemini` e a chave, como no `.env` que você já usa). Os áudios já vêm desligados (`WA_AUDIO_REPLIES=off`).
2. No terminal, rode:

```powershell
npm run whatsapp
```

3. Vai aparecer um **QR code** no terminal. No celular do **número de teste**: **WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho** e escaneie o QR.
4. Quando aparecer **"✅ Conectado!"**, mande uma mensagem **de outro celular** para o número de teste. O Fernando responde sozinho, pelo Gemini.
5. **Deixe a janela do terminal aberta** enquanto testa — se fechar, ele para de responder. Para parar, `Ctrl+C`.

Observações:
- A sessão fica salva na pasta `auth_whatsapp/` (não precisa reescanear toda vez). Para trocar de número, apague essa pasta e rode de novo.
- Botões e listas aparecem como **texto numerado** (o WhatsApp bloqueia botões interativos fora da API oficial). A pessoa pode responder com o número ou escrevendo normalmente.
- Grupos e status são ignorados — o Fernando só responde conversas individuais.

## 5. Depois de mexer no agente
| O que você quer mudar | Arquivo |
|---|---|
| Tom, método de venda, objeções | `agent/system_prompt.md` |
| Produtos, preços, links, FAQ | `agent/knowledge/*.md` |
| Regras fixas (opt-out, risco, o que é bloqueado na resposta) | `src/agent/guardrails.ts` |
| Respostas do roteiro offline | `src/agent/brain/offline.ts` |
| Casos de teste | `tests/scenarios/*.yaml` |

Depois de cada mudança, pare (`Ctrl+C`), rode `npm run demo` de novo e confira com os testes:

```bash
npm test
```

```bash
npm run test:scenarios
```

Com a chave configurada, `npm run test:scenarios:live` roda os mesmos cenários com o Claude.

## Problemas comuns
- **Pasta no OneDrive:** funciona, mas a instalação fica mais lenta, porque o OneDrive sincroniza milhares de arquivos do `node_modules`. Se possível, deixe o projeto fora dele (ex.: `C:\projetos\agente-marlon`).
- **"Turbopack has seen frequent file updates":** acontece com `npm run panel:dev` dentro do OneDrive. Use `npm run local`, que não vigia arquivos.
- **"npm não é reconhecido":** o Node.js não foi instalado, ou o Antigravity foi aberto antes da instalação. Feche e abra o Antigravity de novo.
- **"porta 3000 (ou 3333) em uso":** já existe outro `npm run demo` (ou `npm run local`) rodando. Feche o outro terminal ou pare com `Ctrl+C`.
- **A tela pede login de novo:** a sessão do demo some quando você para o servidor. É só entrar de novo.
- **As conversas sumiram:** é esperado. No modo demo tudo fica em memória e recomeça a cada `npm run demo`.
