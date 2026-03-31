const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
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

function runWorkiqCommand(question) {
  log('[main] Received question:', question);

  if (!workiqLauncher || !fs.existsSync(workiqLauncher)) {
    logError('[main] WorkIQ launcher not found!');
    const error = !isWindows && !workiqLauncher
      ? 'WorkIQ CLI not found. Install it with: npm install -g @microsoft/workiq'
      : `WorkIQ launcher not found at: ${workiqLauncher}`;
    return Promise.resolve({ success: false, error });
  }

  let executable, args;
  if (workiqMode === 'exe' || workiqMode === 'system') {
    executable = workiqLauncher;
    args = ['ask', '-q', question];
  } else {
    executable = getNodeExecutable();
    args = [workiqLauncher, 'ask', '-q', question];
  }
  log('[main] Using executable:', executable);
  log('[main] PTY args prepared:', args);

  return new Promise((resolve) => {
    let outputBuffer = '';
    let resolved = false;

    const extractOutput = () => {
      const normalized = stripAnsi(outputBuffer).replace(/\r/g, '');
      const lines = normalized
        .split('\n')
        .map((line) => line.trimEnd())
        .filter((line) => line.trim())
        .filter((line) => !line.startsWith('>'));

      const output = lines.join('\n').trim();
      return { output };
    };

    const finalize = (exitCode, reason) => {
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
      log('[main] Raw WorkIQ output start');
      console.log(output);
      log('[main] Raw WorkIQ output end');

      if (effectiveExitCode === 0 && output) {
        resolve({ success: true, answer: output });
      } else if (output) {
        resolve({ success: false, error: output });
      } else if (effectiveExitCode === 0) {
        resolve({ success: false, error: 'WorkIQ returned no output. You may need to sign in — try running "workiq" in a terminal first.' });
      } else {
        resolve({ success: false, error: `WorkIQ exited with code ${effectiveExitCode} and no captured output.` });
      }
    };

    const proc = pty.spawn(executable, args, {
      cwd: process.cwd(),
      // Use a very wide terminal to prevent line-wrapping artifacts.
      // node-pty can duplicate characters at wrap boundaries, corrupting
      // long URLs embedded in JSON responses.
      cols: 32000,
      rows: 30,
      env: {
        ...process.env,
      },
    });

    log('[main] PTY spawned, pid:', proc.pid);

    const timeout = setTimeout(() => {
      try {
        proc.kill();
      } catch (error) {
        logError('[main] Failed to kill timed out PTY process:', error.message);
      }
      finalize(1, 'hard-timeout');
    }, 300000);

    proc.onData((chunk) => {
      outputBuffer += chunk;
      log('[main] pty chunk length:', chunk.length);
    });

    proc.onExit(({ exitCode }) => {
      log('[main] PTY exited with code:', exitCode);
      log('[main] PTY output length:', outputBuffer.length);
      finalize(exitCode, 'pty-exit');
    });
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
    const dataChunks = [];

    const finalize = (exitCode, reason) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);

      const output = stripAnsi(outputBuffer).replace(/\r/g, '').trim();
      diagnostics.exitCode = exitCode;
      diagnostics.reason = reason;
      diagnostics.rawOutputLength = outputBuffer.length;
      diagnostics.cleanedOutput = output;
      diagnostics.dataChunks = dataChunks;
      log('[main] accept-eula finalize reason:', reason, 'exit:', exitCode);
      log('[main] accept-eula output:', output);

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
      const cleanChunk = stripAnsi(chunk).trim();
      if (cleanChunk) dataChunks.push(cleanChunk);
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
  runWorkiqCommand,
  runWorkiqAcceptEula,
};
