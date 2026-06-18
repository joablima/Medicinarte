# Endpoint do WhatsApp Flow — Medicinarte

Servidor (Node.js) que alimenta o fluxo dinâmico do WhatsApp com os 230 procedimentos da planilha.
Ele recebe as requisições criptografadas da Meta, decide a próxima tela e responde criptografado.

## Arquivos
- `server.js` — servidor Express (rota `POST /`).
- `flow.js` — lógica das telas (modalidade → procedimento → detalhes → ordem de chegada / hora marcada).
- `encryption.js` — criptografia RSA-OAEP + AES-128-GCM e validação de assinatura.
- `data/procedimentos.json` — base com os 230 procedimentos (exportada da planilha).
- `render.yaml` — configuração de deploy no Render.
- `.env.example` — modelo das variáveis de ambiente.

> Hospedagem: usamos o **Render** (plano gratuito), já que o Glitch foi encerrado em julho/2025.
> Alternativas equivalentes, caso prefira: **Railway**, **Replit** ou **Koyeb** — os passos são análogos (mesmas variáveis de ambiente e mesmo comando de start).
