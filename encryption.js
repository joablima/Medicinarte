const crypto = require("crypto");

// Descriptografa a requisição recebida da Meta (RSA-OAEP + AES-128-GCM)
function decryptRequest(body, privatePem, passphrase) {
  const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;
  const privateKey = crypto.createPrivateKey({ key: privatePem, passphrase });

  let decryptedAesKey;
  try {
    decryptedAesKey = crypto.privateDecrypt(
      { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      Buffer.from(encrypted_aes_key, "base64")
    );
  } catch (err) {
    // Chave privada incorreta -> a Meta espera HTTP 421 para pedir re-handshake
    const e = new Error("Falha ao descriptografar a chave AES (chave privada/passphrase incorretas).");
    e.statusCode = 421;
    throw e;
  }

  const flowDataBuffer = Buffer.from(encrypted_flow_data, "base64");
  const ivBuffer = Buffer.from(initial_vector, "base64");
  const TAG_LENGTH = 16;
  const body_ct = flowDataBuffer.subarray(0, -TAG_LENGTH);
  const tag = flowDataBuffer.subarray(-TAG_LENGTH);

  const decipher = crypto.createDecipheriv("aes-128-gcm", decryptedAesKey, ivBuffer);
  decipher.setAuthTag(tag);
  const decryptedJSON = Buffer.concat([decipher.update(body_ct), decipher.final()]).toString("utf-8");

  return { decryptedBody: JSON.parse(decryptedJSON), aesKeyBuffer: decryptedAesKey, ivBuffer };
}

// Criptografa a resposta (mesma chave AES, IV invertido)
function encryptResponse(response, aesKeyBuffer, ivBuffer) {
  const flippedIv = Buffer.from(ivBuffer.map((b) => ~b));
  const cipher = crypto.createCipheriv("aes-128-gcm", aesKeyBuffer, flippedIv);
  return Buffer.concat([
    cipher.update(JSON.stringify(response), "utf-8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
}

// Validação opcional da assinatura do app (x-hub-signature-256)
function isSignatureValid(rawBody, signatureHeader, appSecret) {
  if (!appSecret) return true; // se não configurado, pula
  if (!signatureHeader) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch { return false; }
}

module.exports = { decryptRequest, encryptResponse, isSignatureValid };
