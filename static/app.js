const STEP_NAMES = ["Completeness","Summarize","Follow-up Qs","Urgency","Route","Memo"];
const URGENCY_DOT = { stat:"🔴", urgent:"🟠", routine:"🟢" };
const BADGE_CLASS = { stat:"badge-red", urgent:"badge-amber", routine:"badge-green" };
const DECISION_RESULT = {
  approve: { cls:"success", msg:"Case approved and routed. Decision logged." },
  deny:    { cls:"error",   msg:"Denial logged. Provider notification queued." },
  hold:    { cls:"warn",    msg:"Case held. Follow-up questions queued to provider." },
};
const DECISION_LABEL = { approve:"Approved & Routed", deny:"Denied with Rationale", hold:"Held — Info Requested" };

let cases = [], currentCase = null, scenarioData = {}, lastRunCaseId = null;
const el = (id) => document.getElementById(id);

// ══════════════════════════════════════════════════════════════════════════
// Boot
// ══════════════════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", async () => {
  // Login form — wire BEFORE session check so it works when not logged in
  el("btn-login").addEventListener("click", doLogin);
  el("login-pass").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
  el("login-user").addEventListener("keydown", e => { if (e.key === "Enter") el("login-pass").focus(); });
  el("toggle-pass").addEventListener("click", togglePassword);

  // Check session first
  const sess = await checkSession();
  if (!sess) return; // login overlay stays visible

  bootApp();
});

function bootApp() {
  // Tab switching
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
      btn.classList.add("active");
      el(`tab-${btn.dataset.tab}`).classList.add("active");
      if (btn.dataset.tab === "scenarios") loadScenarioGuide();
      if (btn.dataset.tab === "metrics") loadMetrics();
    });
  });

  loadScenarioData();
  loadCases();
  el("run-btn").addEventListener("click", runAgent);
  el("btn-submit-decision").addEventListener("click", submitDecision);
  el("btn-override").addEventListener("click", unlockGateForOverride);
  el("btn-export").addEventListener("click", exportMemo);
  el("btn-submit-custom").addEventListener("click", submitCustomCase);
  el("btn-reset-custom").addEventListener("click", loadCustomEditor);
  el("custom-attest").addEventListener("change", e => { el("btn-submit-custom").disabled = !e.target.checked; });
  el("btn-reset-data").addEventListener("click", resetAllData);
  el("decision-select").addEventListener("change", e => {
    const v = e.target.value, btn = el("btn-submit-decision");
    btn.disabled = !v;
    el("gate-feedback").textContent = "";
    ["sel-approve","sel-deny","sel-hold"].forEach(c => { e.target.classList.remove(c); btn.classList.remove(c); });
    if (v) { e.target.classList.add(`sel-${v}`); btn.classList.add(`sel-${v}`); }
  });
  renderStepper(Array(6).fill("pending"), null);
}

// ══════════════════════════════════════════════════════════════════════════
// Auth
// ══════════════════════════════════════════════════════════════════════════
async function checkSession() {
  try {
    const r = await fetch("/api/session");
    const d = await r.json();
    if (d.authenticated) {
      showApp(d.display_name, d.role);
      return true;
    }
  } catch(e) {}
  el("login-overlay").hidden = false;
  return false;
}

async function doLogin() {
  const username = el("login-user").value.trim();
  const password = el("login-pass").value;
  const errEl = el("login-error");
  errEl.textContent = ""; errEl.className = "login-error";
  if (!username || !password) { errEl.textContent = "Enter both fields."; return; }
  el("btn-login").disabled = true; el("btn-login").textContent = "Signing in…";
  try {
    const r = await fetch("/api/login", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ username, password }),
    });
    const d = await r.json();
    if (!r.ok) { errEl.textContent = d.error || "Login failed."; el("btn-login").disabled = false; el("btn-login").textContent = "Sign In"; return; }
    errEl.className = "login-success"; errEl.textContent = `Welcome, ${d.display_name}`;
    setTimeout(() => {
      showApp(d.display_name, d.role);
      bootApp();
    }, 600);
  } catch(e) { errEl.textContent = "Server unreachable."; el("btn-login").disabled = false; el("btn-login").textContent = "Sign In"; }
}

function togglePassword() {
  const inp = el("login-pass");
  const icon = el("toggle-pass");
  if (inp.type === "password") { inp.type = "text"; icon.textContent = "🙈"; icon.title = "Hide password"; }
  else { inp.type = "password"; icon.textContent = "👁"; icon.title = "Show password"; }
}

