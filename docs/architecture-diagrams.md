# FlightDeck Architecture Diagrams

Visual architecture documentation for FlightDeck — a personal work-intelligence dashboard that connects to Microsoft 365 via WorkIQ and Microsoft Copilot.

---

## 1. System Architecture

How FlightDeck's Electron app, WorkIQ CLI, Microsoft Copilot, and Microsoft 365 connect end-to-end.

```mermaid
graph TB
    subgraph User["👤 User"]
        UI["FlightDeck Desktop App"]
    end

    subgraph Electron["Electron Application"]
        direction TB
        subgraph Renderer["Renderer Process · Browser"]
            direction LR
            App["app.js<br/>Tab routing & init"]
            Events["events.js<br/>DOM event wiring"]
            Monitor["monitor-engine.js<br/>30s tick scheduler"]
            Prompts["prompts.js<br/>Prompt editor & cache"]
            Parser["json-parser.js<br/>LLM output → JSON"]
            State["state.js<br/>localStorage persistence"]
            subgraph Models["Models"]
                Radar["radar.js"]
                Tracking["tracking.js"]
                Briefing["briefing.js"]
            end
            subgraph Views["Renderers"]
                KPI["kpi.js"]
                RadarR["radar.js"]
                TrackingR["tracking.js"]
                BriefingR["briefing.js"]
            end
        end

        Preload["preload.js<br/>contextBridge → window.workiq"]

        subgraph Main["Main Process · Node.js"]
            direction LR
            Index["index.js<br/>App lifecycle & tray"]
            IPC["ipc-handlers.js<br/>IPC channel routing"]
            PTY["pty-bridge.js<br/>node-pty spawn"]
            PromptFiles["prompts/<br/>radar-scan.md<br/>briefing.md<br/>day-briefing.md"]
        end
    end

    subgraph External["External Services"]
        WorkIQ["WorkIQ CLI<br/>workiq.exe"]
        Copilot["Microsoft Copilot<br/>AI Engine"]
        M365["Microsoft 365<br/>Email · Teams · Calendar · Docs"]
    end

    UI --> Renderer
    Renderer <-->|"IPC invoke/send"| Preload
    Preload <-->|"ipcRenderer ↔ ipcMain"| Main
    IPC -->|"read prompt files"| PromptFiles
    IPC -->|"spawn PTY"| PTY
    PTY -->|"workiq ask -q 'prompt'"| WorkIQ
    WorkIQ -->|"Copilot API"| Copilot
    Copilot <-->|"Graph API"| M365
    WorkIQ -->|"JSON + natural language"| PTY
    PTY -->|"ANSI-stripped output"| IPC
```

**Key architecture decisions:**
- **Electron with context isolation** — The renderer is sandboxed. All Node.js access goes through `preload.js`, which exposes exactly 11 whitelisted methods via `window.workiq`.
- **PTY bridge, not HTTP** — WorkIQ is a CLI tool, not an API. FlightDeck uses `node-pty` to spawn pseudo-terminal sessions, which handles interactive prompts (like EULA acceptance) and streaming output.
- **No framework, no bundler** — The renderer is vanilla HTML/CSS/JS. This keeps the build chain minimal and the codebase auditable.

---

## 2. WorkIQ Call Pipeline

The complete data flow when FlightDeck sends a prompt to WorkIQ and renders the result.

```mermaid
sequenceDiagram
    actor User
    participant R as Renderer<br/>(Browser)
    participant P as Preload<br/>(contextBridge)
    participant M as Main Process<br/>(ipc-handlers)
    participant PTY as PTY Bridge<br/>(node-pty)
    participant WIQ as WorkIQ CLI
    participant AI as Microsoft Copilot
    participant M365 as Microsoft 365

    User->>R: Click "Refresh" or scheduled tick fires
    R->>R: Load prompt template<br/>(radar-scan.md / briefing.md)
    R->>R: Append JSON schema suffix<br/>(constants.js)
    R->>P: window.workiq.ask(prompt)
    P->>M: ipcRenderer.invoke('ask-workiq', prompt)
    M->>PTY: runWorkiqCommand(prompt)
    PTY->>PTY: Resolve workiq.exe path<br/>(bundled → global → JS fallback)
    PTY->>WIQ: pty.spawn(workiq, ['ask', '-q', prompt])

    Note over PTY,WIQ: 5-minute timeout guard

    WIQ->>AI: Forward prompt to Copilot
    AI->>M365: Query Graph API<br/>(mail, chats, calendar, files)
    M365-->>AI: M365 signals & data
    AI-->>WIQ: Grounded AI response<br/>(JSON + citations)
    WIQ-->>PTY: Raw CLI output<br/>(with ANSI codes)

    PTY->>PTY: Strip ANSI escapes<br/>Filter prompt lines
    PTY-->>M: {success: true, answer: cleanedOutput}
    M-->>P: IPC response
    P-->>R: Promise resolves

    R->>R: json-parser.js:<br/>Extract JSON from fenced blocks
    R->>R: models/: Normalize payload,<br/>compute KPIs, detect changes
    R->>R: renderers/: Update DOM<br/>(cards, KPIs, badges)
    R->>R: state.js: Persist to localStorage
    R-->>User: Updated dashboard
```

