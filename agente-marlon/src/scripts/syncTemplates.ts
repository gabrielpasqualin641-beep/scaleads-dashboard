// Cadastra na Meta os templates de agent/templates.json (ficam "em análise" até a aprovação).
import { config } from "../config.js";
import { loadTemplates } from "../channels/whatsapp.js";

if (!config.WA_BUSINESS_ACCOUNT_ID || !config.WA_ACCESS_TOKEN) {
  console.error("Configure WA_BUSINESS_ACCOUNT_ID e WA_ACCESS_TOKEN.");
  process.exit(1);
}
for (const t of loadTemplates()) {
  const components: Array<Record<string, unknown>> = [{ type: "BODY", text: t.body, example: { body_text: [t.example] } }];
  if (t.buttons?.length) components.push({ type: "BUTTONS", buttons: t.buttons.map((text) => ({ type: "QUICK_REPLY", text })) });
  const r = await fetch(`https://graph.facebook.com/${config.WA_GRAPH_VERSION}/${config.WA_BUSINESS_ACCOUNT_ID}/message_templates`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.WA_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: t.name, language: config.WA_TEMPLATE_LANG, category: t.category, components }),
  });
  const j = await r.json();
  console.log(`${t.name}: ${r.status}`, JSON.stringify(j));
}