function showApp(name, role) {
  el("login-overlay").hidden = true;
  el("app-shell").hidden = false;
  el("user-badge").innerHTML = `${escapeHtml(name)} <span style="opacity:.6">· ${escapeHtml(role)}</span> <span style="margin-left:6px;cursor:pointer" id="logout-link" title="Sign out">⏻</span>`;
  setTimeout(() => {
    const logoutEl = document.getElementById("logout-link");
    if (logoutEl) logoutEl.addEventListener("click", async () => {
      await fetch("/api/logout", {method:"POST"});
      location.reload();
    });
  }, 50);
}

// ══════════════════════════════════════════════════════════════════════════
// Stepper
// ══════════════════════════════════════════════════════════════════════════
function renderStepper(states, pct) {
  const labels = ["Completeness","Clinical\nSummary","Follow-up\nQuestions","Urgency\nAssessment","Routing\nDecision","Recommendation\nMemo"];
  let h = '<div class="pipeline">';
  states.forEach((s, i) => {
    const icon = s === "done" ? "✓" : s === "running" ? "" : (i + 1);
    const spinHtml = s === "running" ? '<span class="pip-spin"></span>' : "";
    h += `<div class="pip-step ${s}">`;
    h += `<div class="pip-circle">${spinHtml}${icon}</div>`;
    h += `<div class="pip-label">${labels[i].replace("\n","<br>")}</div>`;
    h += `</div>`;
    if (i < states.length - 1) h += `<div class="pip-line ${states[i]==='done'?'done':''}"></div>`;
  });
  // Human gate
  h += `<div class="pip-line ${states[5]==='done'?'done':''}"></div>`;
  h += `<div class="pip-step gate"><div class="pip-circle gate-circle">⚑</div><div class="pip-label">Human<br>Gate</div></div>`;
  h += '</div>';
  if (pct !== null && pct > 0) h += `<div class="pip-pct">${pct}%</div>`;
  el("stepper-strip").innerHTML = h;
}

// ══════════════════════════════════════════════════════════════════════════
// Cases
// ══════════════════════════════════════════════════════════════════════════
let caseListenerBound = false;

async function loadScenarioData() {
  try { scenarioData = await (await fetch("/api/scenarios")).json(); } catch(e) {}
}

async function loadCases(selectId) {
  try { cases = await (await fetch("/api/cases")).json(); } catch(e) { return; }
  const sel = el("case-select");
  sel.innerHTML = cases.map(c => {
    const lbl = c.procedure_description || "(no description)";
    return `<option value="${c.case_id}">${URGENCY_DOT[c.urgency_flag]||"⚪"} ${escapeHtml(c.case_id)} — ${escapeHtml(lbl)}</option>`;
  }).join("");
  if (!caseListenerBound) { sel.addEventListener("change", () => loadCase(sel.value)); caseListenerBound = true; }
  const target = selectId && cases.some(c => c.case_id===selectId) ? selectId : (cases[0]||{}).case_id;
  if (target) { sel.value = target; await loadCase(target); }
}

async function loadCase(caseId) {
  try { currentCase = await (await fetch(`/api/cases/${caseId}`)).json(); } catch(e) { return; }
  el("intake-json").textContent = JSON.stringify(currentCase, null, 2);
  el("case-meta").innerHTML = `
    <span><strong>Member:</strong> ${currentCase.member_name||'—'}</span>
    <span><strong>Plan:</strong> ${currentCase.plan_id||'—'}</span>
    <span><strong>Procedure:</strong> ${currentCase.procedure_code||'—'}</span>
    <span><strong>Provider:</strong> ${currentCase.requesting_provider||'—'}</span>
    <span><strong>Declared:</strong> ${URGENCY_DOT[currentCase.urgency_flag]||""} ${(currentCase.urgency_flag||"routine").toUpperCase()}</span>`;

  showScenarioHint(caseId);
  // Reset UI
  renderStepper(Array(6).fill("pending"), null);
  el("kpi-row").hidden = true;
  el("steps-panel").hidden = true;
  el("human-gate").hidden = true;
  el("audit-panel").hidden = true;
  el("export-row").hidden = true;
  el("run-status").textContent = "";
  el("run-status").className = "run-status";
  removeCachedBanner();
  resetDecisionGate();
  loadCustomEditor();

  // Restore cached results if this case was already run
  try {
    const cr = await (await fetch(`/api/results/${caseId}`)).json();
    if (cr.cached && cr.results) restoreCachedResults(cr.results);
  } catch(e) {}
  restoreDecisionIfAny(caseId);
}

function showScenarioHint(caseId) {
  const hint = el("scenario-hint"), s = scenarioData[caseId];
  if (!s) { hint.hidden = true; return; }
  hint.hidden = false;
  hint.innerHTML = `<div class="hint-category">${escapeHtml(s.category)}</div>
    <div class="hint-title">${escapeHtml(s.title)}</div>
    <div style="font-size:12.5px;color:#475569;margin-bottom:4px">${escapeHtml(s.what_it_tests)}</div>
    <strong style="font-size:11px;color:#1B5A8A">What to verify:</strong>
    <ol class="hint-checks">${s.what_to_verify.map(v=>`<li>${escapeHtml(v)}</li>`).join("")}</ol>`;
}

