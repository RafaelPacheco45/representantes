// â”€â”€â”€ CONFIGURAÃ‡ÃƒO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const API_BASE         = "https://aip.autozap.log.br/api/representatives";
const BASE_AUTOZAP_URL = "https://autozap.log.br/comprar.html";
const BRIDGE_URL       = "https://aip.autozap.log.br/api/bridge";

// â”€â”€â”€ ESTADO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let representative   = null;
let authToken        = null;
let trainingIndex    = 0;
let currentLeadLink  = "";
let leadLinkSubmitting = false;
let pixKeyType       = null;
let isSigned         = false;
let pendingSignatureName = "";
let contractMeta = { version: "", hash: "" };
let currentPixData = null;

class ApiError extends Error {
  constructor(message, status = 0, payload = null, endpoint = "") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
    this.endpoint = endpoint;
  }
}

// â”€â”€â”€ CAMADA DE API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Ponto de troca: quando o backend estiver pronto, as chamadas jÃ¡ estÃ£o prontas.
// Se o endpoint retornar erro ou nÃ£o responder, cai automaticamente nos MOCK abaixo.

const api = {
  _headers() {
    const h = { "Content-Type": "application/json" };
    if (authToken) h["Authorization"] = `Bearer ${authToken}`;
    return h;
  },

  async request(path, options = {}) {
    const endpoint = API_BASE + path;
    let response;
    try {
      const headers = { ...this._headers(), ...(options.headers || {}) };
      if (options.body instanceof FormData) {
        delete headers["Content-Type"];
      }
      response = await fetch(endpoint, {
        method: options.method || "GET",
        headers,
        body: options.body,
      });
    } catch (error) {
      throw new ApiError("Falha de rede ao acessar a API.", 0, null, path);
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const statusMessages = {
        400: "Dados invalidos enviados para a API.",
        401: "Sessao expirada ou invalida. Entre novamente.",
        403: "Seu usuario nao tem permissao para esta operacao.",
        404: "Rota nao encontrada na API.",
        409: "Ja existe um cadastro com esses dados.",
        422: "Nao foi possivel validar os dados enviados.",
        429: "Muitas tentativas. Aguarde e tente novamente.",
      };
      const message = payload?.message || payload?.error || statusMessages[response.status] || (response.status >= 500 ? "Erro interno no servidor." : `Falha na API (${response.status}).`);
      throw new ApiError(message, response.status, payload, path);
    }
    return payload;
  },

  async get(path) {
    return this.request(path, { method: "GET" });
  },

  async post(path, body) {
    return this.request(path, {
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body),
    });
  },
};

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function sanitizeContractHTML(html = "") {
  const allowedTags = new Set(["P", "BR", "STRONG", "EM", "UL", "OL", "LI", "H1", "H2", "H3", "H4"]);
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return "";

  const walk = (node) => {
    Array.from(node.querySelectorAll("*")).forEach((el) => {
      if (!allowedTags.has(el.tagName)) {
        el.replaceWith(...Array.from(el.childNodes));
        return;
      }
      Array.from(el.attributes).forEach((attr) => el.removeAttribute(attr.name));
    });
  };

  walk(root);
  return root.innerHTML;
}

