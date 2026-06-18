const DB = require("./data/procedimentos.json");
const DIAS = ["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];
const ATEND = { id: "atendente", title: "🗣️ Falar com atendente" };

const startOfToday = () => { const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); };
function dateLimits() {
  const min = startOfToday(), max = min + 90*864e5, un = [];
  for (let t=min; t<=max; t+=864e5) if (new Date(t).getDay()===0) un.push(String(t));
  return { min_date:String(min), max_date:String(max), unavailable_dates:un };
}
function timeSlots() {
  const out=[]; for (let h=7; h<19; h++) for (const m of ["00","30"]) {
    const hh=String(h).padStart(2,"0"); out.push({ id:`${hh}:${m}`, title:`${hh}:${m}` });
  } return out;
}
const fmtDay = ms => { const d=new Date(Number(ms)); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()} (${DIAS[d.getDay()]})`; };
const fmtDate = ms => { const d=new Date(Number(ms)); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; };

function variantOf(baseId, variantId) {
  const base = DB.bases[baseId];
  if (!base) return null;
  if (variantId && DB.variants[variantId]) return variantId;
  return base.variants[0].id; // única
}
function detailScreen(variantId, plano) {
  const v = DB.variants[variantId];
  const base = DB.bases[variantId.split("__").slice(0,3).join("__")];
  const fullName = base.title + (v.spec && v.spec!=="Padrão" ? ` – ${v.spec}` : "");
  const isScheduled = /hora marcada/i.test(v.scheduling_method);
  const agend = isScheduled ? "🗓️ Agendamento por hora marcada (com horário a confirmar)."
                            : "🚶 Atendimento por ordem de chegada (sem horário individual).";
  const pagamento = `Valor particular: ${v.price}\nParcelamento: ${v.installments}\nFormas de pagamento: ${v.payment_methods}`;
  let situacao, header;
  if (!plano || plano==="none") { situacao="1"; header = pagamento; }
  else {
    const cobre = (v.convenios||[]).some(c => c.toLowerCase()===String(plano).toLowerCase());
    if (cobre) { situacao="2"; header = `✅ Procedimento coberto pelo seu plano (${plano}).`; }
    else { situacao="3"; header = `⚠️ Este procedimento NÃO é coberto pelo plano ${plano}.\n\n${pagamento}`; }
  }
  return {
    screen: "PROCEDURE_DETAILS",
    data: {
      procedure_name: fullName, header_info: header, scheduling_info: agend,
      preparation: v.preparation, contraindications: v.contraindications, documents: v.documents,
      delivery_time: v.delivery_time, age_range: v.age_range, duration: v.duration,
      variant: variantId, plano: String(plano||"none"),
      has_plan: !!plano && plano!=="none", is_scheduled: isScheduled,
      scheduling_method: v.scheduling_method, situacao
    }
  };
}

function getNextScreen(body) {
  const { screen, action, data = {} } = body;
  if (action === "ping") return { data: { status: "active" } };
  if (data.error) return { data: { acknowledged: true } };
  if (action === "INIT") return { screen: "WELCOME", data: {} };
  if (action !== "data_exchange") return { screen: "WELCOME", data: {} };

  // atalho global: falar com atendente
  if (data.need === "atendente" || data.decision === "atendente")
    return { screen: "ATTENDANT", data: { reason: "Falar com atendente" } };

  switch (screen) {
    case "NEED": {
      if (data.need === "agendar_exame") return { screen: "CHOOSE_MODALITY", data: { modalities: DB.modalities } };
      if (data.need === "resultado_exame") return { screen: "ATTENDANT", data: { reason: "Resultado de exame" } };
      if (data.need === "informacoes") return { screen: "INFO", data: {} };
      return { screen: "CHOOSE_MODALITY", data: { modalities: DB.modalities } };
    }
    case "CHOOSE_MODALITY": {
      const mid = data.modality; const t = DB.tree[mid];
      if (!t) return { screen: "CHOOSE_MODALITY", data: { modalities: DB.modalities } };
      if (t.has_bodyparts)
        return { screen: "CHOOSE_BODYPART", data: { modality: mid, bodyparts: t.bodyparts } };
      return { screen: "CHOOSE_PROCEDURE", data: { modality: mid, bodypart: "_", procedures: t.procedures } };
    }
    case "CHOOSE_BODYPART": {
      if (data.bodypart === "atendente") return { screen: "ATTENDANT", data: { reason: "Falar com atendente" } };
      const t = DB.tree[data.modality];
      const procs = t.procedures_by_bodypart[data.bodypart] || [];
      return { screen: "CHOOSE_PROCEDURE", data: { modality: data.modality, bodypart: data.bodypart, procedures: procs } };
    }
    case "CHOOSE_PROCEDURE": {
      if (data.base === "atendente") return { screen: "ATTENDANT", data: { reason: "Falar com atendente" } };
      const base = DB.bases[data.base];
      if (!base) return { screen: "CHOOSE_MODALITY", data: { modalities: DB.modalities } };
      if (base.variants.length > 1) {
        const opts = base.variants.map(v => ({ id: v.id, title: v.spec }));
        return { screen: "CHOOSE_SPECIFICITY", data: { base: data.base, base_title: base.title, specificities: opts } };
      }
      const variantId = base.variants[0].id;
      return { screen: "CHOOSE_PLAN", data: { variant: variantId, planos: planOptions() } };
    }
    case "CHOOSE_SPECIFICITY": {
      if (data.variant === "atendente") return { screen: "ATTENDANT", data: { reason: "Falar com atendente" } };
      return { screen: "CHOOSE_PLAN", data: { variant: data.variant, planos: planOptions() } };
    }
    case "CHOOSE_PLAN": {
      if (data.plano === "atendente") return { screen: "ATTENDANT", data: { reason: "Falar com atendente" } };
      return detailScreen(data.variant, data.plano);
    }
    case "PROCEDURE_DETAILS": {
      const d = data.decision;
      if (d === "consultar_outro") return { screen: "CHOOSE_MODALITY", data: { modalities: DB.modalities } };
      if (d === "encerrar") return { screen: "END", data: {} };
      if (d === "atendente") return { screen: "ATTENDANT", data: { reason: "Falar com atendente" } };
      // agendar -> coletar dados
      return { screen: "COLLECT_DATA", data: {
        procedure_name: data.procedure_name, variant: data.variant, plano: data.plano,
        has_plan: data.has_plan === true || data.has_plan === "true",
        is_scheduled: data.is_scheduled === true || data.is_scheduled === "true",
        scheduling_method: data.scheduling_method,
        time_slots: timeSlots(), max_dob: String(startOfToday()), ...dateLimits()
      }};
    }
    case "COLLECT_DATA": {
      const isSched = data.is_scheduled === true || data.is_scheduled === "true";
      const common = {
        procedure_name: data.procedure_name, name: data.nome || "",
        cpf: data.cpf || "", carteira: data.carteira || "",
        nascimento: data.nascimento ? fmtDate(data.nascimento) : "",
        appointment_day: data.data_agendamento ? fmtDay(data.data_agendamento) : "-"
      };
      if (isSched) return { screen: "CONFIRM_APPOINTMENT", data: { ...common, horario: data.horario || "-" } };
      return { screen: "CONFIRM_WALKIN", data: { ...common,
        business_hours: data.data_agendamento ? (new Date(Number(data.data_agendamento)).getDay()===6 ? "07:00 às 20:00" : "07:00 às 22:00") : "-" } };
    }
    case "ATTENDANT": {
      return { screen: "CONFIRM_ATTENDANT", data: { name: data.nome || "" } };
    }
    default:
      return { screen: "WELCOME", data: {} };
  }
}
function planOptions() {
  return [{ id: "none", title: "Não possuo plano de saúde" }, ...DB.planos.map(p => ({ id: p, title: p }))];
}

module.exports = { getNextScreen };
