const DB = require("./data/procedimentos.json");

const DIAS = ["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];

function startOfTodayMs() {
  const d = new Date(); d.setHours(0,0,0,0); return d.getTime();
}
function buildDateLimits() {
  const min = startOfTodayMs();
  const max = min + 90 * 24 * 60 * 60 * 1000; // ~3 meses
  const unavailable = [];
  for (let t = min; t <= max; t += 24*60*60*1000) {
    if (new Date(t).getDay() === 0) unavailable.push(String(t)); // domingos
  }
  return { min_date: String(min), max_date: String(max), unavailable_dates: unavailable };
}
function formatDay(ms) {
  const d = new Date(Number(ms));
  const dd = String(d.getDate()).padStart(2,"0");
  const mm = String(d.getMonth()+1).padStart(2,"0");
  return `${dd}/${mm}/${d.getFullYear()} (${DIAS[d.getDay()]})`;
}
function businessHours(ms) {
  return new Date(Number(ms)).getDay() === 6 ? "07:00 às 20:00" : "07:00 às 22:00";
}

// Decide a próxima tela com base na tela atual e no payload
function getNextScreen(decryptedBody) {
  const { screen, action, data = {} } = decryptedBody;

  if (action === "ping") return { data: { status: "active" } };
  if (data.error) return { data: { acknowledged: true } };

  // INIT: primeira tela do fluxo
  if (action === "INIT") {
    return { screen: "WELCOME", data: { modalities: DB.modalities } };
  }

  if (action === "data_exchange") {
    switch (screen) {
      case "CHOOSE_MODALITY": {
        const mid = data.modality;
        const mod = DB.modalities.find((m) => m.id === mid);
        return {
          screen: "CHOOSE_PROCEDURE",
          data: {
            modality_title: mod ? mod.title : "",
            procedures: DB.procedures[mid] || [],
          },
        };
      }
      case "CHOOSE_PROCEDURE": {
        const d = DB.details[data.procedure];
        if (!d) return { screen: "CHOOSE_PROCEDURE", data: { error_message: "Procedimento não encontrado." } };
        return { screen: "PROCEDURE_DETAILS", data: { ...d } };
      }
      case "PROCEDURE_DETAILS": {
        const decision = data.decision;
        const method = (data.scheduling_method || "").toLowerCase();
        if (decision === "encerrar") return { screen: "END", data: {} };
        if (decision === "consultar_outro") return { screen: "CHOOSE_MODALITY", data: { modalities: DB.modalities } };
        // agendar -> ramifica pelo método
        if (method.includes("ordem")) {
          return { screen: "SCHEDULE_WALKIN", data: {
            procedure_name: data.procedure_name,
            availability_text: "Atendimento por ordem de chegada, de segunda a sábado (domingo fechado). Segunda a sexta: 07:00 às 22:00. Sábado: 07:00 às 20:00.",
            ...buildDateLimits(),
          }};
        }
        return { screen: "SCHEDULE_APPOINTMENT", data: {
          procedure_name: data.procedure_name,
          info_text: "Este exame é por hora marcada. Vamos encaminhar sua solicitação a um de nossos consultores, que entrará em contato para confirmar data e horário.",
        }};
      }
      case "SCHEDULE_WALKIN": {
        return { screen: "CONFIRM_WALKIN", data: {
          procedure_name: data.procedure_name,
          appointment_day: data.appointment_date ? formatDay(data.appointment_date) : "-",
          business_hours: data.appointment_date ? businessHours(data.appointment_date) : "-",
          name: data.name || "",
        }};
      }
      case "SCHEDULE_APPOINTMENT": {
        return { screen: "CONFIRM_APPOINTMENT", data: {
          procedure_name: data.procedure_name,
          name: data.name || "",
        }};
      }
      default:
        return { screen: "WELCOME", data: { modalities: DB.modalities } };
    }
  }
  return { screen: "WELCOME", data: { modalities: DB.modalities } };
}

module.exports = { getNextScreen };