function maskPixKey(type, key) {
  const value = String(key || "").trim();
  if (!value) return "";
  if (type === "cpf" && value.length >= 11) return value.replace(/^(\d{3})\.(\d{3})\.(\d{3})-(\d{2})$/, "***.***.***-$4");
  if (type === "phone" && value.length >= 8) return value.replace(/^(\D*\d{2}\D*)(.*)(\d{4})$/, "$1*****-$3");
  if (type === "email" && value.includes("@")) {
    const [user, domain] = value.split("@");
    return `${user.charAt(0) || "*"}***@${domain}`;
  }
  if (value.length <= 6) return "*".repeat(value.length);
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

function safeLeadUrl(ref, leadId) {
  const url = new URL(BRIDGE_URL);
  url.searchParams.set("ref", ref || "");
  url.searchParams.set("lead", leadId || "");
  url.searchParams.delete("name");
  url.searchParams.delete("email");
  return url.toString();
}

function setSignedState(text) {
  const label = document.getElementById("signedStatusLabel");
  if (label) label.textContent = text;
}

// â”€â”€â”€ MOCKS (fallback enquanto o backend nÃ£o estÃ¡ disponÃ­vel) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const MOCK = {
  contract: `
    <h3>CONTRATO DE REPRESENTANTE COMERCIAL â€” AutoZap</h3>

    <p><strong>1. OBJETO</strong><br>
    O presente contrato credencia o REPRESENTANTE para indicaÃ§Ã£o de potenciais clientes ao sistema AutoZap â€” plataforma de gestÃ£o comercial com inteligÃªncia artificial para lojas de celular.</p>

    <p><strong>2. NATUREZA DA RELAÃ‡ÃƒO</strong><br>
    O REPRESENTANTE nÃ£o Ã© funcionÃ¡rio da AutoZap. Sua atuaÃ§Ã£o Ã© exclusivamente comissionada, sem vÃ­nculo empregatÃ­cio, subordinaÃ§Ã£o ou exclusividade.</p>

    <p><strong>3. COMISSÃ•ES</strong><br>
    O REPRESENTANTE receberÃ¡ 25% do valor do primeiro mÃªs do plano contratado pelo cliente indicado:<br>
    Â· Plano BÃ¡sico (R$60/mÃªs) â†’ R$15,00<br>
    Â· Plano Profissional (R$120/mÃªs) â†’ R$30,00<br>
    Â· Plano Premium (R$220/mÃªs) â†’ R$55,00</p>

    <p><strong>4. PAGAMENTO</strong><br>
    ComissÃµes sÃ£o pagas via PIX em atÃ© 7 dias Ãºteis apÃ³s confirmaÃ§Ã£o do pagamento pelo cliente indicado. O REPRESENTANTE Ã© responsÃ¡vel por manter seus dados de PIX atualizados na plataforma.</p>

    <p><strong>5. OBRIGAÃ‡Ã•ES DO REPRESENTANTE</strong><br>
    Â· Indicar apenas clientes reais e genuinamente interessados.<br>
    Â· NÃ£o realizar cadastros falsos ou fraudulentos.<br>
    Â· NÃ£o prometer funcionalidades nÃ£o previstas no AutoZap.<br>
    Â· Manter dados cadastrais e de pagamento atualizados.</p>

    <p><strong>6. VEDAÃ‡Ã•ES</strong><br>
    Â· SubcontrataÃ§Ã£o de terceiros sem autorizaÃ§Ã£o prÃ©via por escrito.<br>
    Â· Uso do nome AutoZap de forma que possa denegrir a imagem da empresa.<br>
    Â· Qualquer forma de fraude ou manipulaÃ§Ã£o do sistema de rastreamento.</p>

    <p><strong>7. RESCISÃƒO</strong><br>
    Qualquer das partes pode rescindir mediante aviso de 15 dias. RescisÃ£o por justa causa (fraude, cadastros falsos) Ã© imediata e implica perda das comissÃµes pendentes.</p>

    <p><strong>8. FORO</strong><br>
    Este contrato Ã© regido pelas leis brasileiras, com foro eleito na comarca de SÃ£o Paulo/SP.</p>
  `,

  commissions: {
    summary: { total: 0, pending: 0, paid: 0 },
    entries: [],
  },

  paymentData: null,
};

// â”€â”€â”€ TREINAMENTO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const trainingCards = [
  {
    icon: "âš¡",
    title: "O que Ã© o AutoZap?",
    text: "O AutoZap Ã© um sistema comercial com inteligÃªncia artificial feito para lojas de celular. Em um sÃ³ lugar: vendas, controle de estoque, atendimento automÃ¡tico no WhatsApp e emissÃ£o de notas fiscais.",
  },
  {
    icon: "ðŸ›’",
    title: "Como apresentar para lojistas?",
    text: "Foque nos benefÃ­cios diretos: o lojista economiza tempo, vende mais e para de perder cliente por falta de resposta. Destaque: atendimento automÃ¡tico 24h no WhatsApp, controle de estoque em tempo real e emissÃ£o de nota com um clique.",
  },
  {
    icon: "ðŸ”—",
    title: "Como registrar uma indicaÃ§Ã£o?",
    text: "Na sua Ã¡rea de representante, cadastre o nome e o e-mail do interessado. Depois gere o QR Code e mostre para ele. Quando ele contratar usando esse link, o sistema registra automaticamente que a venda veio de vocÃª.",
  },
  {
    icon: "ðŸ’°",
    title: "Como funciona sua comissÃ£o?",
    text: "VocÃª recebe 25% do valor do primeiro mÃªs do plano contratado. Plano de R$60 â†’ R$15 para vocÃª. Plano de R$120 â†’ R$30. Plano de R$220 â†’ R$55. O pagamento Ã© processado apÃ³s a confirmaÃ§Ã£o da venda.",
  },
  {
    icon: "ðŸ›¡ï¸",
    title: "Como evitar fraude?",
    text: "Nunca cadastre leads falsos ou invente interessados para ganhar comissÃ£o. O sistema rastreia cada venda e identifica inconsistÃªncias automaticamente. Representantes com fraude confirmada sÃ£o desligados e perdem todas as comissÃµes pendentes.",
  },
];

