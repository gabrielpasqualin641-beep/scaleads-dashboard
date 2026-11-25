# Hospedar o Fernando no WhatsApp 24h (Render)

Deixa o Fernando conectado ao WhatsApp o tempo todo, **sem depender do seu PC ligado**.

> ⚠️ **Leia antes:**
> - Conexão **NÃO-oficial** (Baileys): pode **BANIR o número**. Use um **número descartável** (um chip de teste), **nunca o do Marlon**, e **não dispare mensagem em massa**.
> - Use plano **PAGO** (Starter, ~US$7/mês). O plano **grátis do Render dorme** quando fica parado, e aí **o WhatsApp cai**. O disco de sessão também exige plano pago.

## O que você vai precisar
- Conta no **Render** → https://render.com (login com o GitHub).
- O repositório **agente-ia-marlon** no seu GitHub (já está lá).
- A sua **chave do Gemini** (Google AI Studio).

## Passo a passo

### 1. Criar o serviço pelo Blueprint
1. No Render, clique em **New +** → **Blueprint**.
2. Conecte sua conta do GitHub e escolha o repositório **agente-ia-marlon**.
3. O Render lê o arquivo `render.yaml` e já propõe o serviço **fernando-whatsapp** (plano Starter + disco de 1 GB). Clique em **Apply**.

### 2. Colocar a chave do Gemini
1. Abra o serviço **fernando-whatsapp** → aba **Environment**.
2. Em `GEMINI_API_KEY`, clique em **Edit** e cole a sua chave. **Save Changes**.
3. O Render faz o deploy automaticamente (leva alguns minutos).

### 3. Pegar a senha da página do QR
1. Ainda em **Environment**, encontre `WHATSAPP_ADMIN_TOKEN` (o Render gerou um valor).
2. Clique no olhinho/Reveal e **copie** esse valor — é a senha pra ver o QR.

### 4. Conectar o WhatsApp (escanear o QR)
1. No topo do serviço, copie a **URL** dele (algo como `https://fernando-whatsapp.onrender.com`).
2. Abra no navegador: **`SUA_URL/?token=COLE_A_SENHA_AQUI`**
   - Exemplo: `https://fernando-whatsapp.onrender.com/?token=abc123...`
3. Vai aparecer um **QR code** na tela. No celular do **número de teste**: **WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho** → escaneie.
4. A página mostra **✅ Conectado**. Pronto! Mande uma mensagem **de outro celular** para o número de teste e o Fernando responde sozinho, 24h.

## Bom saber
- **A sessão fica salva no disco** (`/data`): em novos deploys você **não** precisa reescanear.
- Para **trocar de número**: no serviço, aba **Disks**, apague o disco (ou o conteúdo) e reinicie — aí aparece um QR novo.
- **Health check**: a rota `/health` é usada pelo Render pra saber que está no ar (não precisa fazer nada).
- **Memória do lead:** neste modo simples (sem banco), o histórico/resumo de cada lead **reinicia** se o serviço reiniciar. Pra persistir tudo (e ligar as cadências de follow-up automáticas), dá pra adicionar um Postgres depois — é o próximo passo quando quiser.
- **Áudios:** desligados (`WA_AUDIO_REPLIES=off`). Só texto, como combinamos.

## Custo aproximado
- Serviço Starter: ~**US$7/mês**. Disco de 1 GB: ~**US$0,25/mês**. (Valores do Render, podem variar.)