// ── Cached result restoration ─────────────────────────────────────────────
function restoreCachedResults(results) {
  const steps = results.steps;
  // Show banner
  removeCachedBanner();
  const banner = document.createElement("div");
  banner.className = "cached-banner"; banner.id = "cached-banner";
  const when = results.started_at ? new Date(results.started_at).toLocaleString() : "—";
  const reviewer = results.reviewed_by || "—";
  banner.innerHTML = `<span class="cached-dot"></span>Previous results from ${when} (${escapeHtml(reviewer)}) — click <strong>Run PA Agent</strong> for a fresh analysis`;
  el("stepper-strip").insertAdjacentElement("afterend", banner);

  // Rebuild step accordions
  el("steps-container").innerHTML = "";
  el("steps-panel").hidden = false;
  STEP_NAMES.forEach((_,i) => stepBlock(i+1, stepFullName(i+1), "✅"));

  if (steps["1_completeness"]) renderStepResult(1, "Field Completeness", steps["1_completeness"]);
  if (steps["2_clinical_summary"]) renderStepResult(2, "Clinical Summary", { summary: steps["2_clinical_summary"] });
  if (steps["3_followup_questions"]) renderStepResult(3, "Follow-up Questions", steps["3_followup_questions"]);
  if (steps["4_urgency"]) renderStepResult(4, "Urgency Assessment", steps["4_urgency"]);
  if (steps["5_routing"]) renderStepResult(5, "Routing Decision", steps["5_routing"]);
  if (steps["6_recommendation_memo"]) renderStepResult(6, "Recommendation Memo", { memo: steps["6_recommendation_memo"] });

  renderStepper(Array(6).fill("done"), 100);
  el("run-status").className = "run-status complete";
  el("run-status").textContent = "✓ Showing cached results";
  finishRun(results);
}

function removeCachedBanner() {
  const b = document.getElementById("cached-banner");
  if (b) b.remove();
}

// ── Custom case ───────────────────────────────────────────────────────────
function loadCustomEditor() {
  const box = el("custom-json");
  if (!box || !currentCase) return;
  const draft = { ...currentCase }; delete draft.case_id; delete draft.submitted_at; delete draft.source;
  box.value = JSON.stringify(draft, null, 2);
  el("custom-feedback").textContent = ""; el("custom-feedback").className = "gate-feedback";
}

async function submitCustomCase() {
  const feedback = el("custom-feedback"), btn = el("btn-submit-custom");
  let parsed;
  try { parsed = JSON.parse(el("custom-json").value); }
  catch(e) { feedback.className="gate-feedback error"; feedback.textContent="Invalid JSON: "+e.message; return; }
  btn.disabled = true; feedback.className="gate-feedback"; feedback.textContent="Submitting…";
  try {
    const r = await fetch("/api/cases/custom",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({attestation:el("custom-attest").checked,case:parsed})});
    const d = await r.json().catch(()=>({}));
    if (!r.ok) { feedback.className="gate-feedback error"; feedback.textContent=d.error||`Rejected (${r.status}).`; btn.disabled=false; return; }
    await loadCases(d.case_id);
    feedback.className="gate-feedback success"; feedback.textContent=`${d.case_id} added. Click Run PA Agent.`;
    el("custom-case").open = false;
    el("run-btn").scrollIntoView({behavior:"smooth",block:"center"});
  } catch(e) { feedback.className="gate-feedback error"; feedback.textContent="Server unreachable."; }
  finally { btn.disabled = !el("custom-attest").checked; }
}

// ══════════════════════════════════════════════════════════════════════════
// Step rendering
// ══════════════════════════════════════════════════════════════════════════
function stepBlock(n, name, icon) {
  let b = document.getElementById(`step-block-${n}`);
  if (b) return b;
  b = document.createElement("details"); b.className="step-block"; b.id=`step-block-${n}`;
  b.innerHTML = `<summary><span class="step-icon" id="step-icon-${n}">${icon}</span>
    <span class="step-name">Step ${n} — ${name}</span><span class="step-sub" id="step-sub-${n}"></span></summary>
    <div class="step-body" id="step-body-${n}"></div>`;
  el("steps-container").appendChild(b);
  return b;
}

