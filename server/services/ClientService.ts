import { db } from '../db/database.js';
import { Client, AdAccount } from '../models/types.js';

export class ClientService {
  public static getAll(): Client[] {
    return db.getClients();
  }

  public static getById(id: string): Client | undefined {
    return db.getClientById(id);
  }

  public static create(clientData: {
    name: string;
    companyName: string;
    email: string;
    phone: string;
    avatarUrl?: string;
  }): Client {
    return db.createClient({
      organizationId: 'org_scale_01',
      name: clientData.name,
      companyName: clientData.companyName,
      email: clientData.email,
      phone: clientData.phone,
      avatarUrl: clientData.avatarUrl,
      status: 'active'
    });
  }

  public static update(id: string, updates: Partial<Client>): Client | null {
    return db.updateClient(id, updates);
  }

  public static delete(id: string): boolean {
    return db.deleteClient(id);
  }

  public static getAccounts(clientId: string): AdAccount[] {
    return db.getAccountsByClient(clientId);
  }
}
