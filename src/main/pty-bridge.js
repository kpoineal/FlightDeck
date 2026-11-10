const path = require('path');
const fs = require('fs');
const { execFileSync, spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');
const pty = require('node-pty');
const { log, logError } = require('./utils');

const isWindows = process.platform === 'win32';

// ── Resolve the WorkIQ executable / launcher ─────────────────────────
// Windows: prefer native workiq.exe (bundled → global), then workiq.js.
// macOS / Linux: expect `workiq` pre-installed in the user's PATH.

let workiqMode, workiqLauncher;

if (isWindows) {
  // ── Windows resolution (unchanged) ──────────────────────────────
  const bundledBase = path.join(__dirname, '..', '..', 'node_modules', '@microsoft', 'workiq', 'bin');
  const unpackedBase = bundledBase.replace('app.asar', 'app.asar.unpacked');
  const workiqBinDir = fs.existsSync(unpackedBase) ? unpackedBase : bundledBase;

  const archDir = process.arch === 'arm64' ? 'win-arm64' : 'win-x64';
  const bundledExe = path.join(workiqBinDir, archDir, 'workiq.exe');
  const globalExe = path.join(
    process.env.APPDATA || '', 'npm', 'node_modules', '@microsoft', 'workiq', 'bin', archDir, 'workiq.exe'
  );

  const bundledJs = path.join(workiqBinDir, 'workiq.js');
  const globalJs = path.join(
    process.env.APPDATA || '', 'npm', 'node_modules', '@microsoft', 'workiq', 'bin', 'workiq.js'
  );

  if (fs.existsSync(bundledExe)) {
    workiqMode = 'exe';
    workiqLauncher = bundledExe;
  } else if (fs.existsSync(globalExe)) {
    workiqMode = 'exe';
    workiqLauncher = globalExe;
  } else if (fs.existsSync(bundledJs)) {
    workiqMode = 'js';
    workiqLauncher = bundledJs;
  } else {
    workiqMode = 'js';
    workiqLauncher = globalJs;
  }
} else {
  // ── macOS / Linux resolution ────────────────────────────────────
  // Expect workiq to be installed globally (e.g. npm i -g @microsoft/workiq)
  const commonPaths = ['/usr/local/bin/workiq', '/usr/bin/workiq', '/opt/homebrew/bin/workiq'];
  let resolved = null;

  // Try `which workiq` first
  try {
    resolved = execFileSync('which', ['workiq'], { encoding: 'utf8' }).trim();
  } catch (_) {
    // which failed — try common locations
    for (const p of commonPaths) {
      if (fs.existsSync(p)) { resolved = p; break; }
    }
  }

  if (resolved) {
    // If resolved path is a shebang script (e.g. symlink to .js), run it via Node
    // so it works inside packaged apps where /usr/bin/env node may not resolve.
    const realPath = fs.realpathSync(resolved);
    if (realPath.endsWith('.js')) {
      workiqMode = 'js';
      workiqLauncher = realPath;
    } else {
      workiqMode = 'system';
      workiqLauncher = resolved;
    }
  } else {
    workiqMode = 'system';
    workiqLauncher = null; // not found — error will be surfaced at call time
  }
}
log('[main] WorkIQ mode:', workiqMode, 'launcher:', workiqLauncher);

function getNodeExecutable() {
  if (isWindows) {
    const candidates = [
      process.env.npm_node_execpath,
      process.env.NODE,
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
      process.execPath, // Electron's bundled Node — makes packaged MSI self-contained
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (candidate.toLowerCase().endsWith('.exe') && fs.existsSync(candidate)) {
        return candidate;
      }
    }
  } else {
    const candidates = [
      process.env.npm_node_execpath,
      process.env.NODE,
      '/usr/local/bin/node',
      '/usr/bin/node',
      '/opt/homebrew/bin/node',
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return 'node';
}

function stripAnsi(text) {
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function isWorkiqDiagnostic(output) {
  return /^(?:error|ERROR):\s/i.test(String(output || '').trim());
}

async function runWorkiqCommand(question, options = {}) {
  const args = ['ask', '-q', question, '--json', '--no-streaming'];
  if (options.conversationId) args.push('--conversation-id', options.conversationId);
  const result = await runWorkiqCli(args, options);
  if (!result.success) return result;

  let envelope;
  try {
    envelope = JSON.parse(result.answer);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    logError('[main] WorkIQ CLI returned an invalid JSON envelope');
    return { success: false, code: 'INVALID_RESPONSE', error: 'WorkIQ returned an invalid JSON envelope.' };
  }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
    || envelope.isError !== false || typeof envelope.response !== 'string') {
    const text = typeof envelope?.response === 'string' ? envelope.response : '';
    const code = envelope?.isError === true ? classifyWorkiqFailure(text) : 'INVALID_RESPONSE';
    logError('[main] WorkIQ CLI answer failed:', code);
    return { success: false, code, error: 'WorkIQ did not return a successful answer.' };
  }
  if (!envelope.response.trim()) {
    return { success: false, code: 'EMPTY_RESPONSE', error: 'WorkIQ returned no answer.',
      conversationId: envelope.conversationId };
  }
  return { success: true, answer: envelope.response };
}

function classifyWorkiqFailure(text) {
  return /throttl|rate.?limit|too many requests/i.test(text) ? 'THROTTLED'
    : /auth|sign[ -]?in|login|unauthorized|consent|eula|access.?denied/i.test(text) ? 'AUTH_REQUIRED'
      : 'REQUEST_FAILED';
}

function runWorkiqCli(commandArgs, { timeoutMs = 300000, signal, onExit = () => {}, spawnProcess = spawn, launcher = workiqLauncher, verifyLauncher = true, nodeExecutable } = {}) {
  if (!launcher || (verifyLauncher && !fs.existsSync(launcher))) {
    logError('[main] WorkIQ launcher not found!');
    const error = !isWindows && !workiqLauncher
      ? 'WorkIQ CLI not found. Install it with: npm install -g @microsoft/workiq'
      : `WorkIQ launcher not found at: ${launcher}`;
    onExit();
    return Promise.resolve({ success: false, error, code: 'NOT_INSTALLED' });
  }
  if (signal?.aborted) {
    onExit();
    return Promise.resolve({ success: false, error: 'WorkIQ is shutting down.', code: 'SHUTTING_DOWN' });
  }

  let executable, args;
  if (!launcher.toLowerCase().endsWith('.js')) {
    executable = launcher;
    args = ['--log-level', 'Error', ...commandArgs];
  } else {
    executable = nodeExecutable || getNodeExecutable();
    args = [launcher, '--log-level', 'Error', ...commandArgs];
  }
  log('[main] Using executable:', executable);
  log('[main] WorkIQ CLI command prepared');

  return new Promise((resolve) => {
    let outputBuffer = '';
    let errorBuffer = '';
    let outputBytes = 0;
    const outputDecoder = new StringDecoder('utf8');
    const errorDecoder = new StringDecoder('utf8');
    let resolved = false;
    let timeout;
    let proc;
    let terminated = false;
    let closed = false;
    const processClosed = () => {
      if (closed) return;
      closed = true;
      signal?.removeEventListener('abort', abort);
      onExit();
    };
    const terminate = (code) => {
      if (terminated) return;
      terminated = true;
      finalize(1, code, code);
      try { proc.kill(); }
      catch (_) { logError('[main] Failed to stop WorkIQ CLI process'); }
    };
    const abort = () => terminate('SHUTTING_DOWN');

    const extractOutput = () => {
      return { output: stripAnsi(outputBuffer).replace(/\r/g, '').trim() };
    };

    const finalize = (exitCode, reason, code) => {
      if (resolved) {
        return;
      }
      resolved = true;
      clearTimeout(timeout);

      const { output } = extractOutput();
      const effectiveExitCode = exitCode;

      log('[main] Finalizing reason:', reason);
      log('[main] Effective exit code:', effectiveExitCode);
      log('[main] Final visible output length:', output.length);

      if (code) {
        const messages = { TIMEOUT: 'WorkIQ request timed out.', SHUTTING_DOWN: 'WorkIQ is shutting down.', INVALID_RESPONSE: 'WorkIQ output exceeded the response limit.', START_FAILED: 'WorkIQ CLI could not be started.', PROCESS_EXITED: 'WorkIQ CLI output stream failed.' };
        resolve({ success: false, error: messages[code], code });
      } else if (effectiveExitCode === 0 && output && !isWorkiqDiagnostic(output)) {
        resolve({ success: true, answer: output });
      } else if (output || errorBuffer.trim()) {
        const error = stripAnsi(`${output}\n${errorBuffer}`).trim();
        const code = classifyWorkiqFailure(error);
        resolve({ success: false, error, code });
      } else if (effectiveExitCode === 0) {
        resolve({ success: false, error: 'WorkIQ returned no output.', code: 'INVALID_RESPONSE' });
      } else {
        resolve({ success: false, error: `WorkIQ exited with code ${effectiveExitCode} and no captured output.`, code: 'PROCESS_EXITED' });
      }
    };

    try {
      proc = spawnProcess(executable, args, {
        cwd: process.cwd(),
        env: { ...process.env },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (_) {
      logError('[main] Failed to start WorkIQ CLI process');
      processClosed();
      resolve({ success: false, error: 'WorkIQ CLI could not be started.', code: 'START_FAILED' });
      return;
    }

    log('[main] WorkIQ CLI spawned, pid:', proc.pid);

    timeout = setTimeout(() => terminate('TIMEOUT'), timeoutMs);

    const capture = (chunk, decoder, isError) => {
      outputBytes += chunk.length;
      if (outputBytes > 1024 * 1024) {
        terminate('INVALID_RESPONSE');
        return;
      }
      if (isError) errorBuffer += decoder.write(chunk);
      else outputBuffer += decoder.write(chunk);
    };
    proc.stdout.on('data', chunk => capture(chunk, outputDecoder, false));
    proc.stderr.on('data', chunk => capture(chunk, errorDecoder, true));
    proc.stdout.on('error', () => terminate('PROCESS_EXITED'));
    proc.stderr.on('error', () => terminate('PROCESS_EXITED'));
    proc.on('error', () => {
      logError('[main] WorkIQ CLI process error');
      finalize(1, 'spawn-error', 'START_FAILED');
      if (!proc.pid) processClosed();
    });
    proc.on('close', exitCode => {
      outputBuffer += outputDecoder.end();
      errorBuffer += errorDecoder.end();
      log('[main] WorkIQ CLI exited with code:', exitCode);
      finalize(exitCode, 'cli-exit');
      processClosed();
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function runWorkiqAcceptEula() {
  log('[main] Running workiq accept-eula');
  const diagnostics = {
    workiqMode,
    workiqLauncher,
    launcherExists: workiqLauncher ? fs.existsSync(workiqLauncher) : false,
    arch: process.arch,
    platform: process.platform,
    execPath: process.execPath,
    cwd: process.cwd(),
  };
  log('[main] accept-eula diagnostics:', JSON.stringify(diagnostics));

  if (!diagnostics.launcherExists) {
    logError('[main] WorkIQ launcher not found for accept-eula');
    const error = !isWindows && !workiqLauncher
      ? 'WorkIQ CLI not found. Install it with: npm install -g @microsoft/workiq'
      : `WorkIQ launcher not found at: ${workiqLauncher}`;
    return Promise.resolve({ success: false, error, diagnostics });
  }

  let executable, args;
  if (workiqMode === 'exe' || workiqMode === 'system') {
    executable = workiqLauncher;
    args = ['accept-eula'];
  } else {
    executable = getNodeExecutable();
    args = [workiqLauncher, 'accept-eula'];
  }
  diagnostics.executable = executable;
  diagnostics.args = args;
  log('[main] accept-eula executable:', executable, 'args:', args);

  return new Promise((resolve) => {
    let outputBuffer = '';
    let resolved = false;

    const finalize = (exitCode, reason) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);

      const output = stripAnsi(outputBuffer).replace(/\r/g, '').trim();
      diagnostics.exitCode = exitCode;
      diagnostics.reason = reason;
      diagnostics.rawOutputLength = outputBuffer.length;
      log('[main] accept-eula finalize reason:', reason, 'exit:', exitCode);

      if (exitCode === 0) {
        resolve({ success: true, output, diagnostics });
      } else {
        resolve({ success: false, error: output || `accept-eula exited with code ${exitCode}`, diagnostics });
      }
    };

    let proc;
    try {
      proc = pty.spawn(executable, args, {
        cwd: process.cwd(),
        cols: 200,
        rows: 30,
        env: { ...process.env },
      });
    } catch (spawnErr) {
      logError('[main] Failed to spawn accept-eula PTY:', spawnErr.message);
      resolve({ success: false, error: spawnErr.message });
      return;
    }

    log('[main] accept-eula PTY spawned, pid:', proc.pid);

    const timeout = setTimeout(() => {
      try { proc.kill(); } catch (e) {
        logError('[main] Failed to kill accept-eula PTY:', e.message);
      }
      finalize(1, 'timeout');
    }, 30000);

    proc.onData((chunk) => {
      outputBuffer += chunk;
      // Auto-confirm any Y/N prompt
      const text = stripAnsi(chunk).toLowerCase();
      if (text.includes('(y/n)') || text.includes('[y/n]') || text.includes('accept?') || text.includes('agree?') || text.includes('do you accept')) {
        log('[main] accept-eula: auto-confirming prompt');
        proc.write('y\r');
      }
    });

    proc.onExit(({ exitCode }) => {
      log('[main] accept-eula PTY exited with code:', exitCode);
      finalize(exitCode, 'pty-exit');
    });
  });
}

module.exports = {
  workiqLauncher,
  getNodeExecutable,
  stripAnsi,
  isWorkiqDiagnostic,
  runWorkiqCommand,
  runWorkiqCli,
  runWorkiqAcceptEula,
};
