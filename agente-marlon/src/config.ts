import "dotenv/config";
import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "1" || v === "true");

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(3333),
  PUBLIC_BASE_URL: z.string().default("http://localhost:3333"),
  PANEL_ORIGIN: z.string().default("http://localhost:3000"),
  TZ_OPERACAO: z.string().default("America/Sao_Paulo"),

  // Armazenamento: "prisma" (Supabase/Postgres) ou "memory" (simulador/testes)
  STORE: z.enum(["prisma", "memory"]).default("prisma"),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  QUEUE_MODE: z.enum(["bullmq", "memory"]).default("bullmq"),

  // Agente
  AGENT_NAME: z.string().default("Clara"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),
  ANTHROPIC_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
  // Fallback do servidor em caso de recusa (padrão: ligado)
  ANTHROPIC_FALLBACKS: z.string().optional().transform((v) => (v === undefined ? true : v === "1" || v === "true")),
  BRAIN: z.enum(["claude", "offline"]).default("claude"),

  // WhatsApp Cloud API
  WA_PHONE_NUMBER_ID: z.string().default(""),
  WA_BUSINESS_ACCOUNT_ID: z.string().default(""),
  WA_ACCESS_TOKEN: z.string().default(""),
  WA_APP_SECRET: z.string().default(""),
  WA_VERIFY_TOKEN: z.string().default(""),
  WA_GRAPH_VERSION: z.string().default("v23.0"),
  WA_TEMPLATE_LANG: z.string().default("pt_BR"),
  WA_TEAM_NUMBERS: z.string().default(""), // WhatsApp interno da equipe (E.164, separados por vírgula)
  WA_MARLON_NUMBER: z.string().default(""),

  // STT (áudio do WhatsApp e voz própria)
  DEEPGRAM_API_KEY: z.string().default(""),

  // Voz
  VOICE_PROVIDER: z.enum(["vapi", "retell", "twilio_streams", "none"]).default("none"),
  VOICE_GENDER: z.enum(["feminina", "masculina"]).default("feminina"),
  VOICE_RECORD_CALLS: bool,
  RESPONDER_FORA_DO_HORARIO: z.string().optional().transform((v) => v !== "false"),
  LEAD_WEBHOOK_SECRET: z.string().default(""),
  TWILIO_ACCOUNT_SID: z.string().default(""),
  TWILIO_AUTH_TOKEN: z.string().default(""),
  TWILIO_NUMBER: z.string().default(""), // número brasileiro para ligações receptivas e de serviço
  TWILIO_NUMBER_0303: z.string().default(""), // número 0303 obrigatório para ligação ativa de oferta
  VAPI_API_KEY: z.string().default(""),
  VAPI_PHONE_NUMBER_ID: z.string().default(""),
  VAPI_PHONE_NUMBER_ID_0303: z.string().default(""),
  VAPI_VOICE_ID_FEMININA: z.string().default(""),
  VAPI_VOICE_ID_MASCULINA: z.string().default(""),
  VAPI_WEBHOOK_SECRET: z.string().default(""),
  RETELL_API_KEY: z.string().default(""),
  RETELL_AGENT_ID: z.string().default(""),
  RETELL_FROM_NUMBER: z.string().default(""),
  RETELL_FROM_NUMBER_0303: z.string().default(""),
  ELEVENLABS_API_KEY: z.string().default(""),
  ELEVENLABS_VOICE_ID_FEMININA: z.string().default(""),
  ELEVENLABS_VOICE_ID_MASCULINA: z.string().default(""),
  NAO_ME_PERTURBE_CHECK_URL: z.string().default(""),

  // Google Calendar
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().default(""), // JSON inteiro ou base64
  GOOGLE_CALENDAR_ID: z.string().default(""),
  CONSULTA_DURACAO_MIN: z.coerce.number().default(50),
  CONSULTA_HORARIOS: z.string().default("09:00,10:00,11:00,14:00,15:00,16:00,17:00"),

  // Pagamento da consulta
  CONSULTA_PAYMENT_PROVIDER: z.enum(["mercadopago", "manual"]).default("manual"),
  MERCADOPAGO_ACCESS_TOKEN: z.string().default(""),
  CONSULTA_PAYMENT_LINK_MANUAL: z.string().default(""),

  // Hotmart
  HOTMART_HOTTOK: z.string().default(""),
  HOTMART_PRODUCT_ID_EXPRESS: z.string().default(""),
  HOTMART_PRODUCT_ID_CONTROLE2: z.string().default(""),

  // Painel
  JWT_SECRET: z.string().default("dev-only-change-me"),
  CRON_SECRET: z.string().default(""),
});

export type Config = z.infer<typeof schema>;
export const config: Config = schema.parse(process.env);

export function isProd() {
  return config.NODE_ENV === "production";
}

if (isProd() && config.JWT_SECRET === "dev-only-change-me") {
  throw new Error("JWT_SECRET precisa ser definido em produção.");
}