function renderStepResult(n, name, data) {
  const ic=el(`step-icon-${n}`), sub=el(`step-sub-${n}`), body=el(`step-body-${n}`);
  if (n===1) {
    const ok=data.complete, safety=data.input_safety||{suspicious:false,findings:[]};
    ic.textContent=(ok&&!safety.suspicious)?"✅":"⚠️";
    const bits=[]; bits.push(ok?"All fields present":`${data.missing_fields.length} field(s) missing`);
    if (safety.suspicious) bits.push(`${safety.findings.length} safety flag(s)`);
    sub.textContent=bits.join(" · ");
    let h=ok?`<span class="badge badge-green">All required fields present</span>`
      :`<span class="badge badge-amber">${data.missing_fields.length} field(s) missing</span><ul>${data.missing_fields.map(f=>`<li><code>${escapeHtml(f)}</code></li>`).join("")}</ul>`;
    if (safety.suspicious) h+=`<p><span class="badge badge-red">⚠ Input safety: ${safety.findings.length} suspicious pattern(s) neutralised</span></p><ul>${safety.findings.map(f=>`<li><code>${escapeHtml(f)}</code></li>`).join("")}</ul><p class="rationale-text">Flagged in: ${safety.fields_flagged.map(escapeHtml).join(", ")}. ${escapeHtml(safety.action)}</p>`;
    else h+=`<p><span class="badge badge-green">Input safety: no suspicious content detected</span></p>`;
    body.innerHTML=h;
  }
  if (n===2) { ic.textContent="📝"; sub.textContent=""; body.innerHTML=`<div class="memo-box">${renderMarkdown(data.summary)}</div>`; }
  if (n===3) {
    const gaps=data.has_gaps; ic.textContent=gaps?"❓":"✅"; sub.textContent=gaps?`${data.questions.length} question(s)`:"No gaps";
    if (!gaps) body.innerHTML=`<span class="badge badge-green">No gaps — submission complete</span>`;
    else {
      const sl={deterministic:"Field check",ai_review:"AI clinical review"}, sb={deterministic:"badge-blue",ai_review:"badge-teal"};
      body.innerHTML=`<span class="badge badge-amber">${data.questions.length} question(s) to send provider</span>`+
        data.questions.map(q=>{const src=q.source||"deterministic",lbl=escapeHtml(String(q.field||"")).replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());
        return `<p><span class="badge ${sb[src]||'badge-blue'}" style="margin-right:6px">${sl[src]||src}</span><strong>${lbl}:</strong> ${escapeHtml(String(q.question||""))}</p>`;}).join("");
    }
  }
  if (n===4) {
    const m=data.urgency_match; ic.textContent=m?"✅":"⚠️";
    sub.textContent=`Declared ${data.declared_urgency.toUpperCase()} / AI ${data.ai_assessed_urgency.toUpperCase()}`;
    body.innerHTML=`Declared: <span class="badge ${BADGE_CLASS[data.declared_urgency]||''}">${data.declared_urgency.toUpperCase()}</span>&nbsp;&nbsp;
      AI assessed: <span class="badge ${BADGE_CLASS[data.ai_assessed_urgency]||''}">${data.ai_assessed_urgency.toUpperCase()}</span>
      <div class="rationale-text">${renderMarkdown(data.rationale||"")}</div>
      ${data.flag_for_human_review?`<span class="badge badge-amber">⚠ Flagged for human review</span>`:""}`;
  }
  if (n===5) {
    ic.textContent="📂"; sub.textContent=data.queue;
    body.innerHTML=`<span class="badge badge-blue">${data.queue}</span>
      <p>SLA: <strong>${data.sla_hours}h</strong> · Category: <strong>${data.procedure_category.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase())}</strong> · Escalate: <strong>${data.escalate?"Yes":"No"}</strong></p>
      <p>Human approval: <span class="badge ${data.requires_human_approval?'badge-red':'badge-green'}">${data.requires_human_approval?"Required":"Not required"}</span></p>
      ${data.requires_human_approval?`<p class="rationale-text">Reason: ${escapeHtml(data.human_approval_reason)}</p>`:""}`;
  }
  if (n===6) { ic.textContent="🗒️"; sub.textContent="Assembled from steps 1–5 — no model call"; body.innerHTML=`<div class="memo-box">${renderMarkdown(data.memo)}</div>`; }
}

