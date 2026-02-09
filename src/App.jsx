import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "./api.js";
import { buildInvoicePDF } from "./pdfBuilder.js";

// ---- HELPERS ----

function formatEuro(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return "0,00 €";
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function formatDateFR(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function emptyInvoice(num) {
  return {
    id: null,
    number: num || "EM01377297-100",
    date: new Date().toISOString().split("T")[0],
    clientName: "",
    clientAddress: "",
    clientCity: "",
    clientSiren: "",
    items: [{ id: Date.now(), description: "", quantity: "", unitPrice: "", amount: "" }],
    conditions: "Paiement à réception",
  };
}

function useIsMobile(breakpoint = 768) {
  const [mobile, setMobile] = useState(typeof window !== "undefined" && window.innerWidth < breakpoint);
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < breakpoint);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [breakpoint]);
  return mobile;
}

// ---- MAIN APP ----

export default function InvoiceApp() {
  const isMobile = useIsMobile();
  const [company, setCompany] = useState({
    id: null, name: "CODKAGE DEVELOPPEMENT", address: "Ilot: C/SB, Gounin, Parakou Bénin",
    email: "adimiulrich06@gmail.com", ifu: "0202375331610", vmcf: "EM01377197", paypal: "adimiulrich06@gmail.com",
  });
  const [invoice, setInvoice] = useState(emptyInvoice());
  const [activeTab, setActiveTab] = useState("edit");
  const [showCompanyEdit, setShowCompanyEdit] = useState(false);
  const [savedInvoices, setSavedInvoices] = useState([]);
  const [suggestions, setSuggestions] = useState({ clients: [], descriptions: [], nextNumber: "" });
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dbReady, setDbReady] = useState(false);
  const [status, setStatus] = useState("Connexion à la base...");

  // ---- INIT DB ----
  useEffect(() => {
    (async () => {
      try {
        await api.setup();
        const [companies, invoices, sugg] = await Promise.all([
          api.getCompanies(),
          api.getInvoices(),
          api.getSuggestions(),
        ]);
        if (companies.length > 0) setCompany(companies[0]);
        setSavedInvoices(invoices);
        setSuggestions(sugg);
        if (sugg.nextNumber) {
          setInvoice((p) => ({ ...p, number: sugg.nextNumber }));
        }
        setDbReady(true);
        setStatus("");
      } catch (e) {
        console.error("DB init error:", e);
        setStatus("Erreur DB: " + e.message);
        setDbReady(true);
      }
    })();
  }, []);

  const refreshSuggestions = useCallback(async () => {
    try {
      const [invoices, sugg] = await Promise.all([api.getInvoices(), api.getSuggestions()]);
      setSavedInvoices(invoices);
      setSuggestions(sugg);
    } catch (e) {
      console.error(e);
    }
  }, []);

  // ---- ITEM MANAGEMENT ----
  const updateItem = useCallback((id, field, value) => {
    setInvoice((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, [field]: value };
        if (field === "quantity" || field === "unitPrice") {
          const q = parseFloat(updated.quantity) || 0;
          const p = parseFloat(updated.unitPrice) || 0;
          if (q > 0 && p > 0) updated.amount = (q * p).toFixed(2);
        }
        return updated;
      }),
    }));
  }, []);

  const addItem = () => {
    setInvoice((p) => ({
      ...p,
      items: [...p.items, { id: Date.now(), description: "", quantity: "", unitPrice: "", amount: "" }],
    }));
  };

  const removeItem = (id) => {
    setInvoice((p) => ({ ...p, items: p.items.filter((i) => i.id !== id) }));
  };

  const totalTTC = invoice.items.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);

  // ---- SAVE ----
  const handleSave = async () => {
    setSaving(true);
    try {
      const savedCompany = await api.saveCompany(company);
      setCompany(savedCompany);
      await api.saveInvoice({ ...invoice, companyId: savedCompany.id });
      await refreshSuggestions();
      const sugg = await api.getSuggestions();
      setSuggestions(sugg);
      setInvoice(emptyInvoice(sugg.nextNumber));
      setStatus("Facture sauvegardée !");
      setTimeout(() => setStatus(""), 2000);
    } catch (e) {
      console.error(e);
      setStatus("Erreur: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  // ---- LOAD ----
  const loadInvoice = async (inv) => {
    setInvoice({
      id: inv.id,
      number: inv.number,
      date: inv.date ? inv.date.split("T")[0] : "",
      clientName: inv.client_name || "",
      clientAddress: inv.client_address || "",
      clientCity: inv.client_city || "",
      clientSiren: inv.client_siren || "",
      items: (inv.items || []).map((it, i) => ({
        id: Date.now() + i,
        description: it.description || "",
        quantity: it.quantity ? String(it.quantity) : "",
        unitPrice: it.unit_price ? String(it.unit_price) : "",
        amount: it.amount ? String(it.amount) : "",
      })),
      conditions: inv.conditions || "Paiement à réception",
    });
    if (inv.company_name) {
      setCompany((p) => ({
        ...p,
        name: inv.company_name,
        address: inv.company_address || p.address,
        email: inv.company_email || p.email,
        ifu: inv.company_ifu || p.ifu,
        vmcf: inv.company_vmcf || p.vmcf,
        paypal: inv.company_paypal || p.paypal,
      }));
    }
    setActiveTab("edit");
  };

  // ---- DELETE ----
  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!confirm("Supprimer cette facture ?")) return;
    try {
      await api.deleteInvoice(id);
      await refreshSuggestions();
    } catch (e) {
      console.error(e);
    }
  };

  // ---- PDF ----
  const handleDownloadPDF = () => {
    setDownloading(true);
    try {
      const doc = buildInvoicePDF(company, invoice, totalTTC);
      doc.save(`Facture_${invoice.number.replace(/\//g, "-")}.pdf`);
    } catch (e) {
      console.error("PDF error:", e);
    } finally {
      setDownloading(false);
    }
  };

  // ---- CLIENT AUTOFILL ----
  const onSelectClient = (clientName) => {
    const found = savedInvoices.find((inv) => inv.client_name === clientName);
    if (found) {
      setInvoice((p) => ({
        ...p,
        clientName: found.client_name || "",
        clientAddress: found.client_address || "",
        clientCity: found.client_city || "",
      }));
    }
  };

  // ---- RENDER ----
  return (
    <div style={{ minHeight: "100vh", background: "#f0f2f5", fontFamily: "'Source Sans 3', 'Segoe UI', sans-serif" }}>
      {/* NAV */}
      <nav style={{
        background: "linear-gradient(135deg, #1a3a3a, #2a5a5a)",
        padding: isMobile ? "12px 14px" : "16px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        boxShadow: "0 2px 12px rgba(0,0,0,0.15)",
        flexWrap: isMobile ? "wrap" : "nowrap",
        gap: isMobile ? 10 : 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, background: "#2eb8b8", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "white", fontSize: 14 }}>C</div>
          <div>
            <div style={{ color: "white", fontWeight: 700, fontSize: isMobile ? 13 : 16, letterSpacing: 1 }}>CODKAGE FACTURES</div>
            <div style={{ color: "#7cc8c8", fontSize: 10 }}>
              {status || (dbReady ? "Connecté" : "Connexion...")}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {["edit", "preview", "history"].map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              padding: isMobile ? "6px 12px" : "8px 18px", borderRadius: 6, border: "none", cursor: "pointer",
              fontSize: isMobile ? 11 : 13, fontWeight: 600,
              background: activeTab === tab ? "#2eb8b8" : "rgba(255,255,255,0.1)",
              color: activeTab === tab ? "white" : "#a0d0d0",
            }}>
              {tab === "edit" ? "Éditer" : tab === "preview" ? "Aperçu" : `Historique (${savedInvoices.length})`}
            </button>
          ))}
        </div>
      </nav>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: isMobile ? "16px 10px" : "24px 16px" }}>
        {/* === EDIT === */}
        {activeTab === "edit" && (
          <div style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
            gap: isMobile ? 16 : 24,
          }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

              <Card title="Informations facture">
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
                  <Field label="N° Facture" value={invoice.number} onChange={(v) => setInvoice((p) => ({ ...p, number: v }))} />
                  <Field label="Date" type="date" value={invoice.date} onChange={(v) => setInvoice((p) => ({ ...p, date: v }))} />
                </div>
              </Card>

              <Card title="Émetteur" action={
                <button onClick={() => setShowCompanyEdit(!showCompanyEdit)} style={{ background: "none", border: "none", color: "#2eb8b8", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                  {showCompanyEdit ? "Masquer" : "Modifier"}
                </button>
              }>
                {showCompanyEdit ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <Field label="Nom" value={company.name} onChange={(v) => setCompany((p) => ({ ...p, name: v }))} />
                    <Field label="Adresse" value={company.address} onChange={(v) => setCompany((p) => ({ ...p, address: v }))} />
                    <Field label="Email" value={company.email} onChange={(v) => setCompany((p) => ({ ...p, email: v }))} />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <Field label="IFU" value={company.ifu} onChange={(v) => setCompany((p) => ({ ...p, ifu: v }))} />
                      <Field label="VMCF" value={company.vmcf} onChange={(v) => setCompany((p) => ({ ...p, vmcf: v }))} />
                    </div>
                    <Field label="PayPal" value={company.paypal} onChange={(v) => setCompany((p) => ({ ...p, paypal: v }))} />
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: "#666", lineHeight: 1.6 }}>
                    <strong>{company.name}</strong><br />{company.address}<br />{company.email}
                  </div>
                )}
              </Card>

              <Card title="Client">
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <SuggestField
                    label="Nom / Entreprise"
                    value={invoice.clientName}
                    onChange={(v) => setInvoice((p) => ({ ...p, clientName: v }))}
                    onSelect={onSelectClient}
                    suggestions={suggestions.clients}
                    placeholder="Simon HEILLES EI"
                  />
                  <Field label="Adresse" value={invoice.clientAddress} onChange={(v) => setInvoice((p) => ({ ...p, clientAddress: v }))} placeholder="78 rue Saint Gervais" />
                  <Field label="Ville / Code postal" value={invoice.clientCity} onChange={(v) => setInvoice((p) => ({ ...p, clientCity: v }))} placeholder="76000 Rouen" />
                </div>
              </Card>

              <Card title="Lignes de facturation">
                {invoice.items.map((item, idx) => (
                  <div key={item.id} style={{ marginBottom: 14, padding: isMobile ? 10 : 14, background: "#f8fafa", borderRadius: 8, border: "1px solid #e8eded" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#2eb8b8" }}>Ligne {idx + 1}</span>
                      {invoice.items.length > 1 && (
                        <button onClick={() => removeItem(item.id)} style={{ background: "none", border: "none", color: "#e55", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
                      )}
                    </div>
                    <SuggestField
                      label="Description"
                      value={item.description}
                      onChange={(v) => updateItem(item.id, "description", v)}
                      suggestions={suggestions.descriptions}
                      placeholder="Développement web (api)"
                    />
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr", gap: 10, marginTop: 8 }}>
                      <Field label="Quantité" type="number" value={item.quantity} onChange={(v) => updateItem(item.id, "quantity", v)} placeholder="-" />
                      <Field label="Prix unitaire €" type="number" value={item.unitPrice} onChange={(v) => updateItem(item.id, "unitPrice", v)} placeholder="-" />
                      <div style={isMobile ? { gridColumn: "1 / -1" } : {}}>
                        <label style={{ fontSize: 11, color: "#888", fontWeight: 600, display: "block", marginBottom: 4 }}>Montant €</label>
                        {item.quantity && parseFloat(item.quantity) > 0 ? (
                          <div style={{ padding: "8px 10px", background: "#e8f4f4", borderRadius: 6, fontSize: 14, fontWeight: 600, color: "#2a5a5a" }}>
                            {item.amount && parseFloat(item.amount) > 0 ? formatEuro(item.amount) : "—"}
                          </div>
                        ) : (
                          <input type="number" value={item.amount} onChange={(e) => updateItem(item.id, "amount", e.target.value)} placeholder="Forfait"
                            style={inputStyle} onFocus={focusHandler} onBlur={blurHandler} />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <button onClick={addItem} style={{ width: "100%", padding: "10px", background: "none", border: "2px dashed #c0dede", borderRadius: 8, color: "#2eb8b8", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
                  + Ajouter une ligne
                </button>
              </Card>

              <Card title="Conditions">
                <Field label="Conditions de paiement" value={invoice.conditions} onChange={(v) => setInvoice((p) => ({ ...p, conditions: v }))} />
              </Card>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button onClick={handleDownloadPDF} disabled={downloading} style={{ ...btnStyle, flex: 2, minWidth: 140, background: downloading ? "#88d0d0" : "#2eb8b8" }}>
                  {downloading ? "Génération..." : "Télécharger PDF"}
                </button>
                {!isMobile && (
                  <button onClick={() => setActiveTab("preview")} style={{ ...btnStyle, padding: "12px 16px", background: "#eee", color: "#555" }}>Aperçu</button>
                )}
                <button onClick={handleSave} disabled={saving} style={{ ...btnStyle, flex: 1, minWidth: 120, background: saving ? "#2a4a4a" : "#1a3a3a" }}>
                  {saving ? "Sauvegarde..." : "Sauvegarder"}
                </button>
              </div>
            </div>

            {/* MINI PREVIEW - hidden on mobile */}
            {!isMobile && (
              <div style={{ position: "sticky", top: 24, alignSelf: "start" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#888", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Aperçu en direct</div>
                <div style={{ transform: "scale(0.72)", transformOrigin: "top left", width: "138.9%" }}>
                  <InvoicePreview company={company} invoice={invoice} totalTTC={totalTTC} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* === PREVIEW === */}
        {activeTab === "preview" && (
          <div>
            <div style={{ display: "flex", gap: 10, marginBottom: 20, justifyContent: "center", flexWrap: "wrap" }}>
              <button onClick={handleDownloadPDF} disabled={downloading} style={{ ...btnStyle, background: downloading ? "#88d0d0" : "#2eb8b8" }}>
                {downloading ? "Génération..." : "Télécharger PDF"}
              </button>
              <button onClick={() => setActiveTab("edit")} style={{ ...btnStyle, background: "#eee", color: "#555" }}>← Retour</button>
            </div>
            <div style={isMobile ? { overflowX: "auto" } : {}}>
              <InvoicePreview company={company} invoice={invoice} totalTTC={totalTTC} />
            </div>
          </div>
        )}

        {/* === HISTORY === */}
        {activeTab === "history" && (
          <Card title={`Factures sauvegardées (${savedInvoices.length})`}>
            {savedInvoices.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "#aaa", fontSize: 14 }}>
                Aucune facture sauvegardée.
              </div>
            ) : (
              savedInvoices.map((s) => (
                <div key={s.id} onClick={() => loadInvoice(s)} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: isMobile ? "10px 12px" : "14px 16px", borderRadius: 8, background: "#f8fafa", marginBottom: 8,
                  cursor: "pointer", border: "1px solid #e8eded",
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.number}</div>
                    <div style={{ fontSize: 12, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.client_name || "Client non renseigné"}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 16, flexShrink: 0 }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "#2eb8b8" }}>{formatEuro(s.total_ttc)}</div>
                      <div style={{ fontSize: 12, color: "#888" }}>{s.date ? formatDateFR(s.date.split("T")[0]) : ""}</div>
                    </div>
                    <button onClick={(e) => handleDelete(s.id, e)} style={{ background: "none", border: "none", color: "#c55", cursor: "pointer", fontSize: 16 }} title="Supprimer">×</button>
                  </div>
                </div>
              ))
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

// ---- STYLES ----

const inputStyle = {
  width: "100%", padding: "8px 10px", border: "1px solid #dde5e5", borderRadius: 6,
  fontSize: 14, color: "#333", outline: "none", background: "#fafcfc",
  boxSizing: "border-box",
};
const focusHandler = (e) => (e.target.style.borderColor = "#2eb8b8");
const blurHandler = (e) => (e.target.style.borderColor = "#dde5e5");
const btnStyle = {
  padding: "12px 24px", color: "white", border: "none", borderRadius: 8,
  fontWeight: 700, fontSize: 14, cursor: "pointer",
};

// ---- COMPONENTS ----

function Card({ title, children, action }) {
  return (
    <div style={{ background: "white", borderRadius: 12, padding: "18px 20px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1a3a3a", margin: 0 }}>{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder = "" }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: "#888", fontWeight: 600, display: "block", marginBottom: 4 }}>{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={inputStyle} onFocus={focusHandler} onBlur={blurHandler} />
    </div>
  );
}

// ---- AUTOCOMPLETE ----

function SuggestField({ label, value, onChange, onSelect, suggestions = [], placeholder = "" }) {
  const [open, setOpen] = useState(false);
  const [filtered, setFiltered] = useState([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const ref = useRef();
  const listRef = useRef();

  const computeFiltered = useCallback((val) => {
    if (!suggestions.length) return [];
    if (!val || val.length === 0) return suggestions.slice(0, 8);
    const lower = val.toLowerCase();
    return suggestions.filter((s) => s.toLowerCase().includes(lower)).slice(0, 8);
  }, [suggestions]);

  const handleChange = (v) => {
    onChange(v);
    const f = computeFiltered(v);
    setFiltered(f);
    setOpen(f.length > 0);
    setActiveIdx(-1);
  };

  const handleSelect = (s) => {
    onChange(s);
    if (onSelect) onSelect(s);
    setOpen(false);
    setActiveIdx(-1);
  };

  const handleFocus = (e) => {
    e.target.style.borderColor = "#2eb8b8";
    const f = computeFiltered(value);
    setFiltered(f);
    if (f.length > 0) setOpen(true);
  };

  const handleKeyDown = (e) => {
    if (!open || filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((prev) => (prev + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((prev) => (prev <= 0 ? filtered.length - 1 : prev - 1));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      handleSelect(filtered[activeIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (activeIdx >= 0 && listRef.current) {
      const items = listRef.current.children;
      if (items[activeIdx]) items[activeIdx].scrollIntoView({ block: "nearest" });
    }
  }, [activeIdx]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Highlight matching text
  const highlight = (text, query) => {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <strong style={{ color: "#2eb8b8" }}>{text.slice(idx, idx + query.length)}</strong>
        {text.slice(idx + query.length)}
      </>
    );
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <label style={{ fontSize: 11, color: "#888", fontWeight: 600, display: "block", marginBottom: 4 }}>{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={handleFocus}
        onBlur={(e) => { e.target.style.borderColor = "#dde5e5"; }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        style={inputStyle}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div ref={listRef} style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
          background: "white", border: "1px solid #c8e0e0", borderRadius: 8, marginTop: 4,
          boxShadow: "0 8px 24px rgba(0,0,0,0.12)", maxHeight: 220, overflowY: "auto",
        }}>
          <div style={{ padding: "6px 10px", fontSize: 10, color: "#aaa", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: "1px solid #f0f0f0" }}>
            Suggestions
          </div>
          {filtered.map((s, i) => (
            <div
              key={i}
              onMouseDown={() => handleSelect(s)}
              onMouseEnter={() => setActiveIdx(i)}
              style={{
                padding: "10px 14px", cursor: "pointer", fontSize: 13, color: "#333",
                background: i === activeIdx ? "#e8f6f6" : "white",
                borderBottom: i < filtered.length - 1 ? "1px solid #f5f5f5" : "none",
                transition: "background 0.1s",
              }}
            >
              {highlight(s, value)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- INVOICE PREVIEW ----

function InvoicePreview({ company, invoice, totalTTC }) {
  return (
    <div style={{
      background: "white", maxWidth: 760, margin: "0 auto", padding: "48px 52px",
      boxShadow: "0 2px 20px rgba(0,0,0,0.08)", fontFamily: "'Source Sans 3', 'Segoe UI', sans-serif",
      borderLeft: "4px solid #d4eded", borderRight: "4px solid #d4eded",
      minWidth: 500,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: 13, lineHeight: 1.7, color: "#333" }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{company.name}</div>
          <div>{company.address}</div>
          <div style={{ color: "#2eb8b8" }}>{company.email}</div>
          <div style={{ marginTop: 12 }}>
            <div>IFU : {company.ifu}</div>
            <div>VMCF : {company.vmcf}</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 38, fontWeight: 700, color: "#666", letterSpacing: 3, fontFamily: "Georgia, serif" }}>FACTURE</div>
          <div style={{ fontSize: 14, color: "#777", marginTop: 2 }}>{invoice.number}</div>
        </div>
      </div>

      <div style={{ height: 3, background: "linear-gradient(90deg, #2eb8b8, #cceaea)", margin: "28px 0", borderRadius: 2 }} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 32 }}>
        <div>
          <div style={{ fontSize: 13, color: "#2eb8b8", fontWeight: 600, fontStyle: "italic", marginBottom: 6 }}>À l'attention de</div>
          <div style={{ fontSize: 14, lineHeight: 1.7, color: "#333" }}>
            {invoice.clientName || <span style={{ color: "#ccc" }}>Nom du client</span>}
            {invoice.clientAddress && <><br />{invoice.clientAddress}</>}
            {invoice.clientCity && <><br />{invoice.clientCity}</>}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 13, color: "#888", fontWeight: 600 }}>Date</div>
          <div style={{ fontSize: 14, marginTop: 4 }}>{formatDateFR(invoice.date)}</div>
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
        <thead>
          <tr>
            <th style={{ background: "#2eb8b8", color: "white", padding: "10px 14px", fontSize: 13, fontWeight: 600, textAlign: "left" }}>Description</th>
            <th style={{ background: "#2eb8b8", color: "white", padding: "10px 14px", fontSize: 13, fontWeight: 600, textAlign: "center" }}>Quantité</th>
            <th style={{ background: "#2eb8b8", color: "white", padding: "10px 14px", fontSize: 13, fontWeight: 600, textAlign: "center" }}>Prix unitaire €</th>
            <th style={{ background: "#2eb8b8", color: "white", padding: "10px 14px", fontSize: 13, fontWeight: 600, textAlign: "center" }}>Montant €</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item) => (
            <tr key={item.id}>
              <td style={{ padding: "12px 14px", fontSize: 13, borderBottom: "1px solid #eee", color: "#333" }}>{item.description || <span style={{ color: "#ccc" }}>—</span>}</td>
              <td style={{ padding: "12px 14px", fontSize: 13, borderBottom: "1px solid #eee", textAlign: "center" }}>{item.quantity || "-"}</td>
              <td style={{ padding: "12px 14px", fontSize: 13, borderBottom: "1px solid #eee", textAlign: "center" }}>{item.unitPrice ? formatEuro(item.unitPrice) : "-"}</td>
              <td style={{ padding: "12px 14px", fontSize: 13, borderBottom: "1px solid #eee", textAlign: "center" }}>{item.amount && parseFloat(item.amount) > 0 ? formatEuro(item.amount) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 44 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 40, background: "#f5f5f5", padding: "12px 28px", minWidth: 280 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: "#555" }}>Total TTC</span>
          <span style={{ fontWeight: 700, fontSize: 20, color: "#333", marginLeft: "auto" }}>{formatEuro(totalTTC)}</span>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ color: "#2eb8b8", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Conditions</div>
        <div style={{ fontSize: 13, color: "#555" }}>{invoice.conditions}</div>
      </div>

      <div style={{ marginBottom: 50 }}>
        <div style={{ color: "#2eb8b8", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Détails paiement</div>
        <div style={{ fontSize: 13, color: "#555" }}><strong>Paypal :</strong> {company.paypal}</div>
      </div>

      <div style={{ textAlign: "center", fontSize: 12, color: "#999", borderTop: "1px solid #e0e0e0", paddingTop: 16 }}>
        {company.name}, {company.address}
      </div>
    </div>
  );
}
