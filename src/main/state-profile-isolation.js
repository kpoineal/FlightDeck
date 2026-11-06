'use strict';
const fs = require('node:fs');
const path = require('node:path');

function isolateGeneratedProfile(app) {
  const requested = process.env.FLIGHTDECK_GENERATED_PROFILE;
  if (!requested) return false;
  const profile = path.resolve(requested);
  const root = path.resolve(process.cwd(), 'test-results', 'state-reload');
  if (path.dirname(profile) !== root || !path.basename(profile).startsWith('generated-profile-')
    || fs.readFileSync(path.join(profile, '.generated-state-profile'), 'utf8') !== 'flightdeck-offline-v1') {
    throw new Error('REFUSING_NON_GENERATED_TEST_PROFILE');
  }
  app.setPath('userData', profile);
  app.setPath('sessionData', path.join(profile, 'session'));
  app.setPath('logs', path.join(profile, 'logs'));
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
  return true;
}
module.exports = { isolateGeneratedProfile };
