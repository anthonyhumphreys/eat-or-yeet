import { App, PostMessageTransport, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";

import { isValidGtin } from "../../../src/lib/domain/gtin";
import {
  AgentObservationSchema,
  PublicCheckResultSchema,
  PublicCoverageSchema,
  PublicSearchResultSchema,
  PublicWarningDetailsSchema,
} from "../../../src/lib/integrations/contracts";
import {
  beginRequest,
  cancelRequest,
  commitRequest,
  draftFromUnknown,
  emptyDraft,
  failRequest,
  emptySubmittedObservation,
  initialRequestState,
  isRecord,
  makeCheckInput,
  regionFromUnknown,
  type ProductDraft,
  type Region,
  type SubmittedObservation,
  type ToolName,
  type RequestState,
} from "./state";

type ToolInput = { tool: ToolName; arguments: Record<string, unknown> };
type UnknownResult = Record<string, unknown>;
type View = "check" | "warnings" | "detail" | "coverage";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("App root is missing.");

const app = new App({ name: "eat-or-yeet-view", version: "1.0.0" }, { tools: {} });

let region: Region | null = null;
let draft: ProductDraft = emptyDraft();
let submittedObservation: SubmittedObservation = emptySubmittedObservation();
let view: View = "check";
let state: RequestState = initialRequestState();
let lastCheck: RequestState["completed"] = null;
let currentTool: ToolName | null = null;
let pagination: ToolInput | null = null;
let pendingInput: ToolInput | null = null;
let searchQueryDraft = "";
let nextRequestId = 1;
let activeController: AbortController | null = null;
let requestOrigin: "app" | "host" | null = null;
let requestFocusKey: string | null = null;

const status = node("p", "status-line");
status.setAttribute("role", "status");
status.setAttribute("aria-live", "polite");
status.tabIndex = -1;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function text(parent: Element, value: unknown, className?: string): HTMLElement {
  const element = node("span", className, typeof value === "string" ? value : "—");
  parent.append(element);
  return element;
}

function paragraph(parent: Element, value: unknown, className?: string): HTMLParagraphElement {
  const element = node("p", className, typeof value === "string" ? value : "");
  parent.append(element);
  return element;
}

function headingTitle(value: string, className?: string): HTMLHeadingElement {
  const heading = node("h2", className, value);
  heading.dataset.focusKey = "view-heading";
  heading.tabIndex = -1;
  return heading;
}

function activeFocusKey(): string | null {
  const active = document.activeElement;
  return active instanceof HTMLElement ? active.dataset.focusKey ?? null : null;
}

function renderRetainedFacts(): HTMLElement | null {
  const candidates: Array<[string, unknown]> = [
    ["Producer", submittedObservation.producer],
    ["Farm code", submittedObservation.farmCode],
    ["Country of origin", submittedObservation.countryOfOrigin],
    ["Establishment number", submittedObservation.establishmentNumber],
    ["Approval number", submittedObservation.approvalNumber],
    ["Retailer", submittedObservation.retailer],
    ["Category", submittedObservation.category],
    ["Egg farming method", submittedObservation.eggMark?.farmingMethod],
    ["Egg mark country", submittedObservation.eggMark?.country],
    ["Egg producer code", submittedObservation.eggMark?.producerCode],
    ["Production date", submittedObservation.dates?.productionDate],
  ];
  const extras: Array<[string, string]> = [];
  for (const [label, value] of candidates) {
    if (typeof value === "string" && value.trim()) extras.push([label, value]);
  }
  const hasSubmittedFacts = Object.entries(submittedObservation).some(([key, value]) => key === "eggMark" || key === "dates"
    ? isRecord(value) && Object.values(value).some((fact) => typeof fact === "string" && fact.trim())
    : typeof value === "string" && value.trim());
  if (!hasSubmittedFacts) return null;
  const container = node("div", "retained-facts evidence-details");
  if (extras.length) {
    const details = node("details");
    details.append(node("summary", undefined, "Other supplied facts (retained)"));
    const list = node("dl", "evidence-list");
    for (const [label, value] of extras) {
      const row = node("div", "evidence-row");
      row.append(node("dt", undefined, label), node("dd", undefined, value));
      list.append(row);
    }
    details.append(list);
    container.append(details);
  }
  const clear = button("Clear product details", () => {
    draft = emptyDraft();
    submittedObservation = emptySubmittedObservation();
    render("view-heading");
  }, "text-button");
  container.append(clear);
  return container;
}

function button(label: string, action: () => void, className = "button button-secondary"): HTMLButtonElement {
  const element = node("button", className, label);
  element.type = "button";
  if (label === "Cancel") element.dataset.cancel = "true";
  element.dataset.focusKey = `button:${label}`;
  element.addEventListener("click", action);
  return element;
}

function field(labelText: string, name: keyof ProductDraft, type: "text" | "date" = "text", hint?: string): HTMLLabelElement {
  const label = node("label", "field");
  const caption = node("span", "field-label", labelText);
  const input = node("input", "field-input");
  input.name = name;
  input.dataset.focusKey = `input:${name}`;
  input.type = type;
  input.autocomplete = "off";
  input.maxLength = name === "barcode" ? 32 : 300;
  input.value = draft[name];
  if (type === "date") input.setAttribute("max", "9999-12-31");
  input.addEventListener("input", () => {
    draft = { ...draft, [name]: input.value };
    if (name === "barcode") updateBarcodeHint(label, input.value);
  });
  label.append(caption, input);
  if (hint) label.append(node("span", "field-hint", hint));
  if (name === "barcode") updateBarcodeHint(label, input.value);
  return label;
}

function updateBarcodeHint(label: HTMLLabelElement, value: string): void {
  const existing = label.querySelector<HTMLElement>(".barcode-hint");
  const hint = existing ?? node("span", "field-hint barcode-hint");
  const compact = value.replace(/[\s-]/g, "");
  hint.textContent = compact && !isValidGtin(compact)
    ? "Check the digits and barcode length before checking."
    : "Optional. GTIN-8, 12, 13, or 14.";
  if (!existing) label.append(hint);
}

function setStatus(message: string, tone: RequestState["tone"] = "neutral"): void {
  state = { ...state, message, tone };
  status.textContent = message;
  status.dataset.tone = tone;
}

function showToolResult(tool: ToolName, args: Record<string, unknown>, result: unknown, id: number): void {
  if (isRecord(result) && result.isError === true) {
    state = failRequest(state, id, publicErrorMessage(result));
    setStatus(state.message, "error");
    render(requestFocusKey);
    requestFocusKey = null;
    return;
  }
  const structured = validatedStructuredResult(tool, result);
  if (!structured) {
    state = failRequest(state, id, "No completed result was returned. The previous result remains below.");
    setStatus(state.message, "error");
    render(requestFocusKey);
    requestFocusKey = null;
    return;
  }

  state = commitRequest(state, id, { tool, input: structuredClone(args), result: structured });
  if (state.pending) return;
  if (tool === "check_product") lastCheck = state.completed;
  if (tool === "check_product") {
    const evidence = AgentObservationSchema.safeParse(structured.submittedEvidence);
    if (evidence.success) {
      submittedObservation = evidence.data;
      draft = draftFromUnknown(evidence.data) ?? draft;
    }
  }
  currentTool = tool;
  pagination = { tool, arguments: structuredClone(args) };
  view = viewForTool(tool);
  const qualification = tool === "check_product" && typeof structured.qualification === "string"
    ? structured.qualification
    : null;
  setStatus(qualification ?? "Result received from the food warning service.", "success");
  render(requestFocusKey);
  requestFocusKey = null;
  if (tool === "check_product") void shareCommittedCheck(structured);
}

function publicErrorMessage(result: UnknownResult): string {
  const metadata = isRecord(result._meta) && isRecord(result._meta.publicError) ? result._meta.publicError : null;
  const code = typeof metadata?.code === "string" ? metadata.code.toLowerCase() : "";
  if (code === "quota_exceeded") return "The check budget is temporarily exhausted. Try again later or use the website.";
  if (code === "interrupted") return "The request was interrupted. No completed result was returned.";
  if (code === "restart_pagination") return "This warning page expired. Restart the search to load current results.";
  if (code === "invalid_arguments") return "Some submitted details were invalid. Review the fields and try again.";
  if (code === "not_found") return "That warning is no longer available. Search again for its current record.";
  const firstText = Array.isArray(result.content)
    ? result.content.find((item) => isRecord(item) && item.type === "text" && typeof item.text === "string")
    : null;
  return firstText && isRecord(firstText) && typeof firstText.text === "string"
    ? firstText.text
    : "The warning service could not complete this request. The previous result remains available.";
}

function validatedStructuredResult(tool: ToolName, result: unknown): UnknownResult | null {
  if (!isRecord(result) || !isRecord(result.structuredContent)) return null;
  const raw = result.structuredContent;
  const parsed = tool === "check_product" ? PublicCheckResultSchema.safeParse(raw)
    : tool === "search_warnings" ? PublicSearchResultSchema.safeParse(raw)
      : tool === "get_warning" ? PublicWarningDetailsSchema.safeParse(raw)
        : PublicCoverageSchema.safeParse(raw);
  return parsed.success ? parsed.data as UnknownResult : null;
}

function viewForTool(tool: ToolName): View {
  if (tool === "search_warnings") return "warnings";
  if (tool === "get_warning") return "detail";
  if (tool === "get_coverage") return "coverage";
  return "check";
}

async function shareCommittedCheck(result: UnknownResult): Promise<void> {
  if (typeof result.label !== "string" || typeof result.qualification !== "string") return;
  const urls: string[] = [];
  if (Array.isArray(result.warnings)) {
    for (const item of result.warnings.slice(0, 3)) {
      if (!isRecord(item) || !isRecord(item.warning) || !isRecord(item.warning.officialSource)) continue;
      for (const candidate of [item.warning.officialSource.url, item.warning.websiteUrl]) {
        const safe = httpsUrl(candidate);
        if (safe && !urls.includes(safe)) urls.push(safe);
      }
    }
  }
  const evidence = isRecord(result.submittedEvidence) ? result.submittedEvidence : {};
  const referenceText = urls.length ? ` Official references: ${urls.join(" ")}` : "";
  const summary = `Eat or Yeet completed a ${String(evidence.productName || evidence.brand || evidence.barcode || "product")} check: ${result.label}. ${result.qualification}${referenceText}`;
  try {
    await app.updateModelContext({ content: [{ type: "text", text: summary.slice(0, 1800) }] });
  } catch {
    // Showing the result remains useful when the host does not support context updates.
  }
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch { return null; }
}

function startRequest(tool: ToolName, args: Record<string, unknown>, origin: "app" | "host", focusKey: string | null = null): number {
  if (activeController) activeController.abort();
  const id = nextRequestId++;
  state = beginRequest(state, id, tool);
  requestOrigin = origin;
  requestFocusKey = focusKey;
  currentTool = tool;
  pendingInput = { tool, arguments: structuredClone(args) };
  setStatus(state.message);
  render(null, true);
  return id;
}

async function callTool(tool: ToolName, args: Record<string, unknown>): Promise<void> {
  if (state.pending) return;
  const id = startRequest(tool, args, "app", activeFocusKey());
  const controller = new AbortController();
  activeController = controller;
  try {
    const result = await app.callServerTool({ name: tool, arguments: args }, { signal: controller.signal, timeout: 60_000 });
    if (hasPendingRequest(id)) showToolResult(tool, args, result, id);
  } catch (error) {
    if (!hasPendingRequest(id)) return;
    const message = controller.signal.aborted
      ? "Request interrupted. No new result was returned."
      : error instanceof Error && /timeout/i.test(error.message)
        ? "The request timed out. The previous result remains available; try again."
        : "The host could not complete this request. The previous result remains available; try again.";
    state = controller.signal.aborted ? cancelRequest(state, id) : failRequest(state, id, message);
    setStatus(state.message, "error");
    render(requestFocusKey);
    requestFocusKey = null;
  } finally {
    if (activeController === controller) activeController = null;
    if (!state.pending) requestOrigin = null;
  }
}

function hasPendingRequest(id: number): boolean {
  return state.pending?.id === id;
}

function handleHostInput(argumentsValue: unknown): void {
  // App-initiated requests already carry the exact tool name and arguments.
  // Their input echo is optional and may not identify the requested tool.
  if (requestOrigin === "app" && activeController) return;
  const tool = app.getHostContext()?.toolInfo?.tool.name;
  if (!isToolName(tool) || !isRecord(argumentsValue)) return;
  const hostRegion = regionFromUnknown(argumentsValue.region);
  if (hostRegion) region = hostRegion;
  currentTool = tool;
  if (tool === "check_product") {
    const observation = AgentObservationSchema.safeParse(argumentsValue.observation);
    if (observation.success) {
      submittedObservation = observation.data;
      draft = draftFromUnknown(observation.data) ?? draft;
    }
  } else if (tool === "search_warnings") {
    view = "warnings";
    searchQueryDraft = typeof argumentsValue.query === "string" ? argumentsValue.query : "";
  } else if (tool === "get_warning") {
    view = "detail";
  } else {
    view = "coverage";
  }
  startRequest(tool, argumentsValue, "host", null);
  // Host input notifications describe an already-started tool call. They only
  // populate context and show pending state; they never trigger another call.
}

function isToolName(value: unknown): value is ToolName {
  return value === "check_product" || value === "search_warnings" || value === "get_warning" || value === "get_coverage";
}

function handleHostResult(result: unknown): void {
  const tool = currentTool ?? app.getHostContext()?.toolInfo?.tool.name;
  if (!isToolName(tool) || !state.pending) return;
  const completed = state.pending;
  showToolResult(tool, pendingInput?.arguments ?? {}, result, completed.id);
}

function handleHostCancelled(): void {
  if (!state.pending) return;
  state = cancelRequest(state, state.pending.id);
  setStatus(state.message, "error");
  render(requestFocusKey);
  requestFocusKey = null;
}

app.ontoolinput = ({ arguments: args }) => handleHostInput(args);
app.ontoolresult = ({ ...result }) => handleHostResult(result);
app.ontoolcancelled = () => handleHostCancelled();
app.onhostcontextchanged = ({ theme, styles }) => {
  if (theme === "dark" || theme === "light") applyDocumentTheme(theme);
  if (styles?.variables) applyHostStyleVariables(styles.variables);
};

function render(focusKey?: string | null, focusStatus = false): void {
  if (!root) return;
  root.replaceChildren();
  const shell = node("div", "shell");
  shell.append(renderHeader(), renderTabs());
  if (view === "check") shell.append(renderCheckView());
  if (view === "warnings") shell.append(renderWarningsView());
  if (view === "detail") shell.append(renderDetailView());
  if (view === "coverage") shell.append(renderCoverageView());
  shell.append(renderWebsiteLinks());
  shell.append(status);
  if (state.pending) shell.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button,input,select").forEach((control) => {
    if (control.dataset.cancel !== "true") control.disabled = true;
  });
  root.append(shell);
  if (focusStatus) status.focus();
  else if (focusKey !== undefined) {
    const target = focusKey ? shell.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`) : null;
    (target ?? shell.querySelector<HTMLElement>("[data-focus-key='view-heading']"))?.focus();
  }
}

function renderHeader(): HTMLElement {
  const header = node("header", "app-header");
  const mark = node("span", "brand-mark", "E");
  mark.setAttribute("aria-hidden", "true");
  const title = node("h1", "brand-name", "Eat or Yeet");
  const line = node("p", "brand-line", "Food warning checker");
  header.append(node("div", "brand-lockup"));
  header.firstElementChild?.append(mark, node("div", "brand-copy"));
  header.querySelector(".brand-copy")?.append(title, line);
  const safety = node("span", "truth-note", "No match doesn’t mean safe");
  header.append(safety);
  return header;
}

function renderRegionField(labelText: string): HTMLLabelElement {
  const label = node("label", "field region-field");
  label.append(node("span", "field-label", labelText));
  const select = node("select", "field-input");
  select.name = "region";
  select.dataset.focusKey = "region";
  const choose = node("option", undefined, "Choose UK or US");
  choose.value = "";
  choose.selected = region === null;
  select.append(choose);
  for (const [code, name] of [["UK", "United Kingdom"], ["US", "United States"]] as const) {
    const option = node("option", undefined, name);
    option.value = code;
    option.selected = region === code;
    select.append(option);
  }
  select.addEventListener("change", () => { region = regionFromUnknown(select.value); });
  label.append(select);
  return label;
}

function renderWebsiteLinks(): HTMLElement {
  const footer = node("footer", "website-links");
  footer.append(node("span", undefined, "Use the full website"));
  const links: Array<[string, string]> = [
    ["Scan a barcode", "https://eatoryeet.app/scan"],
    ["Type a barcode", "https://eatoryeet.app/search"],
  ];
  for (const [label, url] of links) {
    const link = node("a", "source-link", label);
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    attachOpenLinkBridge(link, url);
    footer.append(link);
  }
  return footer;
}

function renderTabs(): HTMLElement {
  const nav = node("nav", "view-tabs");
  nav.setAttribute("aria-label", "Checker views");
  const tabs: Array<[View, string]> = [["check", "Check product"], ["warnings", "Search warnings"], ["coverage", "Coverage"]];
  for (const [key, label] of tabs) {
    const tab = button(label, () => { view = key; render(`button:${label}`); }, "tab-button");
    tab.setAttribute("aria-current", view === key ? "page" : "false");
    if (view === key) tab.classList.add("is-active");
    nav.append(tab);
  }
  return nav;
}

function renderCheckView(): HTMLElement {
  const section = node("section", "view");
  const heading = node("div", "section-heading");
  heading.append(headingTitle("Check a label"));
  paragraph(heading, "Compare what’s printed on the pack with published warnings.");
  const form = node("form", "check-form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!region) {
      setStatus("Choose a warning region before checking.", "error");
      renderStatusOnly();
      form.querySelector<HTMLSelectElement>("select[name='region']")?.focus();
      return;
    }
    const parsed = makeCheckInput(draft, region, isValidGtin, submittedObservation);
    if (!parsed.ok) {
      setStatus(parsed.message, "error");
      const invalid = form.querySelector<HTMLInputElement>("input:invalid");
      invalid?.focus();
      renderStatusOnly();
      return;
    }
    void callTool("check_product", parsed.value as unknown as Record<string, unknown>);
  });

  const regionField = renderRegionField("Warning region");
  const fields = node("div", "fields-grid");
  fields.append(
    field("Barcode", "barcode", "text", "GTIN-8, 12, 13, or 14"),
    field("Product name", "productName"),
    field("Brand", "brand"),
    field("Batch code", "batchCode"),
    field("Lot code", "lotCode"),
    field("Use-by", "useBy", "date"),
    field("Best-before", "bestBefore", "date"),
  );
  const actionRow = node("div", "form-actions");
  const submit = node("button", "button button-primary", state.pending ? "Checking…" : "Check product");
  submit.type = "submit";
  submit.dataset.focusKey = "button:Check product";
  submit.disabled = Boolean(state.pending);
  actionRow.append(submit);
  if (state.pending && requestOrigin === "app") actionRow.append(button("Cancel", cancelAppRequest));
  const retained = renderRetainedFacts();
  if (state.pending) disable(form);
  form.append(regionField, fields, actionRow);
  if (retained) form.append(retained);
  const result = renderCompletedResult();
  section.append(heading, form, result);
  return section;
}

function renderWarningsView(): HTMLElement {
  const section = node("section", "view");
  const heading = node("div", "section-heading");
  heading.append(headingTitle("Search published warnings"));
  paragraph(heading, "Discovery only. Search results don’t check a product.");
  const form = node("form", "search-form");
  const searchRegion = renderRegionField("Search region");
  searchRegion.classList.add("search-region");
  const queryLabel = node("label", "field search-field");
  queryLabel.append(node("span", "field-label", "Product, brand, or warning title"));
  const query = node("input", "field-input");
  query.type = "search";
  query.maxLength = 200;
  query.name = "query";
  query.dataset.focusKey = "input:query";
  query.value = searchQueryDraft;
  query.addEventListener("input", () => { searchQueryDraft = query.value; });
  queryLabel.append(query);
  const submit = node("button", "button button-primary", "Search warnings");
  submit.type = "submit";
  submit.dataset.focusKey = "button:Search warnings";
  submit.disabled = Boolean(state.pending);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!region) {
      setStatus("Choose a warning region before searching.", "error");
      renderStatusOnly();
      searchRegion.querySelector("select")?.focus();
      return;
    }
    searchQueryDraft = query.value;
    void callTool("search_warnings", { region, query: query.value.trim(), pageSize: 10 });
  });
  form.append(queryLabel, searchRegion, submit);
  const current = state.completed?.tool === "search_warnings" ? state.completed.result : null;
  section.append(heading, form);
  if (isRecord(current)) {
    const completedInput = isRecord(state.completed?.input) ? state.completed.input : {};
    paragraph(section, `Search results for “${stringValue(completedInput.query, "all warnings")}” · ${coverageRegion(current.coverage)}`, "result-meta");
    section.append(renderSearchResult(current));
  } else if (state.pending?.tool === "search_warnings") section.append(emptyMessage("Waiting for published warning results…"));
  else section.append(emptyMessage("Search by product, brand, or warning title."));
  return section;
}

function renderSearchResult(result: UnknownResult): HTMLElement {
  const section = node("section", "result-section");
  const resultHeading = node("div", "result-heading");
  resultHeading.append(node("h3", undefined, `${numberValue(result.total)} warning${numberValue(result.total) === 1 ? "" : "s"} found`));
  text(resultHeading, `For ${coverageRegion(result.coverage)} · updated ${formatDateTime(result.asOf)}`, "result-meta");
  section.append(resultHeading);
  if (typeof result.qualification === "string") paragraph(section, result.qualification, "qualification");
  if (Array.isArray(result.warnings) && result.warnings.length) {
    const list = node("ul", "warning-list");
    for (const warning of result.warnings) {
      if (!isRecord(warning)) continue;
      const item = node("li", "warning-row");
      const title = node("h4", undefined, stringValue(warning.title, "Published warning"));
      const summary = paragraph(item, stringValue(warning.summary), "warning-summary");
      const meta = paragraph(item, `${stringValue(warning.authority)} · ${stringValue(warning.hazardLabel)} · ${formatDateTime(warning.updatedAt)}`, "result-meta");
      const links = warningLinks(warning);
      const actions = node("div", "inline-actions");
      if (typeof warning.slug === "string") actions.append(button("Warning details", () => void callTool("get_warning", { slug: warning.slug, pageSize: 10 }), "text-button"));
      if (links.length) actions.append(...links);
      item.append(title, summary, meta, actions);
      list.append(item);
    }
    section.append(list);
  } else {
    section.append(emptyMessage("No published warnings matched this search."));
  }
  appendCoverage(section, result.coverage);
  appendNextPage(section, result);
  return section;
}

function renderDetailView(): HTMLElement {
  const section = node("section", "view");
  const completed = state.completed?.tool === "get_warning" ? state.completed.result : null;
  if (!isRecord(completed)) {
    section.append(headingTitle("Warning details"), emptyMessage("Choose a warning from search results to read its advice and affected product groups."));
    return section;
  }
  const warning = isRecord(completed.warning) ? completed.warning : {};
  section.append(button("Back to warning search", () => { view = "warnings"; render("view-heading"); }, "text-button back-button"));
  section.append(headingTitle(stringValue(warning.title, "Published warning"), "detail-title"));
  paragraph(section, `${stringValue(warning.authority)} · ${stringValue(warning.hazardLabel)} · updated ${formatDateTime(warning.updatedAt)}`, "result-meta");
  paragraph(section, stringValue(completed.consumerAdvice), "consumer-advice");
  const links = warningLinks(warning);
  if (links.length) {
    const linkRow = node("div", "inline-actions");
    linkRow.append(...links);
    section.append(linkRow);
  }
  section.append(node("h3", "subheading", "Affected product groups"));
  const count = numberValue(completed.affectedGroupCount);
  paragraph(section, `${count} group${count === 1 ? "" : "s"}${completed.affectedGroupsComplete === true ? " listed" : " shown so far"}.`, "result-meta");
  if (Array.isArray(completed.affectedGroups) && completed.affectedGroups.length) {
    const groups = node("div", "group-list");
    for (const group of completed.affectedGroups) {
      if (isRecord(group)) groups.append(renderAffectedGroup(group));
    }
    section.append(groups);
  } else {
    section.append(emptyMessage("No affected product groups were returned."));
  }
  appendNextPage(section, completed);
  return section;
}

function renderAffectedGroup(group: UnknownResult): HTMLElement {
  const block = node("section", "affected-group");
  const association = group.association === "source_group" ? "Grouped by the warning source" : "Ungrouped source details";
  block.append(node("h4", undefined, association));
  if (Array.isArray(group.targets)) {
    const list = node("ul", "target-list");
    for (const target of group.targets) {
      if (!isRecord(target)) continue;
      const item = node("li", "target-row");
      const detail = `${stringValue(target.type)}: ${stringValue(target.value)}`;
      item.append(node("strong", "target-code", detail));
      const match = target.matchType === "pattern" ? "Pattern match" : "Exact code";
      paragraph(item, match, "result-meta");
      const from = formatDate(target.dateFrom);
      const to = formatDate(target.dateTo);
      const dateLine = from && to ? `Dates: ${from} to ${to}`
        : from ? `Dates: ${from} onward`
          : to ? `Dates: through ${to}` : "No date range supplied";
      paragraph(item, dateLine, "date-range");
      if (typeof target.notes === "string" && target.notes) paragraph(item, target.notes, "target-notes");
      list.append(item);
    }
    block.append(list);
  }
  return block;
}

function renderCoverageView(): HTMLElement {
  const section = node("section", "view");
  const heading = node("div", "section-heading");
  heading.append(headingTitle("Source coverage"));
  paragraph(heading, "See which official warning feeds were current when they last reported.");
  const regionField = renderRegionField("Coverage region");
  const action = button(state.pending?.tool === "get_coverage" ? "Loading coverage…" : "Check source coverage", () => {
    if (!region) {
      setStatus("Choose a warning region before checking coverage.", "error");
      renderStatusOnly();
      regionField.querySelector("select")?.focus();
      return;
    }
    void callTool("get_coverage", { region });
  }, "button button-primary");
  action.disabled = Boolean(state.pending);
  section.append(heading, regionField, action);
  const result = state.completed?.tool === "get_coverage" ? state.completed.result : null;
  if (isRecord(result)) section.append(renderCoverageResult(result));
  else if (state.pending?.tool === "get_coverage") section.append(emptyMessage("Waiting for source coverage…"));
  else section.append(emptyMessage("Coverage updates when you ask for it. Nothing runs automatically."));
  return section;
}

function renderCoverageResult(result: UnknownResult): HTMLElement {
  const block = node("section", "result-section");
  const healthy = result.healthy === true;
  block.append(node("h3", healthy ? "coverage-title is-current" : "coverage-title is-attention", healthy ? "Coverage is current" : "Coverage needs attention"));
  paragraph(block, `For ${coverageRegion(result)} · checked ${formatDateTime(result.checkedAt)}`, "result-meta");
  if (Array.isArray(result.coveredRegions)) paragraph(block, `Regions covered: ${result.coveredRegions.map((item) => String(item)).join(", ") || "none reported"}.`, "qualification");
  if (Array.isArray(result.sources)) {
    const list = node("ul", "source-list");
    for (const source of result.sources) {
      if (!isRecord(source)) continue;
      const item = node("li", "source-row");
      const label = `${stringValue(source.name)} · ${stringValue(source.region)}`;
      item.append(node("strong", undefined, label));
      const sourceStatus = stringValue(source.status, "missing");
      paragraph(item, `${sourceStatus[0]?.toUpperCase()}${sourceStatus.slice(1)} · last successful update ${formatDateTime(source.lastSuccessfulAt)}`, "result-meta");
      paragraph(item, stringValue(source.scope), "source-scope");
      const official = coverageSourceLink(source.id);
      if (official) item.append(officialLink(official[0], official[1]));
      list.append(item);
    }
    block.append(list);
  }
  return block;
}

function coverageSourceLink(sourceId: unknown): [string, string] | null {
  switch (sourceId) {
    case "fsa": return ["FSA public alerts", "https://alerts.food.gov.uk/"];
    case "fda": return ["FDA public enforcement report", "https://www.accessdata.fda.gov/scripts/ires/index.cfm#/search/"];
    case "fda-announcements": return ["FDA recalls and safety alerts", "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts"];
    case "fsis": return ["USDA FSIS recalls", "https://www.fsis.usda.gov/recalls"];
    default: return null;
  }
}

function officialLink(label: string, url: string): HTMLAnchorElement {
  const link = node("a", "source-link", label);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  attachOpenLinkBridge(link, url);
  return link;
}

function renderCompletedResult(): HTMLElement {
  const panel = node("section", "latest-result");
  panel.setAttribute("aria-label", "Most recent completed product check");
  panel.append(node("div", "result-overline", "Most recent completed check"));
  const completed = state.completed?.tool === "check_product" ? state.completed : lastCheck;
  if (!completed || completed.tool !== "check_product" || !isRecord(completed.result)) {
    panel.append(node("p", "empty-result", "No product check has completed in this view."));
    return panel;
  }
  const result = completed.result;
  const checkedRegion = isRecord(result.coverage) ? regionFromUnknown(result.coverage.region) : null;
  const evidence = isRecord(result.submittedEvidence) ? result.submittedEvidence : {};
  const identity = [evidence.productName, evidence.brand, evidence.barcode].filter((item) => typeof item === "string" && item).join(" · ") || "Product details supplied";
  const titleRow = node("div", "verdict-heading");
  titleRow.append(node("h3", "verdict-label", stringValue(result.label, "Completed result")));
  titleRow.append(node("span", "region-chip", checkedRegion ?? "Region unavailable"));
  const statusKey = stringValue(result.status, "inconclusive");
  titleRow.classList.add(`verdict-${statusKey.replaceAll("_", "-")}`);
  panel.append(titleRow, paragraph(panel, identity, "product-identity"));
  paragraph(panel, `Checked ${formatDateTime(result.checkedAt)} · ${checkedRegion ?? "region unavailable"}`, "result-meta");
  if (typeof result.qualification === "string") paragraph(panel, result.qualification, "qualification");
  appendCoverage(panel, result.coverage);
  appendEvidence(panel, result.submittedEvidence, result.checkedEvidence, result.enrichedFields);
  if (Array.isArray(result.warnings) && result.warnings.length) {
    panel.append(node("h3", "subheading", "Published warnings to review"));
    const list = node("ul", "warning-list");
    for (const match of result.warnings) {
      if (!isRecord(match) || !isRecord(match.warning)) continue;
      const warning = match.warning;
      const item = node("li", "warning-row");
      item.append(node("h4", undefined, stringValue(warning.title, "Published warning")));
      paragraph(item, `${stringValue(match.level)} match · ${stringValue(warning.authority)}`, "result-meta");
      if (Array.isArray(match.reasons)) {
        const reasons = node("ul", "reason-list");
        for (const reason of match.reasons) {
          if (!isRecord(reason)) continue;
          const detail = node("li", "reason-row");
          detail.append(node("strong", undefined, stringValue(reason.message)));
          paragraph(detail, `Evidence: ${stringValue(reason.evidence)}`, "result-meta");
          reasons.append(detail);
        }
        item.append(reasons);
      }
      if (Array.isArray(match.affectedGroups)) {
        const groups = node("div", "group-list");
        for (const group of match.affectedGroups) if (isRecord(group)) groups.append(renderAffectedGroup(group));
        item.append(groups);
      }
      paragraph(item, `${numberValue(match.affectedGroupCount)} affected groups · ${match.affectedGroupsComplete === true ? "complete" : "partial list"}`, "result-meta");
      const links = warningLinks(warning);
      const actions = node("div", "inline-actions");
      const slug = typeof warning.slug === "string" ? warning.slug : null;
      if (slug) actions.append(button("Full warning details", () => void callTool("get_warning", { slug, pageSize: 10 }), "text-button"));
      if (links.length) actions.append(...links);
      item.append(actions);
      list.append(item);
    }
    panel.append(list);
    if (result.matchesComplete !== true) paragraph(panel, "Additional warning matches were not included in this result.", "result-meta");
  } else {
    paragraph(panel, "No matching warning was returned for this submitted evidence. This does not establish that the product is safe.", "qualification");
  }
  return panel;
}

function appendEvidence(parent: Element, submittedValue: unknown, checkedValue: unknown, enrichedFieldsValue: unknown): void {
  if (!isRecord(submittedValue) || !isRecord(checkedValue)) return;
  const details = node("details", "evidence-details");
  details.append(node("summary", undefined, "Evidence used for this check"));
  const enriched = Array.isArray(enrichedFieldsValue) ? new Set(enrichedFieldsValue.filter((field): field is string => typeof field === "string")) : new Set<string>();
  const fieldNames: Record<string, string> = {
    productName: "Product", brand: "Brand", barcode: "Barcode", batchCode: "Batch", lotCode: "Lot",
    producer: "Producer", farmCode: "Farm code", countryOfOrigin: "Country of origin",
    establishmentNumber: "Establishment number", approvalNumber: "Approval number",
    retailer: "Retailer", category: "Category",
  };
  const submittedRows = node("dl", "evidence-list");
  for (const [key, label] of Object.entries(fieldNames)) {
    const original = submittedValue[key];
    const checked = checkedValue[key];
    if (!original && !checked) continue;
    const row = node("div", "evidence-row");
    row.append(node("dt", undefined, label));
    row.append(node("dd", undefined, `${displayFact(original)}${enriched.has(key) ? ` · checked as ${displayFact(checked)} (catalogue enrichment)` : " · supplied"}`));
    submittedRows.append(row);
  }
  const submittedDates = isRecord(submittedValue.dates) ? submittedValue.dates : {};
  const checkedDates = isRecord(checkedValue.dates) ? checkedValue.dates : {};
  for (const key of ["useBy", "bestBefore", "productionDate"] as const) {
    if (!submittedDates[key] && !checkedDates[key]) continue;
    const row = node("div", "evidence-row");
    const dateLabel = key === "useBy" ? "Use-by" : key === "bestBefore" ? "Best-before" : "Production date";
    row.append(node("dt", undefined, dateLabel));
    row.append(node("dd", undefined, `${displayFact(submittedDates[key])}${enriched.has("dates") ? ` · checked as ${displayFact(checkedDates[key])}` : " · supplied"}`));
    submittedRows.append(row);
  }
  const submittedEgg = isRecord(submittedValue.eggMark) ? submittedValue.eggMark : {};
  const checkedEgg = isRecord(checkedValue.eggMark) ? checkedValue.eggMark : {};
  for (const [key, label] of [["farmingMethod", "Egg farming method"], ["country", "Egg mark country"], ["producerCode", "Egg producer code"]] as const) {
    if (!submittedEgg[key] && !checkedEgg[key]) continue;
    const row = node("div", "evidence-row");
    row.append(node("dt", undefined, label));
    row.append(node("dd", undefined, `${displayFact(submittedEgg[key])}${enriched.has("eggMark") ? ` · checked as ${displayFact(checkedEgg[key])}` : " · supplied"}`));
    submittedRows.append(row);
  }
  details.append(submittedRows);
  if (enriched.size) paragraph(details, "Enriched facts come from the product record. Confirm them against the package where they matter.", "field-hint");
  parent.append(details);
}

function appendCoverage(parent: Element, coverage: unknown): void {
  if (!isRecord(coverage)) return;
  const checkedRegion = regionFromUnknown(coverage.region);
  const current = coverage.healthy === true;
  const note = node("p", `coverage-note ${current ? "is-current" : "is-attention"}`);
  note.append(node("strong", undefined, `${current ? "Current" : "Incomplete or stale"} coverage · ${checkedRegion ?? "region unavailable"}`));
  note.append(document.createTextNode(` · checked ${formatDateTime(coverage.checkedAt)}`));
  parent.append(note);
}

function appendNextPage(parent: Element, result: UnknownResult): void {
  if (typeof result.nextCursor !== "string" || !result.nextCursor || !pagination) return;
  const source = pagination;
  const next = button(source.tool === "get_warning" ? "Load more affected groups" : "Load more warnings", () => {
    const args = { ...source.arguments, cursor: result.nextCursor };
    void callTool(source.tool, args);
  });
  parent.append(next);
}

function warningLinks(warning: UnknownResult): HTMLAnchorElement[] {
  const result: HTMLAnchorElement[] = [];
  const official = isRecord(warning.officialSource) ? warning.officialSource : {};
  const candidates: Array<[unknown, unknown, string]> = [
    [official.url, official.label, "Official notice"],
    [warning.websiteUrl, "Eat or Yeet warning page", "Warning overview"],
  ];
  for (const [urlValue, labelValue, fallback] of candidates) {
    const url = httpsUrl(urlValue);
    if (!url || result.some((link) => link.href === url)) continue;
    const link = node("a", "source-link", stringValue(labelValue, fallback));
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    attachOpenLinkBridge(link, url);
    result.push(link);
  }
  return result;
}

function attachOpenLinkBridge(link: HTMLAnchorElement, url: string): void {
  link.addEventListener("click", (event) => {
    if (!app.getHostCapabilities()?.openLinks) return;
    event.preventDefault();
    void app.openLink({ url }).then((result) => {
      if (result.isError) setStatus(`The host could not open this page. Copy ${url}`, "error");
    }).catch(() => setStatus(`The host could not open this page. Copy ${url}`, "error"));
  });
}

function emptyMessage(message: string): HTMLElement {
  return node("p", "empty-message", message);
}

function coverageRegion(value: unknown): string {
  return isRecord(value) ? (regionFromUnknown(value.region) ?? "region unavailable") : "region unavailable";
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function displayFact(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : "not supplied";
}

function formatDateTime(value: unknown): string {
  if (typeof value !== "string") return "time unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "time unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(date) : null;
}

function disable(parent: ParentNode): void {
  parent.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input,select,button").forEach((control) => {
    if (control.type !== "button" || control.textContent !== "Cancel") control.disabled = true;
  });
}

function cancelAppRequest(): void {
  if (!activeController || !state.pending) return;
  activeController.abort();
  const pendingId = state.pending.id;
  state = cancelRequest(state, pendingId);
  setStatus(state.message, "error");
  render(requestFocusKey);
  requestFocusKey = null;
}

function renderStatusOnly(): void {
  status.textContent = state.message;
  status.dataset.tone = state.tone;
}

function syncHostTheme(): void {
  const context = app.getHostContext();
  const theme = context?.theme;
  if (theme === "light" || theme === "dark") applyDocumentTheme(theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
}

syncHostTheme();
render();
void app.connect(new PostMessageTransport(window.parent, window.parent)).then(() => {
  syncHostTheme();
  const tool = app.getHostContext()?.toolInfo?.tool.name;
  if (isToolName(tool)) currentTool = tool;
}).catch(() => {
  setStatus("Connected checker tools are unavailable. Try again in the host app or use the website.", "error");
  render();
});
