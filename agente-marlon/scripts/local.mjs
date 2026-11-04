// Sobe tudo para testar localmente: backend demo (porta 3333) + painel (porta 3000).
// Uso: npm run local   (Windows, Mac e Linux)
// O painel roda em modo produção (build + start): não fica vigiando arquivos, então funciona
// mesmo em pastas sincronizadas (OneDrive, Dropbox). Para editar o painel com recarga automática: npm run panel:dev
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
const run = (args, label) =>
  new Promise((ok, fail) =>
    spawn("npm", args, { stdio: "inherit", shell: true, env }).on("exit", (c) => (c === 0 ? ok() : fail(new Error(`falha em: ${label}`)))),
  );

if (!existsSync("panel/node_modules")) {
  console.log("Instalando as dependências do painel (só na primeira vez)...");
  await run(["--prefix", "panel", "install"], "instalar o painel");
}
console.log("Preparando o painel (leva cerca de 1 minuto)...");
await run(["--prefix", "panel", "run", "build"], "build do painel");

const procs = [
  ["backend", ["run", "demo"]],
  ["painel ", ["--prefix", "panel", "run", "start"]],
].map(([name, args]) => {
  const p = spawn("npm", args, { shell: true, env });
  const out = (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`));
  p.stdout.on("data", out);
  p.stderr.on("data", out);
  return p;
});

setTimeout(() => {
  console.log("\n==============================================================");
  console.log("  Abra: http://localhost:3000/simulador");
  console.log("  Login: demo@equipe.local  /  senha: demo-senha-123");
  console.log("  Para parar: Ctrl+C");
  console.log("==============================================================\n");
}, 6000);

const stop = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