function escapeHtml(s) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function inlineMarkdown(s) { return s.replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>"); }
function renderMarkdown(text) {
  if (!text) return "";
  const lines=escapeHtml(text).trim().split("\n"); let html="",buf=[],i=0;
  const flush=()=>{if(buf.length){const t=buf.join(" "),m=t.match(/^\*\*(.+?)\*\*\s*(.*)$/);
    if(m&&m[2].trim().length>0){html+=`<p class="memo-heading">${inlineMarkdown("**"+m[1]+"**")}</p><p>${inlineMarkdown(m[2].trim())}</p>`;}
    else html+=`<p>${inlineMarkdown(t)}</p>`;buf=[];}};
  while(i<lines.length){const l=lines[i].trim();
    if(l===""){flush();i++;continue;}
    if(/^\d+\.\s+/.test(l)){flush();const items=[];while(i<lines.length&&/^\d+\.\s+/.test(lines[i].trim())){items.push(`<li>${inlineMarkdown(lines[i].trim().replace(/^\d+\.\s+/,""))}</li>`);i++;}html+=`<ol>${items.join("")}</ol>`;continue;}
    if(/^[-*]\s+/.test(l)){flush();const items=[];while(i<lines.length&&/^[-*]\s+/.test(lines[i].trim())){items.push(`<li>${inlineMarkdown(lines[i].trim().replace(/^[-*]\s+/,""))}</li>`);i++;}html+=`<ul>${items.join("")}</ul>`;continue;}
    buf.push(l);i++;}flush();return html;
}
function stepFullName(n){return["Field Completeness","Clinical Summary","Follow-up Questions","Urgency Assessment","Routing Decision","Recommendation Memo"][n-1];}

// ══════════════════════════════════════════════════════════════════════════
// Run agent (SSE)
// ══════════════════════════════════════════════════════════════════════════
function runAgent() {
  const caseId=el("case-select").value, btn=el("run-btn"), st=el("run-status");
  btn.disabled=true; st.className="run-status active"; st.textContent="Running…";
  removeCachedBanner();
  el("steps-container").innerHTML=""; el("steps-panel").hidden=false;
  el("kpi-row").hidden=true; el("human-gate").hidden=true; el("audit-panel").hidden=true; el("export-row").hidden=true;
  resetDecisionGate();
  STEP_NAMES.forEach((_,i)=>stepBlock(i+1,stepFullName(i+1),"⏳"));
  const states=Array(6).fill("pending"); renderStepper(states,0);
  const src=new EventSource(`/api/run/${caseId}`);
  src.onmessage=(e)=>{
    const m=JSON.parse(e.data);
    if(m.event==="step"){const idx=m.step-1;
      if(m.status==="running"){states[idx]="running";el(`step-icon-${m.step}`).innerHTML=`<span class="spin"></span>`;}
      else if(m.status==="done"){states[idx]="done";renderStepResult(m.step,m.name,m.data);}
      renderStepper(states,m.percent);}
    if(m.event==="complete"){finishRun(m.results);src.close();btn.disabled=false;st.className="run-status complete";st.textContent="✓ Complete — ready for human review";}
    if(m.event==="error"){st.className="run-status";st.textContent="Error: "+m.message;btn.disabled=false;src.close();}
  };
  src.onerror=()=>{btn.disabled=false;src.close();};
}

function finishRun(results) {
  const s=results.steps, comp=s["1_completeness"], urg=s["4_urgency"], rt=s["5_routing"];
  lastRunCaseId=results.case_id;
  el("kpi-row").hidden=false;
  const kC=el("kpi-completeness"); kC.querySelector(".kpi-value").textContent=comp.complete?"✓ Complete":`${comp.missing_fields.length} gaps`; kC.className="kpi-card"+(comp.complete?"":" warn");
  const kU=el("kpi-urgency"); kU.querySelector(".kpi-value").textContent=urg.ai_assessed_urgency.toUpperCase(); kU.className="kpi-card"+(urg.ai_assessed_urgency==="stat"?" danger":urg.ai_assessed_urgency==="urgent"?" warn":"");
  const kM=el("kpi-match"); kM.querySelector(".kpi-value").textContent=urg.urgency_match?"✓ Yes":"⚠ Mismatch"; kM.className="kpi-card"+(urg.urgency_match?"":" warn");
  el("kpi-sla").querySelector(".kpi-value").textContent=`${rt.sla_hours}h`;
  el("kpi-latency").querySelector(".kpi-value").textContent=results.total_latency_ms?`${(results.total_latency_ms/1000).toFixed(1)}s`:"—";
  el("human-gate").hidden=false; el("gate-status").textContent=results.human_approval_gate?results.human_approval_gate.status:"PENDING";
  el("export-row").hidden=false;
  el("audit-panel").hidden=false;
  const log=results.audit_log||[], ai=log.filter(e=>e.ai_assisted);
  el("audit-summary").innerHTML=`<strong>Run:</strong> <code>${escapeHtml(results.run_id||"—")}</code> · <strong>Model:</strong> <code>${escapeHtml(results.model||"—")}</code> · <strong>Steps:</strong> ${log.length} (${ai.length} AI, ${log.length-ai.length} deterministic) · <strong>Total:</strong> ${results.total_latency_ms?(results.total_latency_ms/1000).toFixed(1)+"s":"—"}<br><span class="audit-note">Each entry logs step, model, prompt version, prompt hash, token counts, latency, UTC timestamp.</span>`;
  el("audit-json").textContent=JSON.stringify(results,null,2);
  el("human-gate").dataset.caseId=results.case_id;
  restoreDecisionIfAny(results.case_id);
}

function exportMemo() { if (lastRunCaseId) window.open(`/api/export/${lastRunCaseId}`,"_blank"); }

async function resetAllData() {
  if (!confirm("This will clear all run history, cached results, decisions, and custom cases.\n\nBundled test cases and your login session are not affected.\n\nContinue?")) return;
  try {
    const r = await fetch("/api/reset", { method: "POST" });
    const d = await r.json();
    if (!r.ok) { alert(d.error || "Reset failed."); return; }
    alert(`Data cleared:\n• ${d.cleared.run_history} run(s)\n• ${d.cleared.cached_results} cached result(s)\n• ${d.cleared.decisions} decision(s)\n• ${d.cleared.custom_cases} custom case(s)\n\nThe app is ready for a fresh start.`);
    lastRunCaseId = null;
    await loadCases();
    renderStepper(Array(6).fill("pending"), null);
  } catch(e) { alert("Server unreachable."); }
}

// ══════════════════════════════════════════════════════════════════════════
// Human decision gate — supports override + audit history
// ══════════════════════════════════════════════════════════════════════════
async function restoreDecisionIfAny(caseId) {
  try {
    const d = await (await fetch(`/api/decision/${caseId}`)).json();
    if (d.decision) {
      el("human-gate").hidden=false; el("human-gate").dataset.caseId=caseId;
      lockGate(d.decision.action, d.decision.rationale, d.decision.timestamp, d.decision.reviewer);
      el("gate-feedback").className="gate-feedback"; el("gate-feedback").textContent="";
      if (d.history && d.history.length > 1) showDecisionHistory(d.history);
    }
  } catch(e) {}
}

async function submitDecision() {
  const sel=el("decision-select"), ratEl=el("decision-rationale"), fb=el("gate-feedback");
  const action=sel.value, rationale=ratEl.value.trim();
  if (!action) { fb.className="gate-feedback error"; fb.textContent="Select a decision."; return; }
  if (action==="deny" && !rationale) { fb.className="gate-feedback error"; fb.textContent="Rationale required for denial."; ratEl.focus(); return; }
  const caseId=el("human-gate").dataset.caseId, btn=el("btn-submit-decision");
  btn.disabled=true; fb.className="gate-feedback"; fb.textContent="Logging…";
  try {
    const r = await fetch("/api/decision",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({case_id:caseId,action,rationale:rationale||null,timestamp:new Date().toISOString()})});
    if (!r.ok) { const e=await r.json().catch(()=>({})); fb.className="gate-feedback error"; fb.textContent=e.error||`Rejected (${r.status}).`; btn.disabled=false; return; }
    const data=await r.json();
    fb.className=`gate-feedback ${DECISION_RESULT[action].cls}`;
    fb.textContent=data.is_override ? `Decision overridden to ${action.toUpperCase()}. Override #${data.total_decisions-1} recorded.` : DECISION_RESULT[action].msg;
    lockGate(action, rationale||null, new Date().toISOString(), data.logged.reviewer);
    // Refresh history
    const hd=await (await fetch(`/api/decision/${caseId}`)).json();
    if (hd.history && hd.history.length>1) showDecisionHistory(hd.history);
  } catch(e) { fb.className="gate-feedback error"; fb.textContent="Server error."; btn.disabled=false; }
}

