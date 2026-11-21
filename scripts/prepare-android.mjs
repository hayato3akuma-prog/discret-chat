import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const androidMainDir = path.join(root, 'android', 'app', 'src', 'main');
const manifestPath = path.join(androidMainDir, 'AndroidManifest.xml');

if (!fs.existsSync(manifestPath)) {
  console.log('Android project not found yet. Run "npx cap add android" first.');
  process.exit(0);
}

// 1. Inject required Android permissions for real-time WebRTC calls, voice notes, and notifications
const requiredPermissions = [
  'android.permission.INTERNET',
  'android.permission.RECORD_AUDIO',
  'android.permission.CAMERA',
  'android.permission.MODIFY_AUDIO_SETTINGS',
  'android.permission.WAKE_LOCK',
  'android.permission.POST_NOTIFICATIONS',
];

let manifest = fs.readFileSync(manifestPath, 'utf8');
const missing = requiredPermissions.filter((perm) => !manifest.includes(perm));

if (missing.length > 0) {
  const permissionLines = missing
    .map((perm) => `    <uses-permission android:name="${perm}" />`)
    .join('\n');
  manifest = manifest.replace(
    /<application\b/,
    `${permissionLines}\n\n    <application`
  );
  fs.writeFileSync(manifestPath, manifest, 'utf8');
  console.log(`Added Android permissions: ${missing.join(', ')}`);
}

// 2. Copy HOI launcher icons into Android mipmap directories
const icon192 = path.join(root, 'public', 'hoi-192.png');
const icon512 = path.join(root, 'public', 'hoi-512.png');
const iconMaskable = path.join(root, 'public', 'hoi-maskable-512.png');
const resDir = path.join(androidMainDir, 'res');

if (fs.existsSync(resDir) && fs.existsSync(icon192) && fs.existsSync(icon512)) {
  const densityTargets = [
    { dir: 'mipmap-mdpi', src: icon192 },
    { dir: 'mipmap-hdpi', src: icon192 },
    { dir: 'mipmap-xhdpi', src: icon192 },
    { dir: 'mipmap-xxhdpi', src: icon512 },
    { dir: 'mipmap-xxxhdpi', src: icon512 },
  ];

  for (const target of densityTargets) {
    const dirPath = path.join(resDir, target.dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    fs.copyFileSync(target.src, path.join(dirPath, 'ic_launcher.png'));
    fs.copyFileSync(
      fs.existsSync(iconMaskable) ? iconMaskable : target.src,
      path.join(dirPath, 'ic_launcher_round.png')
    );
    fs.copyFileSync(
      fs.existsSync(iconMaskable) ? iconMaskable : target.src,
      path.join(dirPath, 'ic_launcher_foreground.png')
    );
  }
  console.log('Copied HOI launcher icons to Android mipmap folders.');
}

// 3. Ensure dark background color in colors.xml if present
const valuesDir = path.join(resDir, 'values');
const colorsPath = path.join(valuesDir, 'colors.xml');
if (fs.existsSync(valuesDir) && !fs.existsSync(colorsPath)) {
  fs.writeFileSync(
    colorsPath,
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">#050507</color>
    <color name="colorPrimaryDark">#050507</color>
    <color name="colorAccent">#34D399</color>
</resources>
`,
    'utf8'
  );
  console.log('Created dark theme colors.xml for Android.');
}
