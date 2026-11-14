// Obtiene el refresh token de Google Calendar (una sola vez) y lo guarda como secreto de Cloudflare.
// Uso:  node scripts/token-google.mjs
// - Inicia sesión con northik.admin@gmail.com cuando se abra Google.
// - El token nunca se muestra ni se escribe en disco: va directo a `wrangler secret put`.
// Requisitos: GOOGLE_CLIENT_ID en wrangler.jsonc y, en Google Cloud, la URI de redirección
// http://127.0.0.1:8765/callback autorizada en el cliente OAuth (tipo "Aplicación web").
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawn, execFile } from "node:child_process";
import readline from "node:readline";

const PUERTO = 8765;
const REDIRECCION = `http://127.0.0.1:${PUERTO}/callback`;
const ALCANCES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
].join(" ");

const config = fs.readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const clientId = (config.match(/"GOOGLE_CLIENT_ID":\s*"([^"]*)"/) || [])[1];
if (!clientId) {
  console.error("Falta GOOGLE_CLIENT_ID en wrangler.jsonc.");
  process.exit(1);
}

function preguntarOculto(texto) {
  return new Promise((ok) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(texto)) process.stdout.write(s); };
    rl.question(texto, (r) => { rl.close(); process.stdout.write("\n"); ok(r.trim()); });
  });
}

function guardarSecreto(nombre, valor) {
  return new Promise((ok, mal) => {
    const p = spawn("npx", ["wrangler", "secret", "put", nombre], { stdio: ["pipe", "inherit", "inherit"] });
    p.stdin.end(valor);
    p.on("close", (c) => (c === 0 ? ok() : mal(new Error(`wrangler salió con código ${c}`))));
  });
}

const clientSecret = await preguntarOculto("Pega el client secret de Google (no se mostrará): ");
const estado = crypto.randomBytes(16).toString("hex");
const verificador = crypto.randomBytes(32).toString("base64url");
const reto = crypto.createHash("sha256").update(verificador).digest("base64url");

const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
url.search = new URLSearchParams({
  client_id: clientId, redirect_uri: REDIRECCION, response_type: "code", scope: ALCANCES,
  access_type: "offline", prompt: "consent", login_hint: "northik.admin@gmail.com",
  state: estado, code_challenge: reto, code_challenge_method: "S256",
});

const servidor = http.createServer(async (req, res) => {
  const u = new URL(req.url, REDIRECCION);
  if (u.pathname !== "/callback") { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  if (u.searchParams.get("state") !== estado || !u.searchParams.get("code")) {
    res.end("No se pudo completar. Vuelve a la terminal.");
    console.error("Respuesta inválida de Google:", u.searchParams.get("error") || "estado distinto");
    servidor.close(); process.exitCode = 1; return;
  }
  res.end("Listo. Ya puedes cerrar esta pestaña y volver a la terminal.");
  servidor.close();
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: u.searchParams.get("code"), client_id: clientId, client_secret: clientSecret,
        redirect_uri: REDIRECCION, grant_type: "authorization_code", code_verifier: verificador,
      }),
    });
    const j = await r.json();
    if (!j.refresh_token) throw new Error(`Google no devolvió refresh token (${j.error || r.status})`);
    console.log("Guardando secretos en Cloudflare…");
    await guardarSecreto("GOOGLE_CLIENT_SECRET", clientSecret);
    await guardarSecreto("GOOGLE_REFRESH_TOKEN", j.refresh_token);
    console.log("Hecho. La agenda ya puede leer y crear eventos en el calendario.");
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
});

servidor.listen(PUERTO, "127.0.0.1", () => {
  console.log("Abriendo Google para dar el permiso. Si no se abre, copia esta dirección en el navegador:\n");
  console.log(url.toString() + "\n");
  execFile("open", [url.toString()], () => {});
});
