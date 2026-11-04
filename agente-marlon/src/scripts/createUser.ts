// Uso: npm run user:create -- email@dominio.com "Nome" "senha-forte"
import bcrypt from "bcryptjs";
import { buildApp } from "../app.js";

const [email, name, password] = process.argv.slice(2);
if (!email || !name || !password || password.length < 10) {
  console.error('Uso: npm run user:create -- email "Nome" "senha com 10+ caracteres"');
  process.exit(1);
}
const { deps } = buildApp({ dialer: null });
await deps.store.createUser({ email: email.toLowerCase(), name, passwordHash: await bcrypt.hash(password, 12) });
console.log(`Usuário ${email} criado.`);
process.exit(0);
