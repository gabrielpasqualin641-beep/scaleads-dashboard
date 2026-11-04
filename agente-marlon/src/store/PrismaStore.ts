import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import type {
  Appointment,
  Call,
  ContactAttempt,
  FunnelEvent,
  HumanTask,
  Lead,
  Message,
  PanelUser,
  Purchase,
} from "../domain/types.js";
import type { NewLead, Store } from "./Store.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const date = (s: string | null | undefined) => (s ? new Date(s) : s === null ? null : undefined);

function toLead(r: any): Lead {
  return { ...r, callConsent: r.callConsent ?? null, lastInboundAt: iso(r.lastInboundAt), createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() };
}
function leadData(p: Partial<Lead>): any {
  const { id: _id, createdAt: _c, updatedAt: _u, lastInboundAt, callConsent, ...rest } = p as any;
  const out: any = { ...rest };
  if (lastInboundAt !== undefined) out.lastInboundAt = date(lastInboundAt);
  if (callConsent !== undefined) out.callConsent = callConsent ?? null;
  return out;
}
const withCreated = <T,>(r: any): T => ({ ...r, createdAt: r.createdAt.toISOString() }) as T;
function toCall(r: any): Call {
  return { ...r, scheduledFor: iso(r.scheduledFor), startedAt: iso(r.startedAt), endedAt: iso(r.endedAt), createdAt: r.createdAt.toISOString() };
}
function callData(p: Partial<Call>): any {
  const { id: _i, createdAt: _c, scheduledFor, startedAt, endedAt, ...rest } = p as any;
  const out: any = { ...rest };
  if (scheduledFor !== undefined) out.scheduledFor = date(scheduledFor);
  if (startedAt !== undefined) out.startedAt = date(startedAt);
  if (endedAt !== undefined) out.endedAt = date(endedAt);
  return out;
}
function toAppt(r: any): Appointment {
  return { ...r, start: r.start.toISOString(), end: r.end.toISOString(), createdAt: r.createdAt.toISOString() };
}
function apptData(p: Partial<Appointment>): any {
  const { id: _i, createdAt: _c, start, end, ...rest } = p as any;
  const out: any = { ...rest };
  if (start) out.start = new Date(start);
  if (end) out.end = new Date(end);
  return out;
}

export class PrismaStore implements Store {
  db: PrismaClient;
  constructor(databaseUrl: string) {
    this.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  }

  async getLead(id: string) {
    const r = await this.db.lead.findUnique({ where: { id } });
    return r ? toLead(r) : null;
  }
  async getLeadByPhone(phone: string) {
    const r = await this.db.lead.findUnique({ where: { phone } });
    return r ? toLead(r) : null;
  }
  async getLeadByEmail(email: string) {
    const r = await this.db.lead.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
    return r ? toLead(r) : null;
  }
  async upsertLeadByPhone(data: NewLead) {
    const d = leadData(data);
    const r = await this.db.lead.upsert({ where: { phone: data.phone }, create: d, update: d });
    return toLead(r);
  }
  async updateLead(id: string, patch: Partial<Lead>) {
    return toLead(await this.db.lead.update({ where: { id }, data: leadData(patch) }));
  }
  async listLeads(opts: { limit?: number; search?: string } = {}) {
    const where = opts.search
      ? { OR: [{ phone: { contains: opts.search } }, { name: { contains: opts.search, mode: "insensitive" as const } }] }
      : {};
    const rows = await this.db.lead.findMany({ where, orderBy: { updatedAt: "desc" }, take: opts.limit ?? 100 });
    return rows.map(toLead);
  }

  async addMessage(m: Omit<Message, "id" | "createdAt">) {
    return withCreated<Message>(await this.db.message.create({ data: { ...m, meta: (m.meta ?? undefined) as any } }));
  }
  async listMessages(leadId: string, limit = 50) {
    const rows = await this.db.message.findMany({ where: { leadId }, orderBy: { createdAt: "desc" }, take: limit });
    return rows.reverse().map((r: any) => withCreated<Message>(r));
  }

  async addCall(c: Omit<Call, "id" | "createdAt">) {
    return toCall(await this.db.call.create({ data: callData(c) }));
  }
  async updateCall(id: string, patch: Partial<Call>) {
    return toCall(await this.db.call.update({ where: { id }, data: callData(patch) }));
  }
  async getCallByProviderId(providerCallId: string) {
    const r = await this.db.call.findUnique({ where: { providerCallId } });
    return r ? toCall(r) : null;
  }
  async listCalls(opts: { leadId?: string; limit?: number } = {}) {
    const rows = await this.db.call.findMany({ where: opts.leadId ? { leadId: opts.leadId } : {}, orderBy: { createdAt: "desc" }, take: opts.limit ?? 100 });
    return rows.map(toCall);
  }

