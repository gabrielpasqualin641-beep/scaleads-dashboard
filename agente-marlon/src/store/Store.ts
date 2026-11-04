import type {
  Appointment,
  Call,
  ContactAttempt,
  EventType,
  FunnelEvent,
  HumanTask,
  Lead,
  Message,
  PanelUser,
  Purchase,
} from "../domain/types.js";

export type NewLead = Partial<Omit<Lead, "id" | "createdAt" | "updatedAt">> & { phone: string };

export interface Store {
  // Leads
  getLead(id: string): Promise<Lead | null>;
  getLeadByPhone(phone: string): Promise<Lead | null>;
  getLeadByEmail(email: string): Promise<Lead | null>;
  upsertLeadByPhone(data: NewLead): Promise<Lead>;
  updateLead(id: string, patch: Partial<Lead>): Promise<Lead>;
  listLeads(opts?: { limit?: number; search?: string }): Promise<Lead[]>;

  // Mensagens
  addMessage(m: Omit<Message, "id" | "createdAt">): Promise<Message>;
  listMessages(leadId: string, limit?: number): Promise<Message[]>;

  // Ligações
  addCall(c: Omit<Call, "id" | "createdAt">): Promise<Call>;
  updateCall(id: string, patch: Partial<Call>): Promise<Call>;
  getCallByProviderId(providerCallId: string): Promise<Call | null>;
  listCalls(opts?: { leadId?: string; limit?: number }): Promise<Call[]>;

  // Eventos de funil
  addEvent(e: Omit<FunnelEvent, "id" | "createdAt">): Promise<FunnelEvent>;
  listEvents(opts: { since?: string; until?: string; type?: EventType; leadId?: string }): Promise<FunnelEvent[]>;

  // Tarefas humanas
  addTask(t: Omit<HumanTask, "id" | "createdAt" | "status">): Promise<HumanTask>;
  listTasks(opts?: { status?: HumanTask["status"] }): Promise<HumanTask[]>;
  updateTask(id: string, patch: Partial<HumanTask>): Promise<HumanTask>;

  // Tentativas de contato (limites)
  addAttempt(a: Omit<ContactAttempt, "id" | "createdAt">): Promise<ContactAttempt>;
  listAttempts(leadId: string, opts?: { opportunity?: string; since?: string; channel?: ContactAttempt["channel"] }): Promise<ContactAttempt[]>;

  // Consultas
  addAppointment(a: Omit<Appointment, "id" | "createdAt">): Promise<Appointment>;
  updateAppointment(id: string, patch: Partial<Appointment>): Promise<Appointment>;
  getAppointment(id: string): Promise<Appointment | null>;
  listAppointments(opts?: { leadId?: string }): Promise<Appointment[]>;

  // Compras
  upsertPurchase(p: Omit<Purchase, "id" | "createdAt">): Promise<Purchase>;
  listPurchases(opts?: { leadId?: string; since?: string }): Promise<Purchase[]>;

  // Consentimentos (log imutável)
  addConsentLog(entry: { leadId: string; kind: string; granted: boolean; origin: string; text: string }): Promise<void>;

  // Usuários do painel
  getUserByEmail(email: string): Promise<PanelUser | null>;
  createUser(u: Omit<PanelUser, "id">): Promise<PanelUser>;

  // LGPD
  purgeOlderThan(isoDate: string): Promise<{ messages: number; calls: number }>;
}