// â”€â”€â”€ NAVEGAÃ‡ÃƒO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function hideAll() {
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
}

function goTo(screenId) {
  hideAll();
  document.getElementById(screenId).classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (screenId === "trainingScreen")  renderTrainingCard();
  if (screenId === "registerScreen")  loadContract();
  if (screenId === "dashboardScreen") renderDashboard();
}

// â”€â”€â”€ FOTO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function previewPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    const preview = document.getElementById("photoPreviewUpload");
    if (!preview) return;
    preview.replaceChildren();
    const img = document.createElement("img");
    img.alt = "Foto de perfil";
    img.src = String(e.target.result || "");
    preview.appendChild(img);
  };
  reader.readAsDataURL(file);
}

// â”€â”€â”€ LOGIN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function doLogin() {
  const email    = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  if (!email || !password) {
    showToast("Informe e-mail e senha.", true);
    return;
  }

  try {
    const res = await api.post("/login", { email, password });

    if (res && res.token) {
      authToken = res.token;
      localStorage.setItem("autozap_token", res.token);
      representative = {
        name:         res.name,
        city:         res.city,
        email,
        code:         res.code,
        referralLink: res.referralLink || buildReferralLink(res.code),
        photoUrl:     res.photoUrl || null,
      };
      goTo("dashboardScreen");
      return;
    }

    showToast("E-mail ou senha incorretos.", true);
  } catch (error) {
    showToast(error.message || "Nao foi possivel fazer login agora.", true);
  }
}

// â”€â”€â”€ CADASTRO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function saveRepresentative() {
  const name            = document.getElementById("name").value.trim();
  const age             = Number(document.getElementById("age").value);
  const city            = document.getElementById("city").value.trim();
  const whatsapp        = document.getElementById("whatsapp").value.trim();
  const email           = document.getElementById("email").value.trim();
  const password        = document.getElementById("password").value;
  const passwordConfirm = document.getElementById("passwordConfirm").value;
  const photoFile       = document.getElementById("photo").files[0];

  if (!name || !age || !city || !whatsapp || !email || !password) {
    showToast("Preencha todos os campos.", true);
    return;
  }
  if (age < 18) {
    showToast("Apenas maiores de 18 anos podem participar.", true);
    return;
  }
  if (password.length < 6) {
    showToast("A senha deve ter pelo menos 6 caracteres.", true);
    return;
  }
  if (password !== passwordConfirm) {
    showToast("As senhas nÃ£o coincidem.", true);
    return;
  }

  if (!pendingSignatureName) {
    showToast("Assine o contrato para continuar.", true);
    return;
  }

  const btn = document.getElementById("btnRegister");
  if (btn) btn.disabled = true;

  try {
    const registration = await api.post("/register", { name, age, city, whatsapp, email, password });
    const serverCode = String(registration?.code || registration?.representativeCode || registration?.id || "").trim();
    if (!serverCode) {
      throw new ApiError("A API concluiu o cadastro, mas nao retornou o codigo oficial do representante.", 500, registration, "/register");
    }

    if (registration.token) {
      authToken = registration.token;
      localStorage.setItem("autozap_token", registration.token);
    }

    await api.post("/contract/accept", {
      representativeId: registration.id || registration.representativeId || serverCode,
      contractVersion: contractMeta.version || registration.contractVersion || "",
      contractHash: contractMeta.hash || registration.contractHash || "",
      signedName: pendingSignatureName,
      acceptedAt: new Date().toISOString(),
      source: "representantes",
    });

    representative = {
      name,
      age,
      city,
      whatsapp,
      email,
      code: serverCode,
      referralLink: buildReferralLink(serverCode),
      photoUrl: photoFile ? URL.createObjectURL(photoFile) : null,
    };

    localStorage.setItem("autozap_rep", JSON.stringify({
      name,
      age,
      city,
      whatsapp,
      email,
      code: serverCode,
    }));

    if (photoFile && authToken) {
      try {
        const form = new FormData();
        form.append("photo", photoFile);
        await fetch(API_BASE + "/photo", {
          method: "POST",
          headers: { "Authorization": `Bearer ${authToken}` },
          body: form,
        });
      } catch (error) {
        if (localStorage.getItem("DEBUG_API") === "1") console.warn("Falha no upload da foto", error);
      }
    }

    isSigned = true;
    setSignedState("Contrato aceito");
    const signedDateEl = document.getElementById("signedDate");
    if (signedDateEl) {
      const acceptedAt = new Date();
      signedDateEl.textContent = acceptedAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }) + " às " + acceptedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    }
    trainingIndex = 0;
    goTo("trainingScreen");
  } catch (error) {
    if (error instanceof ApiError) {
      showToast(error.message, true);
    } else {
      showToast(error?.message || "Nao foi possivel concluir o cadastro.", true);
    }
    if (btn) btn.disabled = false;
  }
}

