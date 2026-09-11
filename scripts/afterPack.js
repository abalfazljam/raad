'use strict';
/* Raad DM — electron-builder afterPack hook (Windows only).
 *
 * WHY: package.json sets signAndEditExecutable:false because wine is not
 * available on the Linux build machine. Without that step the packaged exe
 * keeps Electron's default metadata — Task Manager showed the process as
 * "Electron" with the stock Electron icon instead of the Raad brand.
 *
 * This hook does the same branding with resedit (PURE JS PE resource editor,
 * no wine needed): embeds assets/icons/icon.ico and rewrites the version
 * strings so Windows shows "Raad Download Manager" + the lightning icon. */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const appInfo = context.packager.appInfo;
  const outDir = context.appOutDir;               // …/win-unpacked
  const exeCandidates = fs.readdirSync(outDir).filter(f => f.toLowerCase().endsWith('.exe'));
  if (!exeCandidates.length) { console.warn('[afterPack] no exe found in ' + outDir); return; }
  const exe = path.join(outDir, exeCandidates[0]);
  const reseditBin = path.join(__dirname, '..', 'node_modules', '.bin', 'resedit');
  const ver = appInfo.version + '.0';             // resedit needs n.n.n.n
  const args = [
    '--in', exe, '--out', exe,
    '--icon', path.join(__dirname, '..', 'assets', 'icons', 'icon.ico'),
    '--file-description', 'Raad Download Manager',
    '--product-name', 'Raad Download Manager',
    '--company-name', 'Raad Team',
    '--original-filename', 'Raad.exe',
    '--internal-name', 'Raad',
    '--file-version', ver,
    '--product-version', ver
  ];
  console.log('[afterPack] branding ' + exeCandidates[0] + ' → "Raad Download Manager" + icon.ico');
  execFileSync(reseditBin, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  console.log('[afterPack] done');
};