  async addEvent(e: Omit<FunnelEvent, "id" | "createdAt">) {
    return withCreated<FunnelEvent>(await this.db.funnelEvent.create({ data: { ...e, data: e.data as any } }));
  }
  async listEvents(opts: { since?: string; until?: string; type?: FunnelEvent["type"]; leadId?: string }) {
    const rows = await this.db.funnelEvent.findMany({
      where: {
        type: opts.type,
        leadId: opts.leadId,
        createdAt: { gte: opts.since ? new Date(opts.since) : undefined, lt: opts.until ? new Date(opts.until) : undefined },
      },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r: any) => withCreated<FunnelEvent>(r));
  }

  async addTask(t: Omit<HumanTask, "id" | "createdAt" | "status">) {
    return withCreated<HumanTask>(await this.db.humanTask.create({ data: t }));
  }
  async listTasks(opts: { status?: HumanTask["status"] } = {}) {
    const rows = await this.db.humanTask.findMany({ where: { status: opts.status }, orderBy: { createdAt: "desc" } });
    return rows.map((r: any) => withCreated<HumanTask>(r));
  }
  async updateTask(id: string, patch: Partial<HumanTask>) {
    const { id: _i, createdAt: _c, ...data } = patch;
    return withCreated<HumanTask>(await this.db.humanTask.update({ where: { id }, data }));
  }

  async addAttempt(a: Omit<ContactAttempt, "id" | "createdAt">) {
    return withCreated<ContactAttempt>(await this.db.contactAttempt.create({ data: a }));
  }
  async listAttempts(leadId: string, opts: { opportunity?: string; since?: string; channel?: ContactAttempt["channel"] } = {}) {
    const rows = await this.db.contactAttempt.findMany({
      where: { leadId, opportunity: opts.opportunity, channel: opts.channel, createdAt: opts.since ? { gte: new Date(opts.since) } : undefined },
    });
    return rows.map((r: any) => withCreated<ContactAttempt>(r));
  }

  async addAppointment(a: Omit<Appointment, "id" | "createdAt">) {
    return toAppt(await this.db.appointment.create({ data: apptData(a) }));
  }
  async updateAppointment(id: string, patch: Partial<Appointment>) {
    return toAppt(await this.db.appointment.update({ where: { id }, data: apptData(patch) }));
  }
  async getAppointment(id: string) {
    const r = await this.db.appointment.findUnique({ where: { id } });
    return r ? toAppt(r) : null;
  }
  async listAppointments(opts: { leadId?: string } = {}) {
    const rows = await this.db.appointment.findMany({ where: { leadId: opts.leadId }, orderBy: { start: "asc" } });
    return rows.map(toAppt);
  }

  async upsertPurchase(p: Omit<Purchase, "id" | "createdAt">) {
    const r = await this.db.purchase.upsert({ where: { transaction: p.transaction }, create: p, update: p });
    return withCreated<Purchase>(r);
  }
  async listPurchases(opts: { leadId?: string; since?: string } = {}) {
    const rows = await this.db.purchase.findMany({
      where: { leadId: opts.leadId, createdAt: opts.since ? { gte: new Date(opts.since) } : undefined },
    });
    return rows.map((r: any) => withCreated<Purchase>(r));
  }

  async addConsentLog(entry: { leadId: string; kind: string; granted: boolean; origin: string; text: string }) {
    await this.db.consentLog.create({ data: entry });
  }

  async getUserByEmail(email: string): Promise<PanelUser | null> {
    return this.db.panelUser.findUnique({ where: { email } });
  }
  async createUser(u: Omit<PanelUser, "id">) {
    return this.db.panelUser.create({ data: u });
  }

  async purgeOlderThan(isoDate: string) {
    const cutoff = new Date(isoDate);
    const m = await this.db.message.deleteMany({ where: { createdAt: { lt: cutoff } } });
    const c = await this.db.call.updateMany({ where: { createdAt: { lt: cutoff }, summary: { not: null } }, data: { summary: null } });
    return { messages: m.count, calls: c.count };
  }
}
