// ─── CONFIGURAÇÃO ────────────────────────────────────────────────────────────

const API_BASE         = "https://aip.autozap.log.br/api/representatives";
const BASE_AUTOZAP_URL = "https://autozap.log.br/comprar.html";
const BRIDGE_URL       = "https://aip.autozap.log.br/api/bridge";

// ─── ESTADO ──────────────────────────────────────────────────────────────────

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
let registrationSubmitting = false;
let pendingRegistration = null;
let contractLoadSequence = 0;
let loginSubmitting = false;

class ApiError extends Error {
  constructor(message, status = 0, payload = null, endpoint = "") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
    this.endpoint = endpoint;
  }
}

// ─── CAMADA DE API ───────────────────────────────────────────────────────────
// A API é a fonte oficial. Falhas nunca geram cadastros, contratos ou saldos fictícios.

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
      if (options.public) delete headers.Authorization;
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
    if (payload === null || payload?.ok === false) {
      throw new ApiError("A API retornou uma resposta inválida.", response.status, payload, path);
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
  // Parse a full API document as a document, not inside a wrapper: head/style/title
  // must never become visible contract text. Preserve only inert document markup.
  const allowedTags = new Set(["P", "BR", "STRONG", "B", "EM", "I", "UL", "OL", "LI", "H1", "H2", "H3", "H4", "DIV", "SPAN", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD"]);
  const doc = new DOMParser().parseFromString(String(html), "text/html");
  doc.querySelectorAll("script,style,template,iframe,object,embed,svg,math,form,input,button,link,meta,title").forEach(el => el.remove());
  Array.from(doc.body.querySelectorAll("*")).forEach(el => {
    if (!allowedTags.has(el.tagName)) {
      el.replaceWith(...Array.from(el.childNodes));
    } else {
      Array.from(el.attributes).forEach(attr => el.removeAttribute(attr.name));
    }
  });
  return doc.body.innerHTML;
}

function maskPixKey(type, key) {
  const value = String(key || "").trim();
  if (!value) return "";
  if (type === "cpf") return `***.***.***-${value.replace(/\D/g, "").slice(-2)}`;
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

// ─── TREINAMENTO ─────────────────────────────────────────────────────────────

const trainingCards = [
  {
    icon: "⚡",
    title: "O que é o AutoZap?",
    text: "O AutoZap é um sistema comercial com inteligência artificial feito para lojas de celular. Em um só lugar: vendas, controle de estoque, atendimento automático no WhatsApp e emissão de notas fiscais.",
  },
  {
    icon: "🛒",
    title: "Como apresentar para lojistas?",
    text: "Foque nos benefícios diretos: o lojista economiza tempo, vende mais e para de perder cliente por falta de resposta. Destaque: atendimento automático 24h no WhatsApp, controle de estoque em tempo real e emissão de nota com um clique.",
  },
  {
    icon: "🔗",
    title: "Como registrar uma indicação?",
    text: "Na sua área de representante, cadastre o nome e o e-mail do interessado. Depois gere o QR Code e mostre para ele. Quando ele contratar usando esse link, o sistema registra automaticamente que a venda veio de você.",
  },
  {
    icon: "💰",
    title: "Como funciona sua comissão?",
    text: "Você recebe 25% do valor do primeiro mês do plano contratado. Plano de R$60 → R$15 para você. Plano de R$120 → R$30. Plano de R$220 → R$55. O pagamento é processado após a confirmação da venda.",
  },
  {
    icon: "🛡️",
    title: "Como evitar fraude?",
    text: "Nunca cadastre leads falsos ou invente interessados para ganhar comissão. O sistema rastreia cada venda e identifica inconsistências automaticamente. Representantes com fraude confirmada são desligados e perdem todas as comissões pendentes.",
  },
];

// ─── NAVEGAÇÃO ───────────────────────────────────────────────────────────────

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

// ─── FOTO ────────────────────────────────────────────────────────────────────

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

// ─── LOGIN ───────────────────────────────────────────────────────────────────

async function doLogin() {
  if (loginSubmitting) return;
  const email    = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  if (!email || !password) {
    showToast("Informe e-mail e senha.", true);
    return;
  }

  try {
    loginSubmitting = true;
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
      await resumeAccount();
      return;
    }

    showToast("E-mail ou senha incorretos.", true);
  } catch (error) {
    showToast(error.message || "Nao foi possivel fazer login agora.", true);
  } finally {
    loginSubmitting = false;
  }
}

// ─── CADASTRO ────────────────────────────────────────────────────────────────

async function saveRepresentative() {
  if (registrationSubmitting) return;
  const name            = document.getElementById("name").value.trim();
  const age             = Number(document.getElementById("age").value);
  const city            = document.getElementById("city").value.trim();
  const whatsapp        = document.getElementById("whatsapp").value.trim();
  const email           = document.getElementById("email").value.trim();
  const password        = document.getElementById("password").value;
  const passwordConfirm = document.getElementById("passwordConfirm").value;
  const photoFile       = document.getElementById("photo").files[0];

  if (!pendingRegistration && (!name || !age || !city || !whatsapp || !email || !password)) {
    showToast("Preencha todos os campos.", true);
    return;
  }
  if (!pendingRegistration && (!Number.isInteger(age) || age < 18 || age > 120)) {
    showToast("Apenas maiores de 18 anos podem participar.", true);
    return;
  }
  if (!pendingRegistration && password.length < 6) {
    showToast("A senha deve ter pelo menos 6 caracteres.", true);
    return;
  }
  if (!pendingRegistration && password !== passwordConfirm) {
    showToast("As senhas não coincidem.", true);
    return;
  }

  if (!pendingSignatureName || !contractMeta.version || !contractMeta.hash) {
    showToast("Assine o contrato para continuar.", true);
    return;
  }

  if (!document.getElementById("email").checkValidity()) {
    showToast("Informe um e-mail válido.", true);
    return;
  }
  if (pendingSignatureName.normalize("NFC").toLocaleLowerCase("pt-BR") !== name.normalize("NFC").toLocaleLowerCase("pt-BR")) {
    showToast("A assinatura deve corresponder ao nome completo do cadastro.", true);
    return;
  }
  if (pendingRegistration && pendingRegistration.email !== email) {
    showToast("Conclua o aceite da conta já criada antes de alterar o e-mail.", true);
    return;
  }
  const btn = document.getElementById("btnRegister");
  if (btn) btn.disabled = true;
  registrationSubmitting = true;

  try {
    const registration = pendingRegistration?.response || await api.request("/register", { method: "POST", public: true, body: JSON.stringify({ name, age, city, whatsapp, email, password }) });
    // Retain the successful first step so a failed acceptance can be retried
    // without creating another account. No password is persisted here.
    pendingRegistration = { email, response: registration };
    setRegistrationFieldsLocked(true);
    const serverCode = String(registration?.code || registration?.representativeCode || "").trim();
    if (!serverCode) {
      throw new ApiError("A API concluiu o cadastro, mas nao retornou o codigo oficial do representante.", 500, registration, "/register");
    }

    if (registration.token) {
      authToken = registration.token;
      localStorage.setItem("autozap_token", registration.token);
    }

    const acceptance = await api.post("/contract/accept", {
      representativeId: registration.id || registration.representativeId || serverCode,
      accepted: true,
      contract_version: contractMeta.version,
      contract_hash: contractMeta.hash,
      signedName: pendingSignatureName,
      acceptedAt: new Date().toISOString(),
      source: "representantes",
    });
    if (!acceptance?.ok || !acceptance.acceptance?.accepted_at ||
        acceptance.acceptance.contract_version !== contractMeta.version ||
        acceptance.acceptance.contract_hash !== contractMeta.hash) {
      throw new ApiError("Não foi possível confirmar o aceite. Entre na conta para conferir e retomar.");
    }

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

    localStorage.removeItem("autozap_rep");

    if (photoFile && authToken) {
      try {
        const form = new FormData();
        form.append("photo", photoFile);
        await api.post("/photo", form);
      } catch (error) {
        showToast("Cadastro concluído, mas a foto não foi salva. Tente novamente depois.", true);
      }
    }

    pendingRegistration = null;
    setRegistrationFieldsLocked(false);
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
  } finally {
    registrationSubmitting = false;
  }
}

// ─── CONTRATO ────────────────────────────────────────────────────────────────

async function loadContract() {
  const box = document.getElementById("contractText");
  if (!box) return;
  const loadSequence = ++contractLoadSequence;
  box.textContent = "Carregando contrato oficial...";
  isSigned = false;
  pendingSignatureName = "";
  contractMeta = { version: "", hash: "" };
  setSignedState("Aguardando contrato oficial");
  document.getElementById("signArea").classList.add("hidden");
  document.getElementById("signedBlock").classList.add("hidden");
  document.getElementById("btnSign").disabled = true;
  const btn = document.getElementById("btnRegister");
  if (btn) btn.disabled = true;
  try {
    const response = await api.get("/contract");
    if (loadSequence !== contractLoadSequence) return;
    const data = response?.contract || response;
    const html = data?.html || data?.text;
    if (!html || !data.version || !data.hash) throw new Error("Contrato oficial incompleto");
    box.innerHTML = sanitizeContractHTML(html);
    if (!box.textContent.trim()) throw new Error("Contrato vazio");
    contractMeta = { version: data.version, hash: data.hash };
    document.getElementById("signArea").classList.remove("hidden");
    setSignedState("Assinatura pendente");
    previewSignature(document.getElementById("signatureInput").value);
  } catch (error) {
    if (loadSequence !== contractLoadSequence) return;
    box.textContent = "Nao foi possivel carregar o contrato oficial. Reabra o cadastro para tentar novamente.";
    setSignedState("Contrato indisponivel");
  }
}

function setRegistrationFieldsLocked(locked) {
  ["name", "age", "city", "whatsapp", "email", "password", "passwordConfirm", "photo"].forEach(id => {
    document.getElementById(id).disabled = locked;
  });
}

async function resumeAccount(existingData) {
  const data = existingData || await api.get("/me");
  if (!data?.representative || !data.contract) throw new ApiError("Não foi possível validar a conta.");
  const account = data.representative;
  const code = data.referral_code || account.referral_code || representative?.code;
  representative = { ...account, code, name: account.name || representative?.name,
    city: account.city || representative?.city, email: account.email || representative?.email,
    referralLink: data.referral_url || buildReferralLink(code), photoUrl: account.photo_url || null };
  if (!data.contract.accepted) {
    pendingRegistration = { email: representative.email || "", response: { id: account.id, code } };
    for (const [id, value] of Object.entries({name: representative.name, email: representative.email, age: account.age,
      city: representative.city, whatsapp: account.whatsapp || account.phone})) {
      document.getElementById(id).value = value || "";
    }
    document.getElementById("password").value = "";
    document.getElementById("passwordConfirm").value = "";
    setRegistrationFieldsLocked(true);
    goTo("registerScreen");
    showToast("Sua conta já existe. Leia e aceite o contrato para concluir.");
    return;
  }
  pendingRegistration = null;
  setRegistrationFieldsLocked(false);
  goTo("dashboardScreen");
}

function previewSignature(value) {
  const preview = document.getElementById("signaturePreviewText");
  const placeholder = document.querySelector(".signature-preview-placeholder");
  preview.textContent = value;
  if (placeholder) placeholder.style.display = value ? "none" : "";
  document.getElementById("btnSign").disabled = !value.trim() || !contractMeta.version || !contractMeta.hash;
}

function signContract() {
  if (!contractMeta.version || !contractMeta.hash) return showToast("Aguarde o contrato oficial antes de assinar.", true);
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

// ─── TREINAMENTO ─────────────────────────────────────────────────────────────

function renderTrainingCard() {
  const card  = trainingCards[trainingIndex];
  const total = trainingCards.length;
  const pct   = ((trainingIndex + 1) / total) * 100;

  // ícone fixo: logo AutoZap no HTML (não sobrescrever com emoji)
  document.getElementById("trainingTitle").textContent = card.title;
  document.getElementById("trainingText").textContent  = card.text;
  document.getElementById("trainingStep").textContent  = `${trainingIndex + 1} de ${total}`;
  document.getElementById("progressFill").style.width  = `${pct}%`;

  const isLast = trainingIndex === total - 1;
  document.getElementById("trainingBtn").childNodes[0].textContent =
    isLast ? "Acessar meu painel " : "Continuar ";
}

function nextTrainingCard() {
  if (trainingIndex >= trainingCards.length) return;
  trainingIndex++;
  if (trainingIndex >= trainingCards.length) {
    goTo("dashboardScreen");
    return;
  }
  renderTrainingCard();
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

async function renderDashboard() {
  if (!representative || !authToken) { goTo("loginScreen"); return; }
  // Atualiza dados confirmados pela API.
  try {
    const meData = await api.get("/me");
    if (meData) {
      if (!meData.contract?.accepted) { await resumeAccount(meData); return; }
      representative.name = meData.representative?.name || meData.name || representative.name;
      representative.city = meData.representative?.city || meData.city || representative.city;
    }
  } catch (error) {
    showToast("Não foi possível validar sua sessão. Entre novamente.", true);
    goTo("loginScreen");
    return;
  }

  // Referral
  try {
    const refData = await api.get("/me/referral");
    if (refData) {
      representative.code = refData.referral_code || refData.code || representative.code;
      representative.referralLink = refData.referral_url || refData.link || representative.referralLink;
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

  // Comissões
  await loadCommissions();

  // Dados PIX salvos
  await loadPixData();
}

// ─── TABS ────────────────────────────────────────────────────────────────────

function switchTab(tabId) {
  document.querySelectorAll(".tab-content").forEach((t) => t.classList.add("hidden"));
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.getElementById("tab-" + tabId).classList.remove("hidden");
  document.querySelector(`[data-tab="${tabId}"]`).classList.add("active");
}

// ─── COMISSÕES ───────────────────────────────────────────────────────────────

async function loadCommissions() {
  const list = document.getElementById("commissionList");
  try {
    const data = await api.get("/me/commissions");
    renderCommissions(data || { summary: { total: 0, pending: 0, paid: 0 }, entries: [] });
  } catch (error) {
    if (list) {
      list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">°</div>
        <p>Não foi possível carregar as comissões agora.<br>Tente novamente quando a API estiver disponível.</p>
      </div>`;
    }
    if (localStorage.getItem("DEBUG_API") === "1") console.warn("Comissões indisponíveis", error);
  }
}

function normalizeCommissions(data = {}) {
  if (Array.isArray(data.entries)) return data;
  const groups = data.commissions || {};
  const entries = Object.entries(groups).flatMap(([status, rows]) => (Array.isArray(rows) ? rows : []).map(row => ({
    clientName: row.client_name || row.customer_name || row.customer_id || "Cliente indicado",
    date: row.created_at, value: Number(row.commission_amount || 0), status: row.status || status
  })));
  const sum = statuses => entries.filter(row => statuses.includes(row.status)).reduce((total, row) => total + row.value, 0);
  return { entries, summary: { total: sum(["pending", "approved", "paid"]), pending: sum(["pending", "approved"]), paid: sum(["paid"]) } };
}

function renderCommissions(data) {
  data = normalizeCommissions(data);
  const { summary = { total: 0, pending: 0, paid: 0 }, entries = [] } = data || {};

  const fmt = (v) => `R$${Number(v).toFixed(2).replace(".", ",")}`;
  document.getElementById("commTotal").textContent   = fmt(summary.total);
  document.getElementById("commPending").textContent = fmt(summary.pending);
  document.getElementById("commPaid").textContent    = fmt(summary.paid);

  const list = document.getElementById("commissionList");

  if (!entries || entries.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">💰</div>
        <p>Nenhuma comissão registrada ainda.<br>Comece a indicar para ver seus ganhos aqui.</p>
      </div>`;
    return;
  }

  const statusLabel = { pending: "Pendente", approved: "Aprovada", paid: "Pago", processing: "Processando", blocked: "Bloqueada", cancelled: "Cancelada", chargeback: "Estornada" };
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

// ─── DADOS PIX ───────────────────────────────────────────────────────────────

async function loadPixData() {
  try {
    const response = await api.get("/payment-data");
    const data = response?.payment_data;
    if (!data) return;
    currentPixData = data;
    document.getElementById("pixSavedInfo").classList.remove("hidden");
    document.getElementById("pixSavedText").textContent = `Chave ${String(data.pix_type || "PIX").toUpperCase()}: ${data.pix_key_masked || "Cadastrada"}`;
    document.getElementById("pixKeyInput").value = "";
    if (data.pix_type) selectPixType(data.pix_type);
  } catch (error) {
    if (localStorage.getItem("DEBUG_API") === "1") console.warn("Dados PIX indisponiveis", error);
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
    random: "Chave aleatória UUID",
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

  const holderName = document.getElementById("pixHolderName").value.trim();
  const holderDocument = document.getElementById("pixHolderDocument").value.replace(/\D/g, "");
  if (!holderName || ![11, 14].includes(holderDocument.length)) return showToast("Informe o nome e CPF/CNPJ do titular.", true);
  const payload = { pix_type: pixKeyType, pix_key: key, account_holder_name: holderName, account_holder_document: holderDocument };
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

// ─── LEAD / QR CODE ──────────────────────────────────────────────────────────

async function generateLeadLink() {
  if (leadLinkSubmitting) return;
  const leadName  = document.getElementById("leadName").value.trim();
  const leadEmail = document.getElementById("leadEmail").value.trim();

  if (!leadName || !leadEmail) {
    showToast("Preencha nome e e-mail do interessado.", true);
    return;
  }

  if (!document.getElementById("leadEmail").checkValidity()) {
    showToast("Informe um e-mail válido para o interessado.", true);
    return;
  }
  const leadId = crypto.randomUUID();
  leadLinkSubmitting = true;
  try {
    const result = await api.post("/referrals", {
      referral_code: representative.code,
      lead_id: leadId,
      source: "representantes",
      metadata: { client_name: leadName, email: leadEmail },
      email: leadEmail,
    });

    currentLeadLink = safeLeadUrl(result?.referral?.referral_code || representative.code, result?.referral?.lead_id || leadId);

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

// ─── HELPERS DE CÓDIGO E LINK ────────────────────────────────────────────────

function buildReferralLink(code) {
  const url = new URL(BASE_AUTOZAP_URL);
  url.searchParams.set("ref", code);
  return url.toString();
}

// ─── CLIPBOARD ───────────────────────────────────────────────────────────────

function copyCode()        { copyToClipboard(representative.code,          "Código copiado!"); }
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

// ─── TOAST ───────────────────────────────────────────────────────────────────

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

// ─── INIT ─────────────────────────────────────────────────────────────────────
// Sem trava de horário — funcionamento 24h.

async function initialize() {
  goTo("welcomeScreen");
  const savedToken = localStorage.getItem("autozap_token");
  if (!savedToken) return;
  authToken = savedToken;
  try {
    await resumeAccount();
  } catch (error) {
    authToken = null;
    if (error.status === 401 || error.status === 403) localStorage.removeItem("autozap_token");
    goTo("loginScreen");
    showToast("Entre novamente para continuar seu cadastro ou acessar o painel.", true);
  }
}
initialize();
