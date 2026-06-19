const DB = require("./data/procedimentos.json");
const DIAS = ["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];
const pad = n => String(n).padStart(2,"0");
const normP = x => String(x||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,"").toLowerCase();
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
const collectData = ext => ({ time_slots:timeSlots(), ...dateLimits(), ...ext });
const short = t => (t && t.length>30) ? t.slice(0,29)+"…" : t;
const opt = arr => (arr||[]).map(o => ({ id:o.id, title:short(o.title) }));
const ATD = { id:"atendente", title:"Falar com atendente" };
const withAtd = arr => [...opt(arr), ATD];
const EXCLUDE_PLANS=["ab despachante","despachante barros","jardel"];
const planOptions = () => [{id:"none",title:"Não possuo plano de saúde"}, ...DB.planos.filter(p=>!EXCLUDE_PLANS.includes(p.toLowerCase())).map(p=>({id:p,title:short(p.replace(/\.$/,""))}))];

const FIELD={preparo:"preparation",contraindicacoes:"contraindications",prazo:"delivery_time",documentos:"documents"};
const INFO_LABEL={preco:"Valor particular",preparo:"Preparo obrigatório",contraindicacoes:"Contraindicações",convenios:"Convênios aceitos",prazo:"Prazo de entrega",documentos:"Documentos necessários"};
function variantList(modality,bodypart,base,variant){
  let ids=Object.keys(DB.variants).filter(id=>id.startsWith(modality+"__"));
  if(bodypart&&bodypart!=="_") ids=ids.filter(id=>id.split("__")[1]===bodypart);
  if(base) ids=ids.filter(id=>id.startsWith(base+"__"));
  if(variant) ids=ids.filter(id=>id===variant);
  return ids.map(id=>DB.variants[id]);
}
function fieldValue(v,it){
  if(it==="preco") return v.price;
  if(it==="convenios"){const c=v.convenios||[]; return c.length? c.join(", "):"Apenas particular (não atende por convênio).";}
  return v[FIELD[it]]||"-";
}
function uniformValue(vs,it){
  const norm=x=>String(x).replace(/[•·\-]/g,"").replace(/\s+/g,"").toLowerCase();
  const set=new Set(vs.map(v=>norm(fieldValue(v,it))));
  return set.size===1?fieldValue(vs[0],it):null;
}
const modalityTitle=m=>(DB.modalities.find(x=>x.id===m)||{}).title||m;
const bodypartTitle=(t,bp)=>((t.bodyparts||[]).find(b=>b.id===bp)||{}).title||bp;
function infoResult(it,ctx,value){ return {screen:"INFO_RESULT",data:{result_title:`${INFO_LABEL[it]} — ${ctx}`,result_text:value}}; }

function detailScreen(variantId, plano){
  const v=DB.variants[variantId];
  const base=DB.bases[variantId.split("__").slice(0,3).join("__")];
  const fullName=base.title+(v.spec&&v.spec!=="Padrão"?` – ${v.spec}`:"");
  const isScheduled=/hora marcada/i.test(v.scheduling_method);
  const agend=isScheduled?"📅 Atendimento exclusivo com hora marcada. Garanta o seu horário!":"📅 Atendimento por ordem de chegada.";
  const m=(v.installments||"").match(/(\d+)\s*vez/);
  const parcelaLine = m ? `💳 Parcele em ${/até/i.test(v.installments)?"até ":""}${m[1]}x sem juros no cartão! (Também aceitamos Pix e dinheiro).` : "💳 Pagamento à vista (Pix, cartão ou dinheiro).";
  const pagamento=`💰 Valor: ${v.price}\n${parcelaLine}`;
  let situacao,header;
  if(!plano||plano==="none"){situacao="1";header=pagamento;}
  else{const cobre=(v.convenios||[]).some(c=>normP(c)===normP(plano));
    if(cobre){situacao="2";header=`✅ Procedimento coberto pelo seu plano (${plano}).`;}
    else{situacao="3";header=`⚠️ Este procedimento NÃO é coberto pelo plano ${plano}.\n\n${pagamento}`;}}
  return {screen:"PROCEDURE_DETAILS",data:{
    procedure_name:fullName,header_info:header,scheduling_info:agend,
    preparation:v.preparation,contraindications:v.contraindications,documents:v.documents,
    delivery_time:v.delivery_time,age_range:v.age_range,duration:v.duration,
    variant:variantId,plano:String(plano||"none"),
    has_plan:!!plano&&plano!=="none",is_scheduled:isScheduled,scheduling_method:v.scheduling_method,situacao}};
}

function validBirth(d,m,a){
  if(!Number.isInteger(d)||!Number.isInteger(m)||!Number.isInteger(a)) return false;
  if(m<1||m>12||a<1920||a>2026||d<1||d>31) return false;
  const dt=new Date(Date.UTC(a,m-1,d));
  return dt.getUTCFullYear()===a&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d;
}
function consultaDetail(medId, plano){
  const m=DB.medicos[medId];
  const isScheduled=/hora marcada/i.test(m.scheduling_method);
  const agend=isScheduled?"📅 Atendimento exclusivo com hora marcada. Garanta o seu horário!":"📅 Atendimento por ordem de chegada.";
  const mm=(m.installments||"").match(/(\d+)\s*vez/);
  const parcelaLine=mm?`💳 Parcele em ${/até/i.test(m.installments)?"até ":""}${mm[1]}x sem juros no cartão! (Também aceitamos Pix e dinheiro).`:"💳 Pagamento à vista (Pix, cartão ou dinheiro).";
  const pagamento=`💰 Valor: ${m.price}\n${parcelaLine}`;
  let situacao,header;
  if(!plano||plano==="none"){situacao="1";header=pagamento;}
  else{const cobre=(m.convenios||[]).some(c=>normP(c)===normP(plano));
    if(cobre){situacao="2";header=`✅ Consulta coberta pelo seu plano (${plano}).`;}
    else{situacao="3";header=`⚠️ Esta consulta NÃO é coberta pelo plano ${plano}.\n\n${pagamento}`;}}
  return {screen:"CONSULTA_DETAILS",data:{
    medico_name:`${m.name} — ${m.especialidade}`,header_info:header,scheduling_info:agend,
    especialidade:m.especialidade,return_time:m.return_time,documents:m.documents,age_range:m.age_range,duration:m.duration,
    variant:medId,plano:String(plano||"none"),has_plan:!!plano&&plano!=="none",is_scheduled:isScheduled,scheduling_method:m.scheduling_method,situacao}};
}
function getNextScreen(body){
  const {screen,action,data={}}=body;
  if(action==="ping") return {data:{status:"active"}};
  if(data.error) return {data:{acknowledged:true}};
  if(action==="INIT") return {screen:"WELCOME",data:{}};
  if(action!=="data_exchange") return {screen:"WELCOME",data:{}};
  if([data.need,data.modality,data.bodypart,data.base,data.variant,data.plano,data.decision,data.info_type,data.info_decision,data.especialidade].includes("atendente")) return {screen:"ATTENDANT",data:{reason:"Falar com atendente"}};

  switch(screen){
    case "NEED":
      if(data.need==="agendar_consulta") return {screen:"CONSULTA_ESPECIALIDADE",data:{especialidades:withAtd(DB.especialidades)}};
      if(data.need==="resultado_exame") return {screen:"ATTENDANT",data:{reason:"Resultado de exame"}};
      if(data.need==="informacoes") return {screen:"INFO_TYPE",data:{}};
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
      if(DB.medicos&&DB.medicos[data.variant]) return consultaDetail(data.variant,data.plano);
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
      const dia=parseInt(data.nasc_dia,10),mes=parseInt(data.nasc_mes,10),ano=parseInt(data.nasc_ano,10);
      if(!validBirth(dia,mes,ano)){
        return {screen:"COLLECT_DATA",data:collectData({
          procedure_name:data.procedure_name,plano:data.plano,
          has_plan:!!data.plano&&data.plano!=="none",is_scheduled:isSched,scheduling_method:data.scheduling_method,
          error_message:"❌ Data de nascimento inválida. Verifique dia (1-31), mês (1-12) e ano (1920-2026)."})};
      }
      const nascimento=`${pad(dia)}/${pad(mes)}/${ano}`;
      const common={procedure_name:data.procedure_name,name:data.nome||"",cpf:formatCPF(data.cpf),carteira:data.carteira||"",
        nascimento,appointment_day:fmtDay(data.data_agendamento)};
      if(isSched) return {screen:"CONFIRM_APPOINTMENT",data:{...common,horario:data.horario||"-"}};
      const dd=parseInput(data.data_agendamento);
      const bh=dd?(dd.getUTCDay()===6?"07:00 às 20:00":"07:00 às 22:00"):"-";
      return {screen:"CONFIRM_WALKIN",data:{...common,business_hours:bh}};
    }
    case "ATTENDANT":
      return {screen:"CONFIRM_ATTENDANT",data:{name:data.nome||""}};
    case "INFO_TYPE":{
      const it=data.info_type;
      if(it==="endereco") return {screen:"INFO_RESULT",data:{result_title:"Endereço e horários",result_text:"Travessa Antunes de Alencar, 152 — Bosque — CEP 69900-481, Rio Branco/AC.\nTelefones: (68) 3223-3830 / (68) 99980-3830.\nSeg–Sex 07:00–22:00 • Sáb 07:00–20:00 • Dom: fechado."}};
      return {screen:"INFO_MODALITY",data:{info_type:it,modalities:withAtd(DB.modalities)}};
    }
    case "INFO_MODALITY":{
      const it=data.info_type,m=data.modality,t=DB.tree[m];
      if(it!=="preco"){const u=uniformValue(variantList(m),it); if(u!==null) return infoResult(it,modalityTitle(m),u);}
      if(t.has_bodyparts) return {screen:"INFO_BODYPART",data:{info_type:it,modality:m,bodyparts:withAtd(t.bodyparts)}};
      return {screen:"INFO_PROCEDURE",data:{info_type:it,modality:m,bodypart:"_",procedures:withAtd(t.procedures)}};
    }
    case "INFO_BODYPART":{
      const it=data.info_type,m=data.modality,bp=data.bodypart,t=DB.tree[m];
      if(it!=="preco"){const u=uniformValue(variantList(m,bp),it); if(u!==null) return infoResult(it,bodypartTitle(t,bp),u);}
      return {screen:"INFO_PROCEDURE",data:{info_type:it,modality:m,bodypart:bp,procedures:withAtd(t.procedures_by_bodypart[bp]||[])}};
    }
    case "INFO_PROCEDURE":{
      const it=data.info_type,base=DB.bases[data.base];
      if(!base) return {screen:"INFO_MODALITY",data:{info_type:it,modalities:withAtd(DB.modalities)}};
      if(it!=="preco"){const u=uniformValue(variantList(data.modality,data.bodypart,data.base),it); if(u!==null) return infoResult(it,base.title,u);}
      if(base.variants.length>1) return {screen:"INFO_SPECIFICITY",data:{info_type:it,modality:data.modality,bodypart:data.bodypart,base:data.base,base_title:base.title,specificities:withAtd(base.variants.map(v=>({id:v.id,title:v.spec})))}};
      const v0=DB.variants[base.variants[0].id]; return infoResult(it,base.title,fieldValue(v0,it));
    }
    case "INFO_SPECIFICITY":{
      const it=data.info_type,v=DB.variants[data.variant];
      const base=DB.bases[data.variant.split("__").slice(0,3).join("__")];
      const name=base.title+(v.spec&&v.spec!=="Padrão"?` – ${v.spec}`:"");
      return infoResult(it,name,fieldValue(v,it));
    }
    case "CONSULTA_ESPECIALIDADE":
      return {screen:"CONSULTA_MEDICO",data:{especialidade:data.especialidade,medicos:withAtd(DB.medicos_by_especialidade[data.especialidade]||[])}};
    case "CONSULTA_MEDICO":
      return {screen:"CHOOSE_PLAN",data:{variant:data.variant,planos:planOptions()}};
    case "CONSULTA_DETAILS":{
      const d=data.decision;
      if(d==="consultar_outro") return {screen:"CONSULTA_ESPECIALIDADE",data:{especialidades:withAtd(DB.especialidades)}};
      if(d==="encerrar") return {screen:"END",data:{}};
      return {screen:"COLLECT_DATA",data:collectData({procedure_name:data.procedure_name,variant:data.variant,plano:data.plano,
        has_plan:data.has_plan===true||data.has_plan==="true",is_scheduled:data.is_scheduled===true||data.is_scheduled==="true",scheduling_method:data.scheduling_method})};
    }
    default:
      return {screen:"WELCOME",data:{}};
  }
}
module.exports={getNextScreen};