function lockGate(action, rationale, ts, reviewer) {
  const sel=el("decision-select"), ratEl=el("decision-rationale"), btn=el("btn-submit-decision");
  sel.value=action; sel.disabled=true;
  ["sel-approve","sel-deny","sel-hold"].forEach(c=>{sel.classList.remove(c);btn.classList.remove(c);});
  sel.classList.add(`sel-${action}`);
  if (rationale) ratEl.value=rationale; ratEl.disabled=true;
  btn.disabled=true; btn.classList.add(`sel-${action}`); btn.textContent="Decision submitted";
  el("gate-status").textContent="CLOSED — decision recorded";
  const old=document.querySelector(".decision-locked"); if(old)old.remove();

  const actionLabels = { approve:"✓ APPROVED", deny:"✗ DENIED", hold:"⏸ HELD — Info Requested" };
  const when=ts?new Date(ts).toLocaleString():"—";
  const lk=document.createElement("div");
  lk.className=`decision-locked dl-${action}`;
  lk.innerHTML=`<div class="dl-action-label">${actionLabels[action]||action.toUpperCase()}</div>
    <div class="dl-detail"><strong>Reviewer:</strong> ${escapeHtml(reviewer||'—')}</div>
    ${rationale?`<div class="dl-detail"><strong>Rationale:</strong> ${escapeHtml(rationale)}</div>`:""}
    <div class="dl-detail"><strong>Recorded:</strong> ${when}</div>`;
  el("gate-feedback").insertAdjacentElement("afterend",lk);
  el("btn-override").hidden=false;
}