// â”€â”€â”€ CONTRATO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function loadContract() {
  const box = document.getElementById("contractText");
  if (!box) return;

  // Exibe mock imediatamente â€” sem esperar a API
  box.innerHTML = sanitizeContractHTML(MOCK.contract);

  // Reseta estado de assinatura
  isSigned = false;
  pendingSignatureName = "";
  contractMeta = { version: "", hash: "" };
  setSignedState("Assinatura pendente");
  document.getElementById("signArea").classList.remove("hidden");
  document.getElementById("signedBlock").classList.add("hidden");
  const btn = document.getElementById("btnRegister");
  if (btn) btn.disabled = true;

  // Tenta API em background; substitui se responder
  try {
    const data = await api.get("/contract");
    if (data && data.text) box.innerHTML = sanitizeContractHTML(data.text);
    contractMeta = {
      version: data?.version || data?.contractVersion || "",
      hash: data?.hash || data?.contractHash || "",
    };
  } catch (error) {
    if (localStorage.getItem("DEBUG_API") === "1") console.warn("Contrato indisponivel", error);
  }
}

function previewSignature(value) {
  const preview = document.getElementById("signaturePreviewText");
  const placeholder = document.querySelector(".signature-preview-placeholder");
  preview.textContent = value;
  if (placeholder) placeholder.style.display = value ? "none" : "";
  document.getElementById("btnSign").disabled = !value.trim();
}

function signContract() {
  const typedName = document.getElementById("signatureInput").value.trim();
  if (!typedName) {
    showToast("Digite seu nome completo para assinar.", true);
    return;
  }

  pendingSignatureName = typedName;

  document.getElementById("signArea").classList.add("hidden");

  const block = document.getElementById("signedBlock");
  block.classList.remove("hidden");
  document.getElementById("signatureName").textContent = typedName;
  setSignedState("Assinatura preparada");
  document.getElementById("signedDate").textContent = "Aguardando confirmação da API";

  const btn = document.getElementById("btnRegister");
  if (btn) btn.disabled = false;
}

// â”€â”€â”€ TREINAMENTO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function renderTrainingCard() {
  const card  = trainingCards[trainingIndex];
  const total = trainingCards.length;
  const pct   = ((trainingIndex + 1) / total) * 100;

  // Ã­cone fixo: logo AutoZap no HTML (nÃ£o sobrescrever com emoji)
  document.getElementById("trainingTitle").textContent = card.title;
  document.getElementById("trainingText").textContent  = card.text;
  document.getElementById("trainingStep").textContent  = `${trainingIndex + 1} de ${total}`;
  document.getElementById("progressFill").style.width  = `${pct}%`;

  const isLast = trainingIndex === total - 1;
  document.getElementById("trainingBtn").childNodes[0].textContent =
    isLast ? "Acessar meu painel " : "Continuar ";
}

function nextTrainingCard() {
  trainingIndex++;
  if (trainingIndex >= trainingCards.length) {
    goTo("dashboardScreen");
    return;
  }
  renderTrainingCard();
}

