# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

**Please do not open public issues for security vulnerabilities.**

We use GitHub Security Advisories to receive and manage vulnerability reports. To report a vulnerability:

1. Go to [**Report a vulnerability**](https://github.com/kpoineal/FlightDeck/security/advisories/new)
2. Provide a clear description of the vulnerability, including steps to reproduce
3. Include the version(s) affected
4. If possible, suggest a fix or mitigation

### Response Timeline

- **Initial response:** within 48 hours
- **Assessment and severity classification:** within 7 days
- **Fix timeline:** depends on severity, but we aim to patch critical issues as quickly as possible

We will keep you informed of progress toward a fix and may ask for additional information.

## Responsible Disclosure

We ask that you:

- Give us reasonable time to address the issue before public disclosure
- Act in good faith — do not access or modify other users' data
- Do not exploit the vulnerability beyond what is necessary to demonstrate it
- Coordinate disclosure with us so we can prepare a fix and advisory

## Scope

FlightDeck is an Electron desktop application. The following areas are **in scope** for security reports:

- **Main process vulnerabilities** — privilege escalation, arbitrary code execution, unsafe `electron` API usage
- **Preload bridge / context isolation** — bypasses of the contextBridge boundary, exposure of Node.js APIs to the renderer
- **IPC surface** — handler injection, malicious message crafting, missing input validation on IPC channels
- **Native modules** — vulnerabilities in `node-pty` or other native C++ dependencies (shell spawning, buffer overflows)
- **Dependency vulnerabilities** — known CVEs in direct or transitive dependencies
- **Data handling** — insecure storage of credentials or tokens, unprotected sensitive data on disk

## Out of Scope

The following are **not** considered security issues for this project:

- **Social engineering** — phishing, pretexting, or other attacks targeting users rather than the application
- **Denial of service against the local app** — crashing or freezing the local Electron process (this is a single-user desktop app)
- **Issues requiring physical access** to the user's machine beyond what any local app would expose
- **Bugs that do not have a security impact** — please use regular GitHub Issues for those
