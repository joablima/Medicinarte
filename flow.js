const DB = require("./data/procedimentos.json");
const DIAS = ["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];

const startOfToday = () => { const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); };
function dateLimits() {
  const min = startOfToday(), max = min + 90*864e5, un = [];
  for (let t=min; t<=max; t+=864e5) if (new Date(t).getDay()===0) un.push(String(t));
  return { min_date:String(min), max_date:String(max), unavailable_dates:un };
}
function timeSlots() {
  const out=[]; for (let h=7; h<19; h++) for (const m of ["00","30"]) { const hh=String(h).padStart(2,"0"); out.push({ id:`${hh}:${m}`, title:`${hh}:${m}` }); }
  return out;
}
const fmtDay = ms => { const d=new Date(Number(ms)); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()} (${DIAS[d.getDay()]})`; };
const fmtDate = ms => { const d=new Date(Number(ms)); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; };
const planOptions = () => [{ id:"none", title:"Não possuo plano de saúde" }, ...DB.planos.map(p => ({ id:p, title:p }))];

function detailScreen(variantId, plano) {
  const v = DB.variants[variantId];
  const base = DB.bases[variantId.split("__").slice(0,3).join("__")];
  const fullName = base.title + (v.spec && v.spec!=="Padrão" ? ` – ${v.spec}` : "");
  const isScheduled = /hora marcada/i.test(v.scheduling_method);
  const agend = isScheduled ? "🗓️ Agendamento por hora marcada (horário a confirmar com a clínica)."
                            : "🚶 Atendimento por ordem de chegada (sem horário individual).";
  const pagamento = `Valor particular: ${v.price}\nParcelamento: ${v.installments}\nFormas de pagamento: ${v.payment_methods}`;
  let situacao, header;
  if (!plano || plano==="none") { situacao="1"; header = pagamento; }
  else {
    const cobre = (v.convenios||[]).some(c => c.toLowerCase()===String(plano).toLowerCase());
    if (cobre) { situacao="2"; header = `✅ Procedimento coberto pelo seu plano (${plano}).`; }
    else { situacao="3"; header = `⚠️ Este procedimento NÃO é coberto pelo plano ${plano}.\n\n${pagamento}`; }
  }
  const info = `Preparo:\n${v.preparation}\n\nContraindicações:\n${v.contraindications}\n\nDocumentos: ${v.documents}\n\nPrazo de entrega: ${v.delivery_time}\n\nFaixa etária: ${v.age_range}\n\nDuração: ${v.duration}`;
  return { screen:"PROCEDURE_DETAILS", data:{
    procedure_name: fullName, header_info: header, scheduling_info: agend, info_text: info,
    variant: variantId, plano: String(plano||"none"),
    has_plan: !!plano && plano!=="none", is_scheduled: isScheduled,
    scheduling_method: v.scheduling_method, situacao
  }};
}

function getNextScreen(body) {
  const { screen, action, data = {} } = body;
  if (action === "ping") return { data:{ status:"active" } };
  if (data.error) return { data:{ acknowledged:true } };
  if (action === "INIT") return { screen:"WELCOME", data:{} };
  if (action !== "data_exchange") return { screen:"WELCOME", data:{} };

  if (data.need === "atendente" || data.decision === "atendente")
    return { screen:"ATTENDANT", data:{ reason:"Falar com atendente" } };

  switch (screen) {
    case "NEED": {
      if (data.need === "resultado_exame") return { screen:"ATTENDANT", data:{ reason:"Resultado de exame" } };
      if (data.need === "informacoes") return { screen:"INFO", data:{} };
      return { screen:"CHOOSE_MODALITY", data:{ modalities: DB.modalities } };
    }
    case "CHOOSE_MODALITY": {
      const t = DB.tree[data.modality];
      if (!t) return { screen:"CHOOSE_MODALITY", data:{ modalities: DB.modalities } };
      if (t.has_bodyparts) return { screen:"CHOOSE_BODYPART", data:{ modality:data.modality, bodyparts:t.bodyparts } };
      return { screen:"CHOOSE_PROCEDURE", data:{ modality:data.modality, bodypart:"_", procedures:t.procedures } };
    }
    case "CHOOSE_BODYPART": {
      const t = DB.tree[data.modality];
      return { screen:"CHOOSE_PROCEDURE", data:{ modality:data.modality, bodypart:data.bodypart, procedures:(t.procedures_by_bodypart[data.bodypart]||[]) } };
    }
    case "CHOOSE_PROCEDURE": {
      const base = DB.bases[data.base];
      if (!base) return { screen:"CHOOSE_MODALITY", data:{ modalities: DB.modalities } };
      if (base.variants.length > 1)
        return { screen:"CHOOSE_SPECIFICITY", data:{ base:data.base, base_title:base.title, specificities: base.variants.map(v=>({id:v.id,title:v.spec})) } };
      return { screen:"CHOOSE_PLAN", data:{ variant:base.variants[0].id, planos:planOptions() } };
    }
    case "CHOOSE_SPECIFICITY":
      return { screen:"CHOOSE_PLAN", data:{ variant:data.variant, planos:planOptions() } };
    case "CHOOSE_PLAN":
      return detailScreen(data.variant, data.plano);
    case "PROCEDURE_DETAILS": {
      const d = data.decision;
      if (d === "consultar_outro") return { screen:"CHOOSE_MODALITY", data:{ modalities: DB.modalities } };
      if (d === "encerrar") return { screen:"END", data:{} };
      return { screen:"COLLECT_DATA", data:{
        procedure_name:data.procedure_name, variant:data.variant, plano:data.plano,
        has_plan: data.has_plan===true || data.has_plan==="true",
        is_scheduled: data.is_scheduled===true || data.is_scheduled==="true",
        scheduling_method:data.scheduling_method,
        time_slots:timeSlots(), max_dob:String(startOfToday()), ...dateLimits() }};
    }
    case "COLLECT_DATA": {
      const isSched = data.is_scheduled===true || data.is_scheduled==="true";
      const name = data.nome || "", proc = data.procedure_name || "";
      const day = data.data_agendamento ? fmtDay(data.data_agendamento) : "-";
      if (isSched) return { screen:"CONFIRM_APPOINTMENT", data:{
        greeting:`Muito obrigado pelas informações, ${name}!`,
        summary:`Exame: ${proc}\nData desejada: ${day}\nHorário desejado: ${data.horario||"-"}`, name }};
      const bh = data.data_agendamento ? (new Date(Number(data.data_agendamento)).getDay()===6 ? "07:00 às 20:00" : "07:00 às 22:00") : "-";
      return { screen:"CONFIRM_WALKIN", data:{
        greeting:`Tudo certo, ${name}!`,
        summary:`Exame: ${proc}\nDia escolhido: ${day}\nHorário de funcionamento: ${bh}\nAtendimento por ordem de chegada.`, name }};
    }
    case "ATTENDANT":
      return { screen:"CONFIRM_ATTENDANT", data:{ greeting:`Obrigado, ${data.nome||""}!` } };
    default:
      return { screen:"WELCOME", data:{} };
  }
}
module.exports = { getNextScreen };
