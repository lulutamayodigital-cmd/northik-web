// Aviso interno por correo (mismo binding EMAIL y destino que los avisos del formulario de contacto).
import { EmailMessage } from "cloudflare:email";

function b64(s) {
  const bs = new TextEncoder().encode(s);
  let bin = ""; for (const b of bs) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function avisoInterno(env, asunto, lineas) {
  if (!env.EMAIL || !env.AVISO_PARA) return;
  const de = env.AVISO_DE || "formulario@northik.ai";
  const id = crypto.randomUUID();
  const raw = [
    "From: Agenda Northik <" + de + ">",
    "To: " + env.AVISO_PARA,
    "Subject: =?UTF-8?B?" + b64(asunto) + "?=",
    "Message-ID: <" + id + "@northik.ai>",
    "Date: " + new Date().toUTCString(),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "", b64(lineas.join("\r\n")).replace(/.{76}/g, "$&\r\n"),
  ].join("\r\n");
  await env.EMAIL.send(new EmailMessage(de, env.AVISO_PARA, raw));
}
