import { JWT } from "google-auth-library";
import { DateTime } from "luxon";
import { config } from "../config.js";

export interface Slot {
  start: string; // ISO
  end: string;
  label: string; // "ter 14/11 às 15h"
}

export interface CalendarProvider {
  listFreeSlots(days: number, from?: Date): Promise<Slot[]>;
  createEvent(input: { start: string; end: string; summary: string; attendeeEmail?: string | null }): Promise<{ id: string; meetLink: string | null }>;
  cancelEvent(id: string): Promise<void>;
}

const WEEKDAYS = ["", "seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

export function slotLabel(iso: string): string {
  const t = DateTime.fromISO(iso).setZone(config.TZ_OPERACAO);
  const h = t.minute ? t.toFormat("HH'h'mm") : t.toFormat("H'h'");
  return `${WEEKDAYS[t.weekday]} ${t.toFormat("dd/MM")} às ${h}`;
}

/** Gera candidatos de horário (seg-sex, horários configurados) a partir de amanhã. */
export function candidateSlots(days: number, from = new Date()): Slot[] {
  const hours = config.CONSULTA_HORARIOS.split(",").map((s) => s.trim());
  const out: Slot[] = [];
  let d = DateTime.fromJSDate(from).setZone(config.TZ_OPERACAO).plus({ days: 1 }).startOf("day");
  for (let i = 0; i < days; i++, d = d.plus({ days: 1 })) {
    if (d.weekday > 5) continue;
    for (const h of hours) {
      const [hh, mm] = h.split(":").map(Number);
      const start = d.set({ hour: hh, minute: mm });
      const end = start.plus({ minutes: config.CONSULTA_DURACAO_MIN });
      out.push({ start: start.toUTC().toISO()!, end: end.toUTC().toISO()!, label: slotLabel(start.toISO()!) });
    }
  }
  return out;
}

/** Google Calendar com conta de serviço (a agenda do Marlon é compartilhada com o e-mail da conta de serviço). */
export class GoogleCalendar implements CalendarProvider {
  private jwt: JWT;
  private calId = encodeURIComponent(config.GOOGLE_CALENDAR_ID);

  constructor() {
    const raw = config.GOOGLE_SERVICE_ACCOUNT_JSON.trim();
    const creds = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
    this.jwt = new JWT({ email: creds.client_email, key: creds.private_key, scopes: ["https://www.googleapis.com/auth/calendar"] });
  }

  private async req<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const r = await this.jwt.request<T>({ url, method: (init.method ?? "GET") as "GET", data: init.body });
    return r.data;
  }

  async listFreeSlots(days: number, from = new Date()): Promise<Slot[]> {
    const cands = candidateSlots(days, from);
    if (!cands.length) return [];
    const fb = await this.req<{ calendars: Record<string, { busy: Array<{ start: string; end: string }> }> }>(
      "https://www.googleapis.com/calendar/v3/freeBusy",
      { method: "POST", body: { timeMin: cands[0].start, timeMax: cands[cands.length - 1].end, items: [{ id: config.GOOGLE_CALENDAR_ID }] } },
    );
    const busy = fb.calendars[config.GOOGLE_CALENDAR_ID]?.busy ?? [];
    return cands.filter((s) => !busy.some((b) => s.start < b.end && b.start < s.end));
  }

  async createEvent(input: { start: string; end: string; summary: string; attendeeEmail?: string | null }) {
    const ev = await this.req<{ id: string; hangoutLink?: string }>(
      `https://www.googleapis.com/calendar/v3/calendars/${this.calId}/events?conferenceDataVersion=1&sendUpdates=none`,
      {
        method: "POST",
        body: {
          summary: input.summary,
          // Sem dados sensíveis na agenda: só o primeiro nome e "Consulta online".
          description: "Agendado pela assistente virtual. Detalhes no painel.",
          start: { dateTime: input.start },
          end: { dateTime: input.end },
          conferenceData: { createRequest: { requestId: `ag-${Date.now()}` } },
        },
      },
    );
    return { id: ev.id, meetLink: ev.hangoutLink ?? null };
  }

  async cancelEvent(id: string) {
    await this.req(`https://www.googleapis.com/calendar/v3/calendars/${this.calId}/events/${id}`, { method: "DELETE" });
  }
}

/** Agenda local para simulador/testes. */
export class FakeCalendar implements CalendarProvider {
  booked: Array<{ id: string; start: string; end: string; summary: string }> = [];
  async listFreeSlots(days: number, from = new Date()) {
    return candidateSlots(days, from).filter((s) => !this.booked.some((b) => b.start === s.start));
  }
  async createEvent(input: { start: string; end: string; summary: string }) {
    const id = `fake-${this.booked.length + 1}`;
    this.booked.push({ id, ...input });
    return { id, meetLink: "https://meet.google.com/xxx-yyyy-zzz" };
  }
  async cancelEvent(id: string) {
    this.booked = this.booked.filter((b) => b.id !== id);
  }
}
