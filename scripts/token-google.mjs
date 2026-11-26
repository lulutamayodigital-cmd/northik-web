// Obtiene el refresh token de Google (Calendar + Sheets) y lo guarda como secreto de Cloudflare
// (GOOGLE_NK_CLIENT_SECRET y GOOGLE_NK_REFRESH_TOKEN).
// Si AGENDA_SHEET_ID o CREADORES_SHEET_ID están vacíos en wrangler.jsonc, crea esas hojas privadas
// («Northik · Agenda» y «Northik · Creadores») en el Drive de la cuenta y anota su ID.
// Al final revisa que pueda leer las horas ocupadas de los calendarios de AGENDA_CALENDARIOS.
// Uso:  node scripts/token-google.mjs           (con --local guarda además una copia en .dev.vars para probar)
// - Cuando se abra Google, inicia sesión con la cuenta de Northik indicada en la documentación privada.
// - El token nunca se muestra ni se escribe en disco: va directo a `wrangler secret put`.
// Requisitos: GOOGLE_CLIENT_ID en wrangler.jsonc y, en Google Cloud, la URI de redirección
// http://127.0.0.1:8765/callback autorizada en el cliente OAuth (tipo "Aplicación web").
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawn, execFile, execFileSync } from "node:child_process";
import readline from "node:readline";
import { CONFIG } from "../worker/agenda-config.js";
import { HOJA_CREADORES } from "../worker/hoja-creadores.js";

const PUERTO = 8765;
const REDIRECCION = `http://127.0.0.1:${PUERTO}/callback`;
const ALCANCES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  // Solo hojas de cálculo (no da acceso al resto de archivos del Drive).
  "https://www.googleapis.com/auth/spreadsheets",
].join(" ");

// Crea una hoja privada (no se comparte con nadie) con una pestaña y sus títulos en negrita.
async function crearHoja(accessToken, { nombre, pestana, columnas }) {
  const r = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: { authorization: "Bearer " + accessToken, "content-type": "application/json" },
    body: JSON.stringify({
      properties: { title: nombre, locale: "es_CO", timeZone: "America/Bogota" },
      sheets: [{
        properties: { title: pestana, gridProperties: { frozenRowCount: 1, columnCount: columnas.length } },
        data: [{ startRow: 0, startColumn: 0, rowData: [{ values: columnas.map((c) => ({
          userEnteredValue: { stringValue: c }, userEnteredFormat: { textFormat: { bold: true } },
        })) }] }],
      }],
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`No se pudo crear la hoja «${nombre}»: ` + (j.error?.message || r.status));
  return j.spreadsheetId;
}

// Revisa que el token pueda leer las horas ocupadas de cada calendario (no muestra ningún evento).
async function revisarCalendarios(accessToken, ids) {
  const ahora = new Date();
  const r = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { authorization: "Bearer " + accessToken, "content-type": "application/json" },
    body: JSON.stringify({ timeMin: ahora.toISOString(), timeMax: new Date(+ahora + 7 * 864e5).toISOString(),
      items: ids.map((id) => ({ id })) }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("No se pudieron revisar los calendarios: " + (j.error?.message || r.status));
  ids.forEach((id, i) => {
    const errores = j.calendars?.[id]?.errors;
    const nombre = i === 0 ? "calendario de citas" : id === "primary" ? "calendario principal" : `calendario ${i + 1}`;
    console.log(errores?.length ? `✗ ${nombre}: sin acceso (${errores.map((e) => e.reason).join(", ")})` : `✓ ${nombre}: se pueden leer las horas ocupadas`);
  });
}

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


// Copia local para probar con `npx wrangler dev` y Google real (solo con permiso, y se borra al terminar).
// Solo escribe si .dev.vars está en .gitignore; desactiva el modo simulado (GOOGLE_MOCK) mientras tanto.
function guardarEnDevVars(valores) {
  const ruta = new URL("../.dev.vars", import.meta.url);
  try {
    execFileSync("git", ["check-ignore", "-q", ".dev.vars"], { cwd: new URL("..", import.meta.url) });
  } catch {
    console.error("✗ .dev.vars no está en .gitignore: no guardé la copia local.");
    return;
  }
  const nombres = Object.keys(valores);
  const lineas = (fs.existsSync(ruta) ? fs.readFileSync(ruta, "utf8") : "").split("\n")
    .filter((l) => l && !nombres.some((n) => l.startsWith(n + "=")))
    .map((l) => (l.startsWith("GOOGLE_MOCK=") ? "# " + l + "  (desactivado para la prueba con Google real)" : l));
  for (const n of nombres) lineas.push(`${n}=${valores[n]}`);
  fs.writeFileSync(ruta, lineas.join("\n") + "\n", { mode: 0o600 });
  console.log("✓ Copia local en .dev.vars para la prueba (está en .gitignore). Bórrala al terminar.");
}

const clientSecret = await preguntarOculto("Pega el client secret de Google (no se mostrará): ");
if (!/^GOCSPX-[A-Za-z0-9_-]{20,}$/.test(clientSecret)) {
  console.error(`Eso no parece un client secret (debe empezar por GOCSPX-; recibí ${clientSecret.length} caracteres). Vuelve a copiarlo.`);
  process.exit(1);
}
const estado = crypto.randomBytes(16).toString("hex");
const verificador = crypto.randomBytes(32).toString("base64url");
const reto = crypto.createHash("sha256").update(verificador).digest("base64url");

const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
url.search = new URLSearchParams({
  client_id: clientId, redirect_uri: REDIRECCION, response_type: "code", scope: ALCANCES,
  access_type: "offline", prompt: "consent",
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
    if (!(j.scope || "").includes("spreadsheets") || !(j.scope || "").includes("calendar.events")) {
      throw new Error("Falta algún permiso. Vuelve a correr el script y marca todas las casillas en Google.");
    }
    let actual = fs.readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    for (const [variable, hoja] of [["AGENDA_SHEET_ID", CONFIG.hoja], ["CREADORES_SHEET_ID", HOJA_CREADORES]]) {
      const vacio = new RegExp(`"${variable}":\\s*""`);
      if (!vacio.test(actual)) continue;
      const id = await crearHoja(j.access_token, hoja);
      actual = actual.replace(vacio, `"${variable}": "${id}"`);
      fs.writeFileSync(new URL("../wrangler.jsonc", import.meta.url), actual);
      console.log(`Hoja «${hoja.nombre}» creada (privada). Su ID quedó en wrangler.jsonc.`);
    }
    const calendarios = ((actual.match(/"AGENDA_CALENDARIOS":\s*"([^"]*)"/) || [])[1] || "primary").split(",").map((c) => c.trim()).filter(Boolean);
    await revisarCalendarios(j.access_token, calendarios);
    if (process.argv.includes("--local")) {
      guardarEnDevVars({ GOOGLE_NK_CLIENT_SECRET: clientSecret, GOOGLE_NK_REFRESH_TOKEN: j.refresh_token });
    }
    console.log("Guardando secretos en Cloudflare…");
    await guardarSecreto("GOOGLE_NK_CLIENT_SECRET", clientSecret);
    await guardarSecreto("GOOGLE_NK_REFRESH_TOKEN", j.refresh_token);
    console.log("Hecho. Los secretos nuevos quedaron en Cloudflare; la web publicada los usa cuando esta rama llegue a main.");
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
