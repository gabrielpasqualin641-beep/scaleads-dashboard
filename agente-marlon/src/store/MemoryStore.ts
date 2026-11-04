import { randomUUID } from "node:crypto";
import type { Appointment, Call, ContactAttempt, FunnelEvent, HumanTask, Lead, Message, PanelUser, Purchase } from "../domain/types.js";
import type { NewLead, Store } from "./Store.js";


/** Armazenamento em memória: usado pelo simulador e pela suíte de cenários. */
export class MemoryStore implements Store {
  constructor(private clock: () => Date = () => new Date()) {}
  private now() {
    return this.clock().toISOString();
  }
  leads = new Map<string, Lead>();
  messages: Message[] = [];
  calls: Call[] = [];
  events: FunnelEvent[] = [];
  tasks: HumanTask[] = [];
  attempts: ContactAttempt[] = [];
  appointments: Appointment[] = [];
  purchases: Purchase[] = [];
  consents: Array<{ leadId: string; kind: string; granted: boolean; origin: string; text: string; at: string }> = [];
  users: PanelUser[] = [];

  async getLead(id: string) {
    return this.leads.get(id) ?? null;
  }
  async getLeadByPhone(phone: string) {
    return [...this.leads.values()].find((l) => l.phone === phone) ?? null;
  }
  async getLeadByEmail(email: string) {
    return [...this.leads.values()].find((l) => l.email?.toLowerCase() === email.toLowerCase()) ?? null;
  }
  async upsertLeadByPhone(data: NewLead) {
    const existing = await this.getLeadByPhone(data.phone);
    if (existing) {
      const merged = { ...existing, ...stripUndefined(data), updatedAt: this.now() } as Lead;
      this.leads.set(existing.id, merged);
      return merged;
    }
    const lead: Lead = {
      id: randomUUID(),
      name: null,
      email: null,
      source: null,
      stage: "novo",
      aiPaused: false,
      pausedBy: null,
      optOutWhatsapp: false,
      optOutVoz: false,
      callConsent: null,
      naoMePerturbe: false,
      blockedMinor: false,
      identityConfirmed: false,
      purchases: [],
      summary: "",
      lastInboundAt: null,
      createdAt: this.now(),
      updatedAt: this.now(),
      ...stripUndefined(data),
    } as Lead;
    this.leads.set(lead.id, lead);
    return lead;
  }
  async updateLead(id: string, patch: Partial<Lead>) {
    const l = this.leads.get(id);
    if (!l) throw new Error(`lead ${id} não encontrado`);
    const merged = { ...l, ...stripUndefined(patch), updatedAt: this.now() };
    this.leads.set(id, merged);
    return merged;
  }
  async listLeads(opts: { limit?: number; search?: string } = {}) {
    let list = [...this.leads.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (opts.search) {
      const s = opts.search.toLowerCase();
      list = list.filter((l) => l.phone.includes(s) || (l.name ?? "").toLowerCase().includes(s));
    }
    return list.slice(0, opts.limit ?? 100);
  }

  async addMessage(m: Omit<Message, "id" | "createdAt">) {
    const msg = { ...m, id: randomUUID(), createdAt: this.now() };
    this.messages.push(msg);
    return msg;
  }
  async listMessages(leadId: string, limit = 50) {
    return this.messages.filter((m) => m.leadId === leadId).slice(-limit);
  }

  async addCall(c: Omit<Call, "id" | "createdAt">) {
    const call = { ...c, id: randomUUID(), createdAt: this.now() };
    this.calls.push(call);
    return call;
  }
  async updateCall(id: string, patch: Partial<Call>) {
    const i = this.calls.findIndex((c) => c.id === id);
    if (i < 0) throw new Error("ligação não encontrada");
    this.calls[i] = { ...this.calls[i], ...stripUndefined(patch) };
    return this.calls[i];
  }
  async getCallByProviderId(pid: string) {
    return this.calls.find((c) => c.providerCallId === pid) ?? null;
  }
  async listCalls(opts: { leadId?: string; limit?: number } = {}) {
    return this.calls
      .filter((c) => !opts.leadId || c.leadId === opts.leadId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, opts.limit ?? 100);
  }

  async addEvent(e: Omit<FunnelEvent, "id" | "createdAt">) {
    const ev = { ...e, id: randomUUID(), createdAt: this.now() };
    this.events.push(ev);
    return ev;
  }
  async listEvents(opts: { since?: string; until?: string; type?: FunnelEvent["type"]; leadId?: string }) {
    return this.events.filter(
      (e) =>
        (!opts.since || e.createdAt >= opts.since) &&
        (!opts.until || e.createdAt < opts.until) &&
        (!opts.type || e.type === opts.type) &&
        (!opts.leadId || e.leadId === opts.leadId),
    );
  }

  async addTask(t: Omit<HumanTask, "id" | "createdAt" | "status">) {
    const task: HumanTask = { ...t, id: randomUUID(), status: "aberta", createdAt: this.now() };
    this.tasks.push(task);
    return task;
  }
  async listTasks(opts: { status?: HumanTask["status"] } = {}) {
    return this.tasks.filter((t) => !opts.status || t.status === opts.status);
  }
  async updateTask(id: string, patch: Partial<HumanTask>) {
    const i = this.tasks.findIndex((t) => t.id === id);
    this.tasks[i] = { ...this.tasks[i], ...stripUndefined(patch) };
    return this.tasks[i];
  }

  async addAttempt(a: Omit<ContactAttempt, "id" | "createdAt">) {
    const at = { ...a, id: randomUUID(), createdAt: this.now() };
    this.attempts.push(at);
    return at;
  }
  async listAttempts(leadId: string, opts: { opportunity?: string; since?: string; channel?: ContactAttempt["channel"] } = {}) {
    return this.attempts.filter(
      (a) =>
        a.leadId === leadId &&
        (!opts.opportunity || a.opportunity === opts.opportunity) &&
        (!opts.since || a.createdAt >= opts.since) &&
        (!opts.channel || a.channel === opts.channel),
    );
  }

  async addAppointment(a: Omit<Appointment, "id" | "createdAt">) {
    const ap = { ...a, id: randomUUID(), createdAt: this.now() };
    this.appointments.push(ap);
    return ap;
  }
  async updateAppointment(id: string, patch: Partial<Appointment>) {
    const i = this.appointments.findIndex((a) => a.id === id);
    this.appointments[i] = { ...this.appointments[i], ...stripUndefined(patch) };
    return this.appointments[i];
  }
  async getAppointment(id: string) {
    return this.appointments.find((a) => a.id === id) ?? null;
  }
  async listAppointments(opts: { leadId?: string } = {}) {
    return this.appointments.filter((a) => !opts.leadId || a.leadId === opts.leadId);
  }

  async upsertPurchase(p: Omit<Purchase, "id" | "createdAt">) {
    const i = this.purchases.findIndex((x) => x.transaction === p.transaction);
    if (i >= 0) {
      this.purchases[i] = { ...this.purchases[i], ...p };
      return this.purchases[i];
    }
    const pu = { ...p, id: randomUUID(), createdAt: this.now() };
    this.purchases.push(pu);
    return pu;
  }
  async listPurchases(opts: { leadId?: string; since?: string } = {}) {
    return this.purchases.filter((p) => (!opts.leadId || p.leadId === opts.leadId) && (!opts.since || p.createdAt >= opts.since));
  }

  async addConsentLog(entry: { leadId: string; kind: string; granted: boolean; origin: string; text: string }) {
    this.consents.push({ ...entry, at: this.now() });
  }

  async getUserByEmail(email: string) {
    return this.users.find((u) => u.email === email) ?? null;
  }
  async createUser(u: Omit<PanelUser, "id">) {
    const user = { ...u, id: randomUUID() };
    this.users.push(user);
    return user;
  }

  async purgeOlderThan(iso: string) {
    const before = this.messages.length;
    this.messages = this.messages.filter((m) => m.createdAt >= iso);
    let calls = 0;
    for (const c of this.calls) {
      if (c.createdAt < iso && c.summary) {
        c.summary = null;
        calls++;
      }
    }
    return { messages: before - this.messages.length, calls };
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
