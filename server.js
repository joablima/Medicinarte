const express = require("express");
const { decryptRequest, encryptResponse, isSignatureValid } = require("./encryption");
const { getNextScreen } = require("./flow");

const app = express();
// guarda o corpo bruto para validar a assinatura do app
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

const {
  PASSPHRASE = "", APP_SECRET = "", PORT = 3000,
  WHATSAPP_TOKEN = "", PHONE_NUMBER_ID = "1086045857923395",
  FLOW_ID = "", VERIFY_TOKEN = "medicinarte", FLOW_MODE = "draft",
  GRAPH_VERSION = "v21.0",
} = process.env;
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

// ----- Webhook: mensagens recebidas (POST) -> envia o Flow -----
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // responde rápido para a Meta
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    // só dispara em mensagem de TEXTO do cliente (evita loop ao concluir o flow)
    if (msg && msg.type === "text") {
      console.log("Mensagem recebida de", msg.from, "->", msg.text?.body);
      await sendFlow(msg.from);
    }
  } catch (e) { console.error("Erro no webhook:", e.message); }
});

async function sendFlow(to) {
  if (!WHATSAPP_TOKEN || !FLOW_ID) { console.error("Falta WHATSAPP_TOKEN ou FLOW_ID."); return; }
  const body = {
    messaging_product: "whatsapp", to, type: "interactive",
    interactive: {
      type: "flow",
      header: { type: "text", text: "Medicinarte" },
      body: { text: "Olá! 👋 Toque no botão para consultar exames, valores, preparos e solicitar seu agendamento." },
      footer: { text: "Medicinarte Diagnóstico por Imagem" },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_token: "medicinarte-" + Date.now(),
          flow_id: FLOW_ID,
          flow_cta: "Começar",
          flow_action: "navigate",
          flow_action_payload: { screen: "WELCOME" },
          mode: FLOW_MODE,
        },
      },
    },
  };
  const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log("sendFlow:", r.status, await r.text());
}

app.listen(PORT, () => console.log(`Servidor Medicinarte ouvindo na porta ${PORT}`));