function unlockGateForOverride() {
  const sel=el("decision-select"), ratEl=el("decision-rationale"), btn=el("btn-submit-decision");
  sel.disabled=false; sel.value="";
  ["sel-approve","sel-deny","sel-hold"].forEach(c=>{sel.classList.remove(c);btn.classList.remove(c);});
  ratEl.disabled=false; ratEl.value=""; ratEl.placeholder="Rationale for override";
  btn.disabled=true; btn.textContent="Submit override";
  el("gate-status").textContent="OVERRIDE IN PROGRESS";
  el("gate-feedback").textContent=""; el("gate-feedback").className="gate-feedback";
  el("btn-override").hidden=true;
  const lk=document.querySelector(".decision-locked"); if(lk)lk.remove();
}

function showDecisionHistory(history) {
  const c=el("decision-history");
  if (!history||history.length<=1){c.hidden=true;return;}
  c.hidden=false;
  const actionIcons = { approve:"✓", deny:"✗", hold:"⏸" };
  let h=`<div class="dh-title">Decision Audit Trail — ${history.length} entries</div>`;
  // Show active (latest) first, then prior in reverse chronological order
  const reversed = [...history].reverse();
  reversed.forEach((d,ri)=>{
    const originalIdx = history.length - 1 - ri;
    const active = originalIdx === history.length-1;
    const when=d.timestamp?new Date(d.timestamp).toLocaleString():"—";
    const icon = actionIcons[d.action]||"·";
    if (active) {
      h+=`<div class="dh-entry dh-active">
        <strong>${icon} ${(d.action||"—").toUpperCase()}</strong> by <strong>${escapeHtml(d.reviewer||"—")}</strong>
        <span style="color:var(--text-muted);font-size:12px"> · ${when}</span>
        ${d.rationale?`<br><span style="font-size:12.5px">↳ ${escapeHtml(d.rationale)}</span>`:""}
        ${d.is_override?'&nbsp;<span class="badge badge-amber" style="font-size:10px">OVERRIDE</span>':""}
        &nbsp;<span class="badge badge-green" style="font-size:10px">CURRENT</span>
      </div>`;
    } else {
      h+=`<div class="dh-entry">
        <span style="font-size:11px;color:var(--text-muted)">#${originalIdx+1}</span>&nbsp;
        ${icon} <strong style="color:var(--text-muted)">${(d.action||"—").toUpperCase()}</strong>
        by ${escapeHtml(d.reviewer||"—")}
        <span style="font-size:12px"> · ${when}</span>
        ${d.rationale?`<br><span style="font-size:12px;color:var(--text-muted)">↳ ${escapeHtml(d.rationale)}</span>`:""}
        <span style="font-size:10px;color:var(--text-muted);margin-left:4px">SUPERSEDED</span>
      </div>`;
    }
  });
  c.innerHTML=h;
}

function resetDecisionGate() {
  const sel=el("decision-select"), ratEl=el("decision-rationale"), btn=el("btn-submit-decision");
  if (!sel) return;
  sel.disabled=false; sel.value="";
  ["sel-approve","sel-deny","sel-hold"].forEach(c=>{sel.classList.remove(c);btn.classList.remove(c);});
  ratEl.disabled=false; ratEl.value=""; ratEl.placeholder="Rationale (required for Deny, optional otherwise)";
  btn.disabled=true; btn.textContent="Submit decision";
  el("gate-feedback").textContent=""; el("gate-feedback").className="gate-feedback";
  el("btn-override").hidden=true; el("decision-history").hidden=true;
  const lk=document.querySelector(".decision-locked"); if(lk)lk.remove();
}

// ══════════════════════════════════════════════════════════════════════════
// Scenario Guide
// ══════════════════════════════════════════════════════════════════════════
async function loadScenarioGuide() {
  if (!Object.keys(scenarioData).length) await loadScenarioData();
  el("scenario-grid").innerHTML = Object.entries(scenarioData).map(([id,s]) => `
    <div class="scenario-card urgency-${s.badge}">
      <div class="sc-header"><span class="sc-id">${escapeHtml(id)}</span><span class="sc-category">${escapeHtml(s.category)}</span></div>
      <div class="sc-title">${escapeHtml(s.title)}</div>
      <div class="sc-desc">${escapeHtml(s.what_it_tests)}</div>
      <ol class="sc-checks">${s.what_to_verify.map(v=>`<li>${escapeHtml(v)}</li>`).join("")}</ol>
      <button class="sc-btn" onclick="jumpToCase('${id}')">▶ Run this case</button>
    </div>`).join("");
}

