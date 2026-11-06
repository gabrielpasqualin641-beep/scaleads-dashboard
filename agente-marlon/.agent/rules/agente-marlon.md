---
trigger: always_on
---

# Regras do projeto agente-marlon

Leia e siga o arquivo `AGENTS.md` na raiz do projeto antes de qualquer alteração. Resumo:

- O dono usa Windows/PowerShell: um comando por vez, sem `&&`.
- Não faça `git push` e não suba nada para o GitHub.
- Não invente fatos sobre produtos: a fonte única é `agent/knowledge/produtos.md`. Na dúvida, pergunte ao dono.
- As regras de conformidade do `COMPLIANCE.md` (seção 5) não podem ser enfraquecidas: identificação como assistente virtual, discrição, opt-out, sem diagnóstico, sem promessa, sem remédio, CVV 188, encerramento com menor de idade, reembolso sempre com um humano.
- Todo link de checkout é montado por `buildCheckoutUrl` e leva `sck=f4-ia`.
- Não remova nem afrouxe cenários de `tests/scenarios/` para um teste passar.
- Depois de mudar algo, rode `npm run typecheck`, `npm test` e `npm run test:scenarios`.
