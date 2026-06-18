const express = require("express");
const { decryptRequest, encryptResponse, isSignatureValid } = require("./encryption");
const { getNextScreen } = require("./flow");

const app = express();
// guarda o corpo bruto para validar a assinatura do app
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

const { PRIVATE_KEY, PASSPHRASE = "", APP_SECRET = "", PORT = 3000 } = process.env;

app.get("/", (_req, res) => res.status(200).send("Endpoint do WhatsApp Flow da Medicinarte no ar."));

app.post("/", async (req, res) => {
  if (!PRIVATE_KEY) {
    console.error("PRIVATE_KEY não configurada.");
    return res.status(500).send();
  }
  // valida assinatura (se APP_SECRET estiver definido)
  if (!isSignatureValid(req.rawBody, req.get("x-hub-signature-256"), APP_SECRET)) {
    return res.status(432).send(); // assinatura inválida
  }

  let decryptedBody, aesKeyBuffer, ivBuffer;
  try {
    ({ decryptedBody, aesKeyBuffer, ivBuffer } =
      decryptRequest(req.body, PRIVATE_KEY, PASSPHRASE));
  } catch (err) {
    console.error(err.message);
    return res.status(err.statusCode || 500).send();
  }

  const responsePayload = getNextScreen(decryptedBody);
  const encrypted = encryptResponse(responsePayload, aesKeyBuffer, ivBuffer);
  res.status(200).send(encrypted);
});

app.listen(PORT, () => console.log(`Endpoint Medicinarte ouvindo na porta ${PORT}`));
