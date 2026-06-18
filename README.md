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

---

## Passo 1 — Gerar o par de chaves RSA
No terminal:
```
openssl genrsa -des3 -out private.pem 2048      # pede uma passphrase — guarde-a
openssl rsa -in private.pem -outform PEM -pubout -out public.pem
```
- `private.pem` → vai para a variável `PRIVATE_KEY` do servidor (NUNCA compartilhe).
- `public.pem` → enviado à Meta no Passo 3.

## Passo 2 — Publicar o servidor (Render)
1. Suba esta pasta para um repositório no **GitHub** (Render faz deploy a partir do Git).
2. Acesse render.com → **New → Web Service** → conecte o repositório.
   - Runtime: **Node**; Build: `npm install`; Start: `node server.js`; Plan: **Free**.
   - (Se o Render detectar o `render.yaml`, ele já preenche tudo via Blueprint.)
3. Em **Environment**, defina as variáveis:
   - `PRIVATE_KEY` = conteúdo de `private.pem` (com `\n` nas quebras de linha, entre aspas)
   - `PASSPHRASE` = a senha definida no Passo 1
   - `APP_SECRET` = (opcional) app secret do app da Meta
   - Não precisa definir `PORT` — o Render injeta automaticamente.
4. Após o deploy, a URL pública (ex.: `https://medicinarte-flow-endpoint.onrender.com/`) é o seu **endpoint**.
   - Teste no navegador: deve responder "Endpoint ... no ar."
   - Obs.: no plano gratuito o serviço "hiberna" após inatividade e leva alguns segundos para acordar na primeira chamada — normal para testes.

## Passo 3 — Enviar a chave pública para a Meta ("Assinar chave pública")
> ATENÇÃO: a chave é registrada no **PHONE NUMBER ID** (ID do número), **não** no ID da conta (WABA).
> Para descobrir o Phone Number ID: `GET /v21.0/<WABA_ID>/phone_numbers`.
> No caso desta conta, o Phone Number ID é **1086045857923395** (Jardel Despachante, +55 11 97877-7953).

Enviar a chave pública (rode no diretório onde está o `public.pem`):
```
curl -X POST 'https://graph.facebook.com/v21.0/<PHONE_NUMBER_ID>/whatsapp_business_encryption' \
  -H 'Authorization: Bearer <TOKEN>' \
  --data-urlencode "business_public_key=$(cat public.pem)"
```
Resposta esperada: `{"success":true}`.

Conferir (o `business_public_key_signature_status` deve ficar `VALID`):
```
curl -X GET 'https://graph.facebook.com/v21.0/<PHONE_NUMBER_ID>/whatsapp_business_encryption' \
  -H 'Authorization: Bearer <TOKEN>'
```

## Passo 4 — Definir o URI do ponto de extremidade
No painel do Flow (a tela que você mostrou), cole a URL do Render em **"Definir URI do ponto de extremidade"** e clique em **Enviar**.

## Passo 5 — Conectar app da Meta e Verificação de integridade
- **Conectar app da Meta:** selecione o app vinculado ao WABA.
- **Verificação de integridade:** a Meta envia `action: "ping"`; o servidor já responde `{"data":{"status":"active"}}`. Se as chaves e a URL estiverem corretas, o check fica verde.

---

## Rodar localmente (opcional, para testar antes)
```
npm install
PRIVATE_KEY="$(cat private.pem)" PASSPHRASE="sua_senha" node server.js
```

## Observações
- O fluxo é **server-driven**: a bifurcação ordem de chegada × hora marcada é decidida aqui no backend, pela coluna **Método de agendamento**.
- Para atualizar preços/preparos, basta regenerar `data/procedimentos.json` a partir da planilha.
- Este endpoint apenas **monta as telas**; ele não grava o agendamento. Se quiser registrar os pedidos (planilha, e-mail, CRM), dá para adicionar no `flow.js`, nos casos `SCHEDULE_WALKIN`/`SCHEDULE_APPOINTMENT`.

---

## Estrutura do fluxo (v2)
1. **WELCOME** → Começar.
2. **NEED** — entende a necessidade: Agendar/consultar exame, Resultado de exame, Informações gerais.
3. **CHOOSE_MODALITY** — toque na modalidade já avança (sem clique extra).
4. **CHOOSE_BODYPART** — só para ressonância/tomografia/ultrassom/raio-x: 4 partes principais + "Outras". (Mamografia pula direto para os procedimentos.)
5. **CHOOSE_PROCEDURE** — mostra só o procedimento principal (ex.: "Coluna cervical").
6. **CHOOSE_SPECIFICITY** — escolha da variante (com/sem contraste, nº de incidências, com/sem sedação...). Pulada quando há só uma opção.
7. **CHOOSE_PLAN** — "Não possuo plano de saúde" (1ª opção) + planos em ordem alfabética.
8. **PROCEDURE_DETAILS** — 3 situações:
   - Sem plano: valor + parcelamento + pagamento primeiro; sem convênios.
   - Plano cobre: "coberto pelo seu plano"; sem valor/convênios.
   - Plano não cobre: aviso + valor particular.
   Em todas: forma de agendamento (ordem de chegada / hora marcada) e opções Agendar, Consultar outro, Encerrar, Falar com atendente.
9. **COLLECT_DATA** — Nome, CPF, carteira do plano (só com plano), data de nascimento, data do exame (bloqueia passado e domingos) e horário (só hora marcada). Telefone não é pedido (usa o número do WhatsApp).
10. **CONFIRM_WALKIN** (ordem de chegada) / **CONFIRM_APPOINTMENT** (hora marcada — avisa que um consultor confirmará o horário).
- **Falar com atendente** em qualquer etapa → **ATTENDANT** → **CONFIRM_ATTENDANT** (consultor responde direto no WhatsApp).

> Para aplicar: faça o push dos arquivos atualizados (flow.js + data/procedimentos.json) para o GitHub (o Render redeploya), e cole o conteúdo de **Fluxo_WhatsApp_Medicinarte.json** no editor do Flow na Meta (substituindo o JSON de exemplo que ainda está lá).
