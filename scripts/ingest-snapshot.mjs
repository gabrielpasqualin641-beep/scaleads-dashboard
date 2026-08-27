#!/usr/bin/env node
/**
 * Envia um payload bruto do MCP Meta Ads para o backend.
 *
 *   node scripts/ingest-snapshot.mjs caminho/para/payload.json
 *
 * Autentica com MCP_INGEST_KEY do .env — não precisa de sessão nem de senha.
 * O payload é exatamente o que as ferramentas do MCP devolvem; a conversão
 * acontece no servidor, em buildSnapshot.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// fileURLToPath lida com espaços no caminho e com o formato do Windows.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEnv(name) {
  if (process.env[name]) return process.env[name];
  try {
    const raw = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8');
    const line = raw.split('\n').find(l => l.trim().startsWith(`${name}=`));
    return line ? line.slice(line.indexOf('=') + 1).trim() : '';
  } catch {
    return '';
  }
}

const payloadPath = process.argv[2];
if (!payloadPath) {
  console.error('Uso: node scripts/ingest-snapshot.mjs <payload.json>');
  process.exit(1);
}

const key = readEnv('MCP_INGEST_KEY');
if (!key) {
  console.error('MCP_INGEST_KEY ausente no .env. Gere uma e rode de novo.');
  process.exit(1);
}

const port = readEnv('PORT') || '3001';
const url = `http://localhost:${port}/api/meta-mcp/snapshot`;

let payload;
try {
  payload = fs.readFileSync(path.resolve(payloadPath), 'utf-8');
  JSON.parse(payload);
} catch (err) {
  console.error(`Payload inválido em ${payloadPath}: ${err.message}`);
  process.exit(1);
}

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ingest-key': key },
    body: payload
  });

  const json = await res.json().catch(() => null);

  if (!res.ok || !json?.success) {
    console.error(`Falha na ingestão (HTTP ${res.status}): ${json?.error || 'resposta inesperada'}`);
    process.exit(1);
  }

  const { accountsIngested, catalogSize, accounts } = json.data;
  console.log(`Ingestão concluída: ${accountsIngested} contas, ${catalogSize} no catálogo.`);
  for (const acc of accounts.filter(a => a.dailyRows > 0)) {
    console.log(`  ${acc.name}: ${acc.dailyRows} dias, ${acc.campaigns} camp, ${acc.adSets} conj, ${acc.ads} anúncios`);
  }
} catch (err) {
  console.error(`Não foi possível falar com o backend em ${url}: ${err.message}`);
  console.error('O servidor precisa estar rodando (npm run dev).');
  process.exit(1);
}