// â”€â”€â”€ DASHBOARD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function renderDashboard() {
  // Tenta buscar dados do representante via API; usa estado local como fallback
  try {
    const meData = await api.get("/me");
    if (meData) {
      representative.name = meData.name || representative.name;
      representative.city = meData.city || representative.city;
    }
  } catch (error) {
    if (localStorage.getItem("DEBUG_API") === "1") console.warn("Dados do representante indisponiveis", error);
  }

  // Referral
  try {
    const refData = await api.get("/me/referral");
    if (refData) {
      representative.code = refData.code || representative.code;
      representative.referralLink = refData.link || representative.referralLink;
    }
  } catch (error) {
    if (localStorage.getItem("DEBUG_API") === "1") console.warn("Referral indisponivel", error);
  }

  document.getElementById("partnerName").textContent = representative.name;
  document.getElementById("partnerCity").textContent = representative.city;
  document.getElementById("partnerCode").textContent = representative.code;
  document.getElementById("partnerLink").textContent = representative.referralLink;

  if (representative.photoUrl) {
    const avatar = document.getElementById("photoPreview");
    avatar.style.backgroundImage = `url(${representative.photoUrl})`;
    avatar.innerHTML = "";
  }

  // ComissÃµes
  await loadCommissions();

  // Dados PIX salvos
  await loadPixData();
}

// â”€â”€â”€ TABS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function switchTab(tabId) {
  document.querySelectorAll(".tab-content").forEach((t) => t.classList.add("hidden"));
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.getElementById("tab-" + tabId).classList.remove("hidden");
  document.querySelector(`[data-tab="${tabId}"]`).classList.add("active");
}

// â”€â”€â”€ COMISSÃ•ES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function loadCommissions() {
  const list = document.getElementById("commissionList");
  try {
    const data = await api.get("/me/commissions");
    renderCommissions(data || { summary: { total: 0, pending: 0, paid: 0 }, entries: [] });
  } catch (error) {
    if (list) {
      list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">Â°</div>
        <p>NÃ£o foi possÃ­vel carregar as comissÃµes agora.<br>Tente novamente quando a API estiver disponÃ­vel.</p>
      </div>`;
    }
    if (localStorage.getItem("DEBUG_API") === "1") console.warn("ComissÃµes indisponÃ­veis", error);
  }
}

function renderCommissions(data) {
  const { summary = { total: 0, pending: 0, paid: 0 }, entries = [] } = data || {};

  const fmt = (v) => `R$${Number(v).toFixed(2).replace(".", ",")}`;
  document.getElementById("commTotal").textContent   = fmt(summary.total);
  document.getElementById("commPending").textContent = fmt(summary.pending);
  document.getElementById("commPaid").textContent    = fmt(summary.paid);

  const list = document.getElementById("commissionList");

  if (!entries || entries.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">ðŸ’°</div>
        <p>Nenhuma comissÃ£o registrada ainda.<br>Comece a indicar para ver seus ganhos aqui.</p>
      </div>`;
    return;
  }

  const statusLabel = { pending: "Pendente", paid: "Pago", processing: "Processando" };
  list.innerHTML = entries.map((e) => `
    <div class="commission-item">
      <div class="comm-info">
        <p class="comm-client">${escapeHTML(e.clientName || "-")}</p>
        <p class="comm-date">${escapeHTML(formatDate(e.date))}</p>
      </div>
      <div class="comm-right">
        <span class="comm-value">${escapeHTML(fmt(e.value))}</span>
        <span class="comm-status status-${["pending", "paid", "processing"].includes(e.status) ? e.status : "pending"}">${escapeHTML(statusLabel[e.status] || "Pendente")}</span>
      </div>
    </div>`).join("");
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return iso; }
}

// â”€â”€â”€ DADOS PIX â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function loadPixData() {
  try {
    const data = await api.get("/payment-data");
    if (!data) return;

    currentPixData = data;
    const savedInfo = document.getElementById("pixSavedInfo");
    const savedText = document.getElementById("pixSavedText");
    savedInfo.classList.remove("hidden");
    savedText.textContent = `Chave ${String(data.keyType || "PIX").toUpperCase()}: ${maskPixKey(data.keyType, data.key)}`;
    document.getElementById("pixKeyInput").value = data.key;

    if (data.keyType) {
      selectPixType(data.keyType);
      document.getElementById("pixKeyInput").value = data.key;
    }
  } catch (error) {
    currentPixData = null;
    if (localStorage.getItem("DEBUG_API") === "1") console.warn("PIX indisponÃ­vel", error);
  }
}

