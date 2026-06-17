// ─── CONFIGURAÇÃO ────────────────────────────────────────────────────────────

const API_BASE         = "https://aip.autozap.log.br/api/representatives";
const BASE_AUTOZAP_URL = "https://autozap.log.br/comprar";
const BRIDGE_URL       = "https://aip.autozap.log.br/api/bridge";

// ─── ESTADO ──────────────────────────────────────────────────────────────────

let representative   = null;
let authToken        = null;
let trainingIndex    = 0;
let currentLeadLink  = "";
let pixKeyType       = null;
let isSigned         = false;

// ─── CAMADA DE API ───────────────────────────────────────────────────────────
// Ponto de troca: quando o backend estiver pronto, as chamadas já estão prontas.
// Se o endpoint retornar erro ou não responder, cai automaticamente nos MOCK abaixo.

const api = {
  _headers() {
    const h = { "Content-Type": "application/json" };
    if (authToken) h["Authorization"] = `Bearer ${authToken}`;
    return h;
  },

  async get(path) {
    try {
      const res = await fetch(API_BASE + path, { headers: this._headers() });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  },

  async post(path, body) {
    try {
      const res = await fetch(API_BASE + path, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  },
};

// ─── MOCKS (fallback enquanto o backend não está disponível) ─────────────────

const MOCK = {
  contract: `
    <h3>CONTRATO DE REPRESENTANTE COMERCIAL — AutoZap</h3>

    <p><strong>1. OBJETO</strong><br>
    O presente contrato credencia o REPRESENTANTE para indicação de potenciais clientes ao sistema AutoZap — plataforma de gestão comercial com inteligência artificial para lojas de celular.</p>

    <p><strong>2. NATUREZA DA RELAÇÃO</strong><br>
    O REPRESENTANTE não é funcionário da AutoZap. Sua atuação é exclusivamente comissionada, sem vínculo empregatício, subordinação ou exclusividade.</p>

    <p><strong>3. COMISSÕES</strong><br>
    O REPRESENTANTE receberá 25% do valor do primeiro mês do plano contratado pelo cliente indicado:<br>
    · Plano Básico (R$60/mês) → R$15,00<br>
    · Plano Profissional (R$120/mês) → R$30,00<br>
    · Plano Premium (R$220/mês) → R$55,00</p>

    <p><strong>4. PAGAMENTO</strong><br>
    Comissões são pagas via PIX em até 7 dias úteis após confirmação do pagamento pelo cliente indicado. O REPRESENTANTE é responsável por manter seus dados de PIX atualizados na plataforma.</p>

    <p><strong>5. OBRIGAÇÕES DO REPRESENTANTE</strong><br>
    · Indicar apenas clientes reais e genuinamente interessados.<br>
    · Não realizar cadastros falsos ou fraudulentos.<br>
    · Não prometer funcionalidades não previstas no AutoZap.<br>
    · Manter dados cadastrais e de pagamento atualizados.</p>

    <p><strong>6. VEDAÇÕES</strong><br>
    · Subcontratação de terceiros sem autorização prévia por escrito.<br>
    · Uso do nome AutoZap de forma que possa denegrir a imagem da empresa.<br>
    · Qualquer forma de fraude ou manipulação do sistema de rastreamento.</p>

    <p><strong>7. RESCISÃO</strong><br>
    Qualquer das partes pode rescindir mediante aviso de 15 dias. Rescisão por justa causa (fraude, cadastros falsos) é imediata e implica perda das comissões pendentes.</p>

    <p><strong>8. FORO</strong><br>
    Este contrato é regido pelas leis brasileiras, com foro eleito na comarca de São Paulo/SP.</p>
  `,

  commissions: {
    summary: { total: 0, pending: 0, paid: 0 },
    entries: [],
  },

  paymentData: null,
};

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
    document.getElementById("photoPreviewUpload").innerHTML =
      `<img src="${e.target.result}" alt="Foto de perfil" />`;
  };
  reader.readAsDataURL(file);
}

// ─── LOGIN ───────────────────────────────────────────────────────────────────

async function doLogin() {
  const email    = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  if (!email || !password) {
    showToast("Informe e-mail e senha.", true);
    return;
  }

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
}

// ─── CADASTRO ────────────────────────────────────────────────────────────────

function saveRepresentative() {
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
    showToast("As senhas não coincidem.", true);
    return;
  }

  if (!isSigned) {
    showToast("Assine o contrato para continuar.", true);
    return;
  }

  const code = generateRepresentativeCode(city, name);
  representative = {
    name, age, city, whatsapp, email,
    code,
    referralLink: buildReferralLink(code),
    photoUrl: photoFile ? URL.createObjectURL(photoFile) : null,
  };

  localStorage.setItem("autozap_rep", JSON.stringify({ name, age, city, whatsapp, email }));

  // Dispara registro na API e em seguida envia foto + aceite do contrato
  api.post("/register", { name, age, city, whatsapp, email, password }).then(async (res) => {
    if (res?.token) { authToken = res.token; localStorage.setItem("autozap_token", authToken); }
    if (res?.code)  { representative.code = res.code; representative.referralLink = buildReferralLink(res.code); }

    // Upload da foto como multipart/form-data
    if (photoFile && authToken) {
      try {
        const form = new FormData();
        form.append("photo", photoFile);
        await fetch(API_BASE + "/photo", {
          method: "POST",
          headers: { "Authorization": `Bearer ${authToken}` },
          body: form,
        });
      } catch {}
    }

    // Registra aceite do contrato com nome da assinatura e timestamp
    const signedName = document.getElementById("signatureName")?.textContent || name;
    api.post("/contract/accept", {
      accepted:  true,
      signedName,
      signedAt:  new Date().toISOString(),
    });
  });

  trainingIndex = 0;
  goTo("trainingScreen");
}

