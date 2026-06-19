const express = require("express");
const fs = require("fs");
const path = require("path");
const { decryptRequest, encryptResponse, isSignatureValid } = require("./encryption");
const { getNextScreen } = require("./flow");

const app = express();
// guarda o corpo bruto para validar a assinatura do app
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
// serve arquivos estáticos (ex.: logo) em /public  -> https://SEU_DOMINIO/logo.png
app.use(express.static(path.join(__dirname, "public")));

const {
  PASSPHRASE = "", APP_SECRET = "", PORT = 3000,
  WHATSAPP_TOKEN = "", PHONE_NUMBER_ID = "1086045857923395",
  FLOW_ID = "", VERIFY_TOKEN = "medicinarte", FLOW_MODE = "draft",
  GRAPH_VERSION = "v21.0",
  PUBLIC_BASE_URL = "https://medicinarte.onrender.com", LOGO_URL = "",
} = process.env;
// URL do logo: usa LOGO_URL se definido; senão, usa public/logo.png se existir
const logoUrl = LOGO_URL || (fs.existsSync(path.join(__dirname, "public", "logo.png")) ? `${PUBLIC_BASE_URL}/logo.png` : "");
// aceita a chave com quebras reais OU com \n literais (formato comum em variáveis de ambiente)
const PRIVATE_KEY = (process.env.PRIVATE_KEY || "").replace(/\\n/g, "\n");

app.get("/", (_req, res) => res.status(200).send("Endpoint do WhatsApp Flow da Medicinarte no ar."));

// ----- Endpoint de dados do Flow (telas) -----
app.post("/", async (req, res) => {
  if (!PRIVATE_KEY) { console.error("PRIVATE_KEY não configurada."); return res.status(500).send(); }
  if (!isSignatureValid(req.rawBody, req.get("x-hub-signature-256"), APP_SECRET)) return res.status(432).send();
  let decryptedBody, aesKeyBuffer, ivBuffer;
  try {
    ({ decryptedBody, aesKeyBuffer, ivBuffer } = decryptRequest(req.body, PRIVATE_KEY, PASSPHRASE));
  } catch (err) { console.error(err.message); return res.status(err.statusCode || 500).send(); }
  const responsePayload = getNextScreen(decryptedBody);
  res.status(200).send(encryptResponse(responsePayload, aesKeyBuffer, ivBuffer));
});

// ----- Webhook: verificação (GET) -----
app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN)
    return res.status(200).send(req.query["hub.challenge"]);
  return res.sendStatus(403);
});

// ----- Modo atendente: clientes que escolheram "Falar com atendente" -----
const attendantMode = new Map(); // from -> timestamp
const ATTENDANT_TTL = 12 * 60 * 60 * 1000; // 12 horas

// ----- Webhook: mensagens recebidas (POST) -> envia o Flow -----
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // responde rápido para a Meta
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg) return;
    const from = msg.from;

    // Conclusão de um Flow (resposta enviada pelo cliente) — contém os dados preenchidos
    if (msg.type === "interactive" && msg.interactive?.type === "nfm_reply") {
      let resp = {};
      try { resp = JSON.parse(msg.interactive.nfm_reply.response_json || "{}"); } catch {}
      console.log("Flow concluído por", from, "->", JSON.stringify(resp));
      if (resp.status === "atendente") {
        attendantMode.set(from, Date.now());
        console.log(from, "entrou em modo atendente — flow não será reenviado automaticamente.");
      }
      return; // nunca reenvia o flow ao receber uma conclusão
    }

    // Mensagem de texto -> envia o Flow, exceto se o cliente está em atendimento humano
    if (msg.type === "text") {
      const since = attendantMode.get(from);
      if (since && Date.now() - since < ATTENDANT_TTL) {
        console.log("Ignorado (modo atendente):", from);
        return;
      }
      if (since) attendantMode.delete(from); // expirou
      console.log("Mensagem de", from, "->", msg.text?.body);
      await sendFlow(from);
    }
  } catch (e) { console.error("Erro no webhook:", e.message); }
});

async function sendFlow(to) {
  if (!WHATSAPP_TOKEN || !FLOW_ID) { console.error("Falta WHATSAPP_TOKEN ou FLOW_ID."); return; }
  const interactive = {
    type: "flow",
    header: logoUrl ? { type: "image", image: { link: logoUrl } } : { type: "text", text: "Medicinarte" },
    body: { text: "Olá, que bom ter você por aqui! Por aqui, você terá acesso a todos os nossos serviços. 💙\n\nClique em iniciar atendimento para fazer o seu agendamento, ver resultados de exames ou tirar dúvidas com nossos atendentes." },
    action: {
      name: "flow",
      parameters: {
        flow_message_version: "3",
        flow_token: "medicinarte-" + Date.now(),
        flow_id: FLOW_ID,
        flow_cta: "Iniciar Atendimento",
        flow_action: "navigate",
        flow_action_payload: { screen: "WELCOME" },
        mode: FLOW_MODE,
      },
    },
  };
  const body = { messaging_product: "whatsapp", to, type: "interactive", interactive };
  const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log("sendFlow:", r.status, await r.text());
}

app.listen(PORT, () => console.log(`Servidor Medicinarte ouvindo na porta ${PORT}`));