**What makes this interesting:**
- **Prompt engineering is the product** — Each feature (Radar, Briefings, Tracking) is driven by a carefully crafted markdown prompt that instructs Copilot on what to look for, how to classify it, and what JSON schema to return.
- **In-app prompt editor** — Users can customize the radar and briefing prompts directly in the app. FlightDeck persists customizations to localStorage and falls back to the bundled defaults.
- **Robust JSON extraction** — LLM output isn't pure JSON. The parser handles fenced code blocks, mixed text, Unicode artifacts, trailing commas, and ANSI contamination.

---

## 3. Feature Modes & Prompt Flow

How FlightDeck's three core features connect to prompt templates and M365 data.

```mermaid
flowchart LR
    subgraph Prompts["Prompt Templates"]
        RS["radar-scan.md<br/>Scan M365 signals,<br/>classify by urgency"]
        BF["briefing.md<br/>Meeting prep with<br/>talk track & risks"]
        DB["day-briefing.md<br/>Morning summary<br/>of full workday"]
    end

    subgraph Features["FlightDeck Features"]
        direction TB
        RadarF["📡 Radar<br/>Inbound signal scan<br/>Critical · Elevated · Observe"]
        TrackF["📌 Tracking<br/>Monitor items over time<br/>Interval · Weekly · One-time"]
        BriefF["📋 Briefings<br/>AI meeting prep<br/>+ My Day overview"]
    end

    subgraph DataSources["Microsoft 365 Signals via WorkIQ + Copilot"]
        Email["📧 Email"]
        Teams["💬 Teams Chats"]
        Calendar["📅 Calendar"]
        Docs["📄 Documents"]
    end

    RS --> RadarF
    BF --> BriefF
    DB --> BriefF
    RS -.->|"Custom prompt<br/>via in-app editor"| RadarF
    BF -.->|"Custom prompt<br/>via in-app editor"| BriefF

    DataSources -->|"Graph API → Copilot → WorkIQ"| Prompts

    RadarF -->|"Track Item"| TrackF
    RadarF -->|"Open Source Link"| Email
    RadarF -->|"Open Source Link"| Teams
    TrackF -->|"Desktop notification 🔔<br/>on substantive change"| User([👤 User])
    BriefF -->|"Talk track + follow-ups"| User
```

| Feature | Prompt | What it does |
|---------|--------|--------------|
| **Radar** | `radar-scan.md` | Scans email, Teams, calendar, and documents for signals that need attention. Classifies each as Critical, Elevated, or Observe. Returns evidence links with deep URLs back to the source. |
| **Tracking** | Dynamic per-item | Monitors a specific item on a user-configured schedule. Includes the last 2 update summaries for de-duplication so the LLM only reports *new* information. |
| **Briefings** | `briefing.md` / `day-briefing.md` | Generates meeting prep (key updates, decisions needed, risks, talk track, follow-ups) or a full "My Day" morning briefing. |

---

## 4. Monitoring Engine — Scheduled Task Update Cycle

The background engine that keeps tracked items up to date.

