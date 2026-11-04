// Dados de exemplo para ver o painel funcionando (não use em produção).
import { buildApp } from "../app.js";
import { captureLead } from "../integrations/leads.js";

const { deps, engine } = buildApp({ dialer: null });
const r = await captureLead(deps, {
  nome: "João Exemplo", telefone: "11999990001", email: "joao@example.com", origem: "quiz", maior_de_18: true,
  aceita_ligacao: true, texto_consentimento_ligacao: "Aceito receber ligação da equipe do Marlon Mattedi", aceita_whatsapp: true, quer_ligacao_agora: false,
});
console.log("lead", r);
await engine.handleWhatsApp({ from: "5511999990001", name: "João", text: "Oi, quero saber do treino" });
await engine.handleWhatsApp({ from: "5511999990001", text: "Quanto custa?" });
console.log("ok");
process.exit(0);