// ─── CONTRATO ────────────────────────────────────────────────────────────────

async function loadContract() {
  const box = document.getElementById("contractText");
  if (!box) return;

  // Exibe mock imediatamente — sem esperar a API
  box.innerHTML = MOCK.contract;

  // Reseta estado de assinatura
  isSigned = false;
  document.getElementById("signArea").classList.remove("hidden");
  document.getElementById("signedBlock").classList.add("hidden");
  const btn = document.getElementById("btnRegister");
  if (btn) btn.disabled = true;

  // Tenta API em background; substitui se responder
  api.get("/contract").then((data) => {
    if (data && data.text) box.innerHTML = data.text;
  });
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

  isSigned = true;

  document.getElementById("signArea").classList.add("hidden");

  const block = document.getElementById("signedBlock");
  block.classList.remove("hidden");
  document.getElementById("signatureName").textContent = typedName;

  const now = new Date();
  document.getElementById("signedDate").textContent =
    now.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }) +
    " às " + now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

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
  trainingIndex++;
  if (trainingIndex >= trainingCards.length) {
    goTo("dashboardScreen");
    return;
  }
  renderTrainingCard();
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

async function renderDashboard() {
  // Tenta buscar dados do representante via API; usa estado local como fallback
  const meData = await api.get("/me");
  if (meData) {
    representative.name = meData.name || representative.name;
    representative.city = meData.city || representative.city;
  }

  // Referral
  const refData = await api.get("/me/referral");
  if (refData) {
    representative.code = refData.code || representative.code;
    representative.referralLink = refData.link || representative.referralLink;
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
  const data = (await api.get("/me/commissions")) || MOCK.commissions;
  renderCommissions(data);
}

function renderCommissions(data) {
  const { summary, entries } = data;

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

  const statusLabel = { pending: "Pendente", paid: "Pago", processing: "Processando" };
  list.innerHTML = entries.map((e) => `
    <div class="commission-item">
      <div class="comm-info">
        <p class="comm-client">${e.clientName}</p>
        <p class="comm-date">${formatDate(e.date)}</p>
      </div>
      <div class="comm-right">
        <span class="comm-value">${fmt(e.value)}</span>
        <span class="comm-status status-${e.status}">${statusLabel[e.status] || e.status}</span>
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
  const data = await api.get("/payment-data");
  if (!data) return;

  const savedInfo = document.getElementById("pixSavedInfo");
  const savedText = document.getElementById("pixSavedText");
  savedInfo.classList.remove("hidden");
  savedText.textContent = `Chave ${data.keyType?.toUpperCase() || "PIX"}: ${data.key}`;
  document.getElementById("pixKeyInput").value = data.key;

  if (data.keyType) {
    selectPixType(data.keyType);
    document.getElementById("pixKeyInput").value = data.key;
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

  const payload = { keyType: pixKeyType, key };
  const apiRes  = await api.post("/payment-data", payload);

  // Persiste localmente independente da API
  localStorage.setItem("autozap_pix", JSON.stringify(payload));

  const savedInfo = document.getElementById("pixSavedInfo");
  const savedText = document.getElementById("pixSavedText");
  savedInfo.classList.remove("hidden");
  savedText.textContent = `Chave ${pixKeyType.toUpperCase()}: ${key}`;

  showToast("Dados PIX salvos com sucesso!");
}

// ─── LEAD / QR CODE ──────────────────────────────────────────────────────────

function generateLeadLink() {
  const leadName  = document.getElementById("leadName").value.trim();
  const leadEmail = document.getElementById("leadEmail").value.trim();

  if (!leadName || !leadEmail) {
    showToast("Preencha nome e e-mail do interessado.", true);
    return;
  }

  const leadId = crypto.randomUUID();
  const url    = new URL(BRIDGE_URL);
  url.searchParams.set("ref",   representative.code);
  url.searchParams.set("lead",  leadId);
  url.searchParams.set("name",  leadName);
  url.searchParams.set("email", leadEmail);

  currentLeadLink = url.toString();

  document.getElementById("leadResult").classList.remove("hidden");
  document.getElementById("leadLinkText").textContent = currentLeadLink;

  const qrBox = document.getElementById("qrBox");
  qrBox.innerHTML = "";
  QRCode.toCanvas(currentLeadLink, { width: 200, margin: 2 }, function (err, canvas) {
    if (err) { showToast("Erro ao gerar QR Code.", true); return; }
    qrBox.appendChild(canvas);
  });

  // Ponto de troca: registrar lead na API quando disponível
  // await api.post("/leads", { representativeCode: representative.code, leadId, leadName, leadEmail });
  console.log("Lead gerado:", { representativeCode: representative.code, leadId, leadName, leadEmail });

  document.getElementById("leadResult").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ─── HELPERS DE CÓDIGO E LINK ────────────────────────────────────────────────

function generateRepresentativeCode(city, name) {
  const clean = (str) =>
    str.normalize("NFD")
       .replace(/[̀-ͯ]/g, "")
       .replace(/[^a-zA-Z]/g, "")
       .slice(0, 3)
       .toUpperCase();
  const random = Math.floor(1000 + Math.random() * 9000);
  return `AZ-${clean(city)}-${clean(name)}-${random}`;
}

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

goTo("welcomeScreen");
