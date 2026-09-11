#!/usr/bin/env python3
"""Raad DM — Native Messaging host (optional advanced mode).
Bridges browser Native Messaging → Raad local HTTP bridge.

Setup (Windows):
  1) python raad-native-host.py --install-chrome   (needs the extension ID)
  2) python raad-native-host.py --install-firefox
The scripts write the manifest under HKCU and point the browser to this file.

The host reads the token/port from native-host.json next to this file,
or from %USERPROFILE%/.raad/native-host.json.
"""
import json
import os
import sys
import struct
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))


def read_message():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    (length,) = struct.unpack('=I', raw)
    data = sys.stdin.buffer.read(length)
    try:
        return json.loads(data.decode('utf-8'))
    except Exception:
        return None


def send_message(obj):
    data = json.dumps(obj).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('=I', len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def load_conf():
    for p in [os.path.join(HERE, 'native-host.json'),
              os.path.join(os.path.expanduser('~'), '.raad', 'native-host.json')]:
        try:
            with open(p, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            continue
    return {'port': 27500, 'token': ''}


def forward(msg):
    conf = load_conf()
    payload = json.dumps({
        'url': msg.get('url', ''),
        'referrer': msg.get('pageUrl', ''),
        'filename': msg.get('filename', ''),
        'cookies': msg.get('cookies', '') if msg.get('cookies') else ''
    }).encode('utf-8')
    req = urllib.request.Request(
        f"http://127.0.0.1:{conf.get('port', 27500)}/add",
        data=payload, method='POST',
        headers={'Content-Type': 'application/json', 'x-raad-token': conf.get('token', '')})
    try:
        with urllib.request.urlopen(req, timeout=4) as r:
            return json.loads(r.read().decode() or '{}')
    except Exception as e:
        return {'ok': False, 'error': str(e)}


def write_manifest(browser, extension_id):
    name = 'dev.raad.dm'
    exe = sys.executable if os.name != 'nt' else sys.executable
    manifest = {
        'name': name,
        'description': 'Raad Download Manager native host',
        'path': os.path.join(HERE, 'run-host.bat' if os.name == 'nt' else 'run-host.sh'),
        'type': 'stdio',
    }
    if browser == 'chrome':
        manifest['allowed_origins'] = [f'chrome-extension://{extension_id}/']
    else:
        manifest['allowed_extensions'] = [extension_id]

    fname = f'raad-nm-{browser}.json'
    with open(os.path.join(HERE, fname), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)

    if os.name == 'nt':
        key = (r'Software\Google\Chrome\NativeMessagingHosts\dev.raad.dm' if browser == 'chrome'
               else r'Software\Mozilla\NativeMessagingHosts\dev.raad.dm')
        subprocess_reg(['reg', 'add', 'HKCU\\' + key, '/ve', '/t', 'REG_SZ', '/d', os.path.join(HERE, fname), '/f'])
    else:
        base = os.path.expanduser(f'~/.config/google-chrome/NativeMessagingHosts' if browser == 'chrome'
                                  else '~/.mozilla/native-messaging-hosts')
        os.makedirs(base, exist_ok=True)
        with open(os.path.join(base, fname), 'w') as f:
            json.dump(manifest, f, indent=2)
    print(f'{browser} native-messaging manifest installed: {fname}')


def subprocess_reg(args):
    import subprocess
    subprocess.run(args, check=False)


def make_runners():
    if os.name == 'nt':
        with open(os.path.join(HERE, 'run-host.bat'), 'w') as f:
            f.write('@echo off\r\n"%s" "%s" %%*\r\n' % (sys.executable, os.path.join(HERE, 'raad-native-host.py')))
    else:
        p = os.path.join(HERE, 'run-host.sh')
        with open(p, 'w') as f:
            f.write('#!/bin/sh\nexec "%s" "%s" "$@"\n' % (sys.executable, os.path.join(HERE, 'raad-native-host.py')))
        os.chmod(p, 0o755)


if __name__ == '__main__':
    args = sys.argv[1:]
    if '--install-chrome' in args:
        make_runners()
        write_manifest('chrome', args[args.index('--install-chrome') + 1])
    elif '--install-firefox' in args:
        make_runners()
        write_manifest('firefox', args[args.index('--install-firefox') + 1])
    else:
        # native messaging loop
        while True:
            msg = read_message()
            if msg is None:
                break
            if msg.get('type') == 'raad-add':
                send_message(forward(msg))
            elif msg.get('type') == 'raad-ping':
                conf = load_conf()
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{conf.get('port', 27500)}/ping", timeout=3) as r:
                        send_message(json.loads(r.read().decode() or '{}'))
                except Exception as e:
                    send_message({'ok': False, 'error': str(e)})
            else:
                send_message({'ok': False, 'error': 'unknown message'})