function selectPixType(type) {
  pixKeyType = type;
  document.querySelectorAll(".pix-type-btn").forEach((b) => b.classList.remove("selected"));
  const btn = document.querySelector(`[data-pix="${type}"]`);
  if (btn) btn.classList.add("selected");

  const placeholders = {
    cpf:    "000.000.000-00",
    cnpj:   "00.000.000/0001-00",
    email:  "seu@email.com",
    phone:  "(00) 00000-0000",
    random: "Chave aleatÃ³ria UUID",
  };

  const input = document.getElementById("pixKeyInput");
  input.placeholder = placeholders[type] || "";
  input.disabled = false;
  input.focus();
}

async function savePixData() {
  if (!pixKeyType) {
    showToast("Selecione o tipo de chave PIX.", true);
    return;
  }
  const key = document.getElementById("pixKeyInput").value.trim();
  if (!key) {
    showToast("Informe a chave PIX.", true);
    return;
  }

  const payload = { keyType: pixKeyType, key };
  try {
    await api.post("/payment-data", payload);
    currentPixData = payload;
  } catch (error) {
    showToast(error.message || "Nao foi possivel salvar a chave PIX.", true);
    return;
  }

  const savedInfo = document.getElementById("pixSavedInfo");
  const savedText = document.getElementById("pixSavedText");
  savedInfo.classList.remove("hidden");
  savedText.textContent = `Chave ${pixKeyType.toUpperCase()}: ${maskPixKey(pixKeyType, key)}`;

  showToast("Dados PIX salvos com sucesso!");
}

// â”€â”€â”€ LEAD / QR CODE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function generateLeadLink() {
  if (leadLinkSubmitting) return;
  const leadName  = document.getElementById("leadName").value.trim();
  const leadEmail = document.getElementById("leadEmail").value.trim();

  if (!leadName || !leadEmail) {
    showToast("Preencha nome e e-mail do interessado.", true);
    return;
  }

  const leadId = crypto.randomUUID();
  leadLinkSubmitting = true;
  try {
    await api.post("/leads", {
      representativeCode: representative.code,
      leadId,
      name: leadName,
      email: leadEmail,
    });

    currentLeadLink = safeLeadUrl(representative.code, leadId);

    document.getElementById("leadResult").classList.remove("hidden");
    document.getElementById("leadLinkText").textContent = currentLeadLink;

    const qrBox = document.getElementById("qrBox");
    qrBox.replaceChildren();
    QRCode.toCanvas(currentLeadLink, { width: 200, margin: 2 }, function (err, canvas) {
      if (err) { showToast("Erro ao gerar QR Code.", true); return; }
      qrBox.appendChild(canvas);
    });

    document.getElementById("leadResult").scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    showToast(error.message || "Nao foi possivel registrar o lead.", true);
  } finally {
    leadLinkSubmitting = false;
  }
}

// â”€â”€â”€ HELPERS DE CÃ“DIGO E LINK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildReferralLink(code) {
  const url = new URL(BASE_AUTOZAP_URL);
  url.searchParams.set("ref", code);
  return url.toString();
}

// â”€â”€â”€ CLIPBOARD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function copyCode()        { copyToClipboard(representative.code,          "CÃ³digo copiado!"); }
function copyPartnerLink() { copyToClipboard(representative.referralLink,  "Link copiado!"); }
function copyLeadLink()    { copyToClipboard(currentLeadLink,              "Link copiado!"); }

function copyToClipboard(text, successMsg) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => showToast(successMsg));
  } else {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
    showToast(successMsg);
  }
}

// â”€â”€â”€ TOAST â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function showToast(msg, isError = false) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = msg;

  if (isError) {
    toast.style.background = "#ff4d4d";
    toast.style.boxShadow  = "0 6px 24px rgba(255,77,77,0.4)";
  }

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2400);
}

// â”€â”€â”€ INIT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Sem trava de horÃ¡rio â€” funcionamento 24h.

goTo("welcomeScreen");