```mermaid
flowchart TD
    Start([Monitor Engine Tick<br/>every 30 seconds]) --> Check{Any tracked items<br/>due now?}
    Check -->|No| Sleep([Wait for next tick])
    Check -->|Yes| BuildPrompt[Build prompt with:<br/>• Item context & title<br/>• Last 2 update summaries<br/>• De-duplication instructions]
    BuildPrompt --> CallWorkIQ[window.workiq.ask — prompt —<br/>IPC → PTY → WorkIQ CLI]
    CallWorkIQ --> Parse[json-parser.js:<br/>Extract JSON from response]
    Parse --> HasNew{LLM says<br/>hasNewInfo?}
    HasNew -->|No / false| Silent[Silent log<br/>Preserve existing fields<br/>Update lastRunAt only]
    HasNew -->|Yes| UpdateFields[Update item fields:<br/>summary, status, severity,<br/>owner, evidence links]
    UpdateFields --> ComputeSig[Compute field-level<br/>signature hash]
    ComputeSig --> SigMatch{Signature changed<br/>substantively?}
    SigMatch -->|No| LogOnly[Log link-only or<br/>cosmetic change]
    SigMatch -->|Yes| Notify[Desktop notification 🔔<br/>+ Update badge<br/>+ History entry]
    Silent --> Schedule
    LogOnly --> Schedule
    Notify --> Schedule
    Schedule[Compute next run time<br/>based on schedule type] --> Persist[Save to localStorage<br/>Broadcast state-changed<br/>to pop-out windows]
    Persist --> Render[Re-render tracking cards]
    Render --> NextItem{More due items?}
    NextItem -->|Yes| BuildPrompt
    NextItem -->|No| Sleep
```

**How change detection works:**
1. Each tracked item has a **signature hash** computed from its status, severity, summary, and evidence links.
2. After the LLM returns an update, FlightDeck computes a new signature and compares it to the previous one.
3. Only **substantive changes** (status, severity, or meaningful summary differences) trigger desktop notifications. Link-only or cosmetic changes are logged silently.
4. The LLM's `hasNewInfo` flag provides a first-pass filter — if the LLM says nothing changed, FlightDeck preserves all existing fields to prevent signature drift from rephrasing.

---

## 5. Security Model

How FlightDeck isolates the renderer from Node.js and validates external content.

```mermaid
graph TB
    subgraph Security["Security Boundary"]
        direction TB
        subgraph RendererSandbox["Renderer Sandbox"]
            CSP["CSP: default-src 'self'<br/>No inline scripts<br/>No external resources"]
            NoNode["nodeIntegration: false<br/>contextIsolation: true"]
            Escape["All LLM output HTML-escaped<br/>before DOM insertion"]
        end

        Bridge["contextBridge · preload.js<br/>Explicit API surface only"]

        subgraph MainTrust["Main Process · Trusted"]
            URLCheck["URL validation<br/>HTTPS only"]
            NavGuard["External navigation<br/>intercepted → system browser"]
            PTYIsolation["PTY process isolation<br/>5-min timeout kill"]
        end
    end

    RendererSandbox <-->|"window.workiq.*<br/>11 whitelisted methods"| Bridge
    Bridge <-->|"Named IPC channels"| MainTrust
```

| Layer | Measure |
|-------|---------|
| **Content Security Policy** | `default-src 'self'; style-src 'self'; script-src 'self'` — no inline scripts, no external resources |
| **Context isolation** | Renderer cannot access Node.js APIs directly |
| **Node integration** | Explicitly disabled |
| **IPC surface** | Only 11 named channels exposed through `preload.js` |
| **External navigation** | All navigation attempts intercepted and opened in the system browser, never in the Electron window |
| **URL validation** | Non-HTTPS schemes rejected before opening |
| **LLM output sanitization** | All AI-generated text is HTML-escaped before DOM insertion to prevent injection |
| **PTY timeout** | 5-minute hard timeout kills hung WorkIQ processes |

---

## 6. Responsible AI (RAI) Notes

| Concern | Mitigation |
|---------|------------|
| **Data access scope** | FlightDeck accesses only the signed-in user's own M365 data via WorkIQ + Microsoft Copilot. No cross-tenant or cross-user data access. Requires tenant admin consent. |
| **AI grounding** | All Copilot responses are grounded in the user's real M365 signals (email, Teams, calendar, documents). FlightDeck prompts explicitly request citations and evidence links back to source content. |
| **Hallucination mitigation** | JSON schema constraints in prompts enforce structured output. The parser validates response structure before rendering. Evidence links are validated against known URL patterns (Outlook, Teams, SharePoint). |
| **No data storage beyond device** | All user data is stored locally in `localStorage` and a window-state JSON file. No data is sent to external servers beyond the existing WorkIQ → Copilot → Graph API path. |
| **Prompt transparency** | Users can view and edit the exact prompts sent to Copilot via the in-app prompt editor. No hidden instructions. |
| **LLM output sanitization** | All AI-generated text is HTML-escaped before rendering. No raw HTML or script content from AI responses reaches the DOM. |
| **EULA and consent** | WorkIQ requires explicit EULA acceptance. FlightDeck auto-detects when the EULA needs re-acceptance and surfaces the "Enable WorkIQ" flow. |
