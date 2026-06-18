const DB = require("./data/procedimentos.json");
const DIAS = ["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];
const pad = n => String(n).padStart(2,"0");
const todayUTC = () => { const d=new Date(); d.setUTCHours(0,0,0,0); return d; };
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;

// aceita valor do DatePicker em YYYY-MM-DD ou em ms
function parseInput(v){
  if(v===undefined||v===null||v==="") return null;
  if(typeof v==="string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return new Date(v.slice(0,10)+"T12:00:00Z");
  if(/^\d+$/.test(String(v))) return new Date(Number(v));
  const d=new Date(v); return isNaN(d)?null:d;
}
const fmtDay = v => { const d=parseInput(v); return d?`${pad(d.getUTCDate())}/${pad(d.getUTCMonth()+1)}/${d.getUTCFullYear()} (${DIAS[d.getUTCDay()]})`:"-"; };
const fmtDate = v => { const d=parseInput(v); return d?`${pad(d.getUTCDate())}/${pad(d.getUTCMonth()+1)}/${d.getUTCFullYear()}`:""; };

function dateLimits(){
  const min=todayUTC(); const max=new Date(min); max.setUTCDate(max.getUTCDate()+90);
  const un=[]; for(let t=new Date(min); t<=max; t.setUTCDate(t.getUTCDate()+1)) if(t.getUTCDay()===0) un.push(ymd(t));
  return { min_date:ymd(min), max_date:ymd(max), unavailable_dates:un };
}
function timeSlots(){ const o=[]; for(let h=7;h<19;h++) for(const m of ["00","30"]){const hh=pad(h); o.push({id:`${hh}:${m}`,title:`${hh}:${m}`});} return o; }

function onlyDigits(s){return String(s||"").replace(/\D/g,"");}
function isValidCPF(cpf){cpf=onlyDigits(cpf);
  if(cpf.length!==11) return false;
  if(/^(\d)\1{10}$/.test(cpf)) return false;
  let sum=0; for(let i=0;i<9;i++) sum+=parseInt(cpf[i],10)*(10-i);
  let d1=(sum*10)%11; if(d1===10) d1=0; if(d1!==parseInt(cpf[9],10)) return false;
  sum=0; for(let i=0;i<10;i++) sum+=parseInt(cpf[i],10)*(11-i);
  let d2=(sum*10)%11; if(d2===10) d2=0; return d2===parseInt(cpf[10],10);
}
function formatCPF(cpf){cpf=onlyDigits(cpf); return cpf.length===11?`${cpf.slice(0,3)}.${cpf.slice(3,6)}.${cpf.slice(6,9)}-${cpf.slice(9)}`:cpf;}
const collectData = ext => ({ time_slots:timeSlots(), max_dob:ymd(todayUTC()), ...dateLimits(), ...ext });
const short = t => (t && t.length>30) ? t.slice(0,29)+"…" : t;
const opt = arr => (arr||[]).map(o => ({ id:o.id, title:short(o.title) }));
const ATD = { id:"atendente", title:"Falar com atendente" };
const withAtd = arr => [...opt(arr), ATD];
const planOptions = () => [{id:"none",title:"Não possuo plano de saúde"}, ...DB.planos.map(p=>({id:p,title:short(p)})), ATD];

function detailScreen(variantId, plano){
  const v=DB.variants[variantId];
  const base=DB.bases[variantId.split("__").slice(0,3).join("__")];
  const fullName=base.title+(v.spec&&v.spec!=="Padrão"?` – ${v.spec}`:"");
  const isScheduled=/hora marcada/i.test(v.scheduling_method);
  const agend=isScheduled?"🗓️ Agendamento por hora marcada (horário a confirmar com a clínica).":"🚶 Atendimento por ordem de chegada (sem horário individual).";
  const pagamento=`Valor particular: ${v.price}\nParcelamento: ${v.installments}\nFormas de pagamento: ${v.payment_methods}`;
  let situacao,header;
  if(!plano||plano==="none"){situacao="1";header=pagamento;}
  else{const cobre=(v.convenios||[]).some(c=>c.toLowerCase()===String(plano).toLowerCase());
    if(cobre){situacao="2";header=`✅ Procedimento coberto pelo seu plano (${plano}).`;}
    else{situacao="3";header=`⚠️ Este procedimento NÃO é coberto pelo plano ${plano}.\n\n${pagamento}`;}}
  return {screen:"PROCEDURE_DETAILS",data:{
    procedure_name:fullName,header_info:header,scheduling_info:agend,
    preparation:v.preparation,contraindications:v.contraindications,documents:v.documents,
    delivery_time:v.delivery_time,age_range:v.age_range,duration:v.duration,
    variant:variantId,plano:String(plano||"none"),
    has_plan:!!plano&&plano!=="none",is_scheduled:isScheduled,scheduling_method:v.scheduling_method,situacao}};
}

function getNextScreen(body){
  const {screen,action,data={}}=body;
  if(action==="ping") return {data:{status:"active"}};
  if(data.error) return {data:{acknowledged:true}};
  if(action==="INIT") return {screen:"WELCOME",data:{}};
  if(action!=="data_exchange") return {screen:"WELCOME",data:{}};
  if([data.need,data.modality,data.bodypart,data.base,data.variant,data.plano,data.decision].includes("atendente")) return {screen:"ATTENDANT",data:{reason:"Falar com atendente"}};

  switch(screen){
    case "NEED":
      if(data.need==="resultado_exame") return {screen:"ATTENDANT",data:{reason:"Resultado de exame"}};
      if(data.need==="informacoes") return {screen:"INFO",data:{}};
      return {screen:"CHOOSE_MODALITY",data:{modalities:withAtd(DB.modalities)}};
    case "CHOOSE_MODALITY":{
      const t=DB.tree[data.modality];
      if(!t) return {screen:"CHOOSE_MODALITY",data:{modalities:withAtd(DB.modalities)}};
      if(t.has_bodyparts) return {screen:"CHOOSE_BODYPART",data:{modality:data.modality,bodyparts:withAtd(t.bodyparts)}};
      return {screen:"CHOOSE_PROCEDURE",data:{modality:data.modality,bodypart:"_",procedures:withAtd(t.procedures)}};
    }
    case "CHOOSE_BODYPART":{
      const t=DB.tree[data.modality];
      return {screen:"CHOOSE_PROCEDURE",data:{modality:data.modality,bodypart:data.bodypart,procedures:withAtd(t.procedures_by_bodypart[data.bodypart]||[])}};
    }
    case "CHOOSE_PROCEDURE":{
      const base=DB.bases[data.base];
      if(!base) return {screen:"CHOOSE_MODALITY",data:{modalities:withAtd(DB.modalities)}};
      if(base.variants.length>1) return {screen:"CHOOSE_SPECIFICITY",data:{base:data.base,base_title:base.title,specificities:withAtd(base.variants.map(v=>({id:v.id,title:v.spec})))}};
      return {screen:"CHOOSE_PLAN",data:{variant:base.variants[0].id,planos:planOptions()}};
    }
    case "CHOOSE_SPECIFICITY":
      return {screen:"CHOOSE_PLAN",data:{variant:data.variant,planos:planOptions()}};
    case "CHOOSE_PLAN":
      return detailScreen(data.variant,data.plano);
    case "PROCEDURE_DETAILS":{
      const d=data.decision;
      if(d==="consultar_outro") return {screen:"CHOOSE_MODALITY",data:{modalities:withAtd(DB.modalities)}};
      if(d==="encerrar") return {screen:"END",data:{}};
      return {screen:"COLLECT_DATA",data:collectData({
        procedure_name:data.procedure_name,variant:data.variant,plano:data.plano,
        has_plan:data.has_plan===true||data.has_plan==="true",
        is_scheduled:data.is_scheduled===true||data.is_scheduled==="true",
        scheduling_method:data.scheduling_method})};
    }
    case "COLLECT_DATA":{
      const isSched=data.is_scheduled===true||data.is_scheduled==="true";
      if(!isValidCPF(data.cpf)){
        return {screen:"COLLECT_DATA",data:collectData({
          procedure_name:data.procedure_name,plano:data.plano,
          has_plan:!!data.plano&&data.plano!=="none",is_scheduled:isSched,scheduling_method:data.scheduling_method,
          error_message:"❌ CPF inválido. Confira e digite novamente (apenas os 11 números)."})};
      }
      const common={procedure_name:data.procedure_name,name:data.nome||"",cpf:formatCPF(data.cpf),carteira:data.carteira||"",
        nascimento:fmtDate(data.nascimento),appointment_day:fmtDay(data.data_agendamento)};
      if(isSched) return {screen:"CONFIRM_APPOINTMENT",data:{...common,horario:data.horario||"-"}};
      const dd=parseInput(data.data_agendamento);
      const bh=dd?(dd.getUTCDay()===6?"07:00 às 20:00":"07:00 às 22:00"):"-";
      return {screen:"CONFIRM_WALKIN",data:{...common,business_hours:bh}};
    }
    case "ATTENDANT":
      return {screen:"CONFIRM_ATTENDANT",data:{name:data.nome||""}};
    default:
      return {screen:"WELCOME",data:{}};
  }
}
module.exports={getNextScreen};