function jumpToCase(caseId) {
  document.querySelectorAll(".nav-btn").forEach(b=>b.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(t=>t.classList.remove("active"));
  document.querySelector('[data-tab="workflow"]').classList.add("active");
  el("tab-workflow").classList.add("active");
  el("case-select").value=caseId; loadCase(caseId);
  setTimeout(()=>el("run-btn").scrollIntoView({behavior:"smooth",block:"center"}),150);
}

// ══════════════════════════════════════════════════════════════════════════
// Metrics
// ══════════════════════════════════════════════════════════════════════════
async function loadMetrics() {
  try {
    const [mr,hr] = await Promise.all([fetch("/api/metrics"),fetch("/api/history")]);
    const metrics=await mr.json(), history=await hr.json();
    if (!metrics.total_runs) { el("metrics-intro").textContent="No runs yet. Process cases from the Workflow tab first."; el("metrics-kpis").hidden=true; el("metrics-charts").hidden=true; el("metrics-history").hidden=true; return; }
    el("metrics-intro").textContent=`${metrics.total_runs} run(s) recorded this session.`;
    const kpis=el("metrics-kpis"); kpis.hidden=false;
    kpis.innerHTML=`<div class="m-kpi"><div class="m-label">Total Runs</div><div class="m-val">${metrics.total_runs}</div></div>
      <div class="m-kpi"><div class="m-label">Avg Latency</div><div class="m-val">${(metrics.avg_latency_ms/1000).toFixed(1)}s</div><div class="m-sub">Min ${(metrics.min_latency_ms/1000).toFixed(1)}s · Max ${(metrics.max_latency_ms/1000).toFixed(1)}s</div></div>
      <div class="m-kpi"><div class="m-label">Urgency Match</div><div class="m-val">${metrics.urgency_match_rate}%</div><div class="m-sub">${metrics.mismatch_count} mismatch(es)</div></div>
      <div class="m-kpi"><div class="m-label">Human Gate Rate</div><div class="m-val">${metrics.human_approval_rate}%</div></div>
      <div class="m-kpi"><div class="m-label">Safety Flags</div><div class="m-val">${metrics.safety_flag_count}</div></div>`;
    const ch=el("metrics-charts"); ch.hidden=false;
    const sa=metrics.avg_step_latency_ms||{}, mx=Math.max(...Object.values(sa),1);
    const labels=["Complete","Summary","Follow-up","Urgency","Routing","Memo"], isAI=[false,true,true,true,false,false];
    ch.innerHTML=`<div class="chart-title">Average Latency per Step</div><div class="lat-chart">${[1,2,3,4,5,6].map((s,i)=>{
      const lat=sa[s]||0, pct=Math.max((lat/mx)*100,2);
      return `<div class="lat-bar-wrap"><div class="lat-bar-val">${lat<10?lat.toFixed(0)+"ms":(lat/1000).toFixed(1)+"s"}</div><div class="lat-bar ${isAI[i]?'ai':''}" style="height:${pct}%"></div><div class="lat-bar-label">${labels[i]}</div></div>`;
    }).join("")}</div><div class="chart-legend"><span class="leg-det">Deterministic</span><span class="leg-ai">AI (Claude)</span></div>
    <div class="chart-title" style="margin-top:20px">Urgency Distribution</div><div class="urg-dist">${["stat","urgent","routine"].map(u=>{
      const cnt=(metrics.urgency_distribution||{})[u]||0, pct=metrics.total_runs?(cnt/metrics.total_runs*100):0;
      return `<div class="urg-bar-group"><div class="urg-bar-label">${u.toUpperCase()} <span style="font-weight:400;color:#6B7A89">(${cnt})</span></div><div class="urg-bar-track"><div class="urg-bar-fill ${u}" style="width:${pct}%"></div></div></div>`;
    }).join("")}</div>`;
    el("metrics-history").hidden=false;
    el("history-tbody").innerHTML=history.map(r=>`<tr>
      <td><code style="font-size:11px">${escapeHtml(r.run_id||'—')}</code></td><td>${escapeHtml(r.case_id)}</td>
      <td><span class="badge ${BADGE_CLASS[r.urgency_declared]||''}">${(r.urgency_declared||'—').toUpperCase()}</span></td>
      <td><span class="badge ${BADGE_CLASS[r.urgency_assessed]||''}">${(r.urgency_assessed||'—').toUpperCase()}</span></td>
      <td>${r.urgency_match?'✓':'⚠ Mismatch'}</td><td>${escapeHtml(r.queue||'—')}</td>
      <td>${r.human_required?'<span class="badge badge-red">Required</span>':'<span class="badge badge-green">Not required</span>'}</td>
      <td>${r.total_latency_ms?(r.total_latency_ms/1000).toFixed(1)+'s':'—'}</td></tr>`).join("");
  } catch(e) { el("metrics-intro").textContent="Failed to load metrics."; }
}
