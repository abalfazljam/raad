<div dir="rtl">

# ⚡ رعد — دانلود منیجر مدرن جایگزین IDM

[![Release](https://img.shields.io/badge/دانلود-آخرین_نسخه-6366f1)](../../releases/latest)
[![Platform](https://img.shields.io/badge/پلتفرم-Windows-blue)](../../releases)
[![Electron](https://img.shields.io/badge/Electron-33-47848F)](https://www.electronjs.org/)
[![License: MIT](https://img.shields.io/badge/مجوز-MIT-green)](LICENSE)

**[English version 🇬🇧](README.md)**

**رعد** یک دانلود منیجر مدرن، متن‌باز (MIT) و **پرتابل** ساخته‌شده با **Electron** است — طراحی‌شده به‌عنوان جایگزین واقعی IDM: موتور دانلود چندتکه، توقف/ادامه، زمان‌بندی، واردکردن گروهی از کلیپ‌بورد، افزونه کروم/فایرفاکس با پنجره دانلود شناور و انتقال واقعی تاریخچه IDM.

> **پرتابل، بدون نصب‌کننده.** فایل `RaadDM-Portable-x.x.x.exe` را از [Releases](../../releases/latest) بگیر، دوبار کلیک کن — تمام. همه داده‌ها در پوشه `Raad-Data` کنار همان فایل ذخیره می‌شود.

| لیست دانلود | تم متحرک (شفق قطبی) |
|---|---|
| ![downloads](screenshots/view-downloads-populated.png) | ![aurora](screenshots/theme-aurora.png) |

| تنظیمات ظاهر | پنجره شناور دانلود (مثل IDM) |
|---|---|
| ![settings](screenshots/view-settings-appearance.png) | ![dialog](screenshots/dialog.png) |

---

## ✨ امکانات

- 🚀 **موتور دانلود چندتکه** — تا ۳۲ اتصال موازی برای هر فایل، مثل IDM
- ⏸ **توقف / ادامه / از سرگیری** — حتی بعد از بستن برنامه (فایل state کنار فایل ناتمام ذخیره می‌شود)
- 📥 **صف دانلود** — تعداد دانلود همزمان قابل تنظیم + «شروع همه / توقف همه»
- 🗂 **دسته‌بندی خودکار** — Video / Music / Archive / Program / Document / Image در زیرپوشه‌های مجزا
- 🐢 **محدودیت سرعت کلی** — بدون قطع دانلودها
- ⏰ **زمان‌بندی** — بازه‌های روزانه/هفتگی + گزینه خاموش‌کردن خودکار سیستم پس از خالی‌شدن صف
- 📋 **مانیتور کلیپ‌بورد** — تشخیص خودکار یک یا چند لینک کپی‌شده + افزودن گروهی با تیک
- 🌐 **افزونه کروم و فایرفاکس** — کلیک روی لینک دانلود ← پنجره شناور رعد (تجربه IDM)؛ با یک کلیک فعال/غیرفعال می‌شود (بج OFF روی آیکون)
- 🔄 **انتقال از IDM** — تاریخچه از فایل `UrlHistory.txt` خود IDM + تنظیمات از رجیستری
- 🎨 **ظاهر کاملاً شخصی‌سازی‌شدنی** — تیره/روشن/سیستمی × ۳ قالب (شیشه‌ای، فلت، نرم) × ۶ رنگ آماده + **رنگ دلخواه** + **۵ تم پس‌زمینه متحرک** (شفق قطبی، ستاره‌باران، موج، ذرات، مش رنگی) + گردی گوشه‌ها + اندازه متن + شدت نور پس‌زمینه + حالت فشرده
- 🌍 **دوزبانه** — فارسی/انگلیسی، جهت RTL/LTR خودکار، فونت وزیرمتن داخل بسته

## 🖼 تم‌های انیمیشنی

| شفق قطبی | ستاره‌باران | مش رنگی |
|---|---|---|
| ![aurora](screenshots/theme-aurora.png) | ![stars](screenshots/theme-stars.png) | ![mesh](screenshots/theme-mesh.png) |

| ذرات | موج | حالت روشن |
|---|---|---|
| ![particles](screenshots/theme-particles.png) | ![waves](screenshots/theme-waves.png) | ![light](screenshots/view-downloads-light.png) |

متن‌ها همیشه روی پنل‌های واضح نشان داده می‌شوند — تم‌های متحرک فقط پس‌زمینه را زنده می‌کنند و خوانایی حفظ می‌شود.

## 📥 نصب (بدون نصب‌کننده، بدون دستور)

1. از صفحه [Releases](../../releases/latest) فایل **`RaadDM-Portable-x.x.x.exe`** را دانلود کن.
2. دوبار کلیک کن. اجرای اول چند ثانیه بیشتر طول می‌کشد (برنامه خودش را در پوشه موقت ویندوز باز می‌کند — طبیعی است).
3. اگر SmartScreen هشدار داد: `More info → Run anyway` (چون فایل امضای دیجیتال ندارد).
4. حذف کامل برنامه = پاک کردن فایل exe و پوشه `Raad-Data` کنارش. هیچ چیزی در رجیستری نصب نمی‌شود.

## 🌐 نصب افزونه مرورگر

| کروم / Edge / Brave | فایرفاکس |
|---|---|
| `chrome://extensions` → Developer mode → **Load unpacked** → پوشه `extension/chrome` | `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → فایل `extension/firefox/manifest.json` |

سپس در برنامه رعد: **تنظیمات ← افزونه مرورگر ← کپی JSON** و در پاپ‌آپ افزونه Paste و Save کن.

- کلیک روی **دکمه بزرگ ON/OFF** بالای پاپ‌آپ افزونه = فعال/غیرفعال کردن شنود دانلودها
- راست‌کلیک در صفحه ← «Disable/Enable Raad interception»
- بعد از آن: کلیک روی هر لینک دانلود در مرورگر ← پنجره شناور رعد باز می‌شود و دانلود با رعد ادامه پیدا می‌کند

## 🔄 انتقال تاریخچه و تنظیمات IDM

IDM تاریخچه دانلودها را در رجیستری نگه نمی‌دارد — فایل `UrlHistory.txt` مخصوص این کار است (طبق مستندات رسمی IDM). روش‌های انتقال در رعد:

| روش | توضیح |
|---|---|
| **خودکار** (همان ویندوز) | در برنامه: «انتقال از IDM ← انتقال خودکار» — فایل `%APPDATA%\IDM\UrlHistory.txt` خوانده می‌شود + تنظیمات از رجیستری. فقط IDM باید بسته باشد. |
| **فایل تاریخچه** | از رایانه قدیمی: پوشه `%APPDATA%\IDM` ← کپی `UrlHistory.txt` ← در رعد: «فایل تاریخچه / اکسپورت IDM» |
| **لیست لینک** | در خود IDM منوی `Tasks → Export` (خروجی متنی) یا هر فایل متنی حاوی لینک |
| **تنظیمات IDM** | در `regedit` کلید `HKEY_CURRENT_USER\Software\DownloadManager` → Export → فایل `.reg` را در رعد بده |

## 🛠 ساخت از سورس

```bash
git clone https://github.com/abalfazljam/raad.git
cd raad
npm install
npm start            # اجرای مستقیم (سورس)
npm run dist:win     # ساخت RaadDM-Portable.exe ویندوز (پرتابل)
```

پیش‌نیاز: Node.js 18+ . بیلد ویندوز روی لینوکس هم انجام می‌شود (makensis نیتیو، بدون Wine).

## 🧱 ساختار پروژه

```
main/       → موتور دانلود (چندتکه + صف + محدودیت سرعت)، زمان‌بند، پل HTTP افزونه‌ها، پارسر IDM
preload/    → پل امن (contextIsolation) به‌صورت window.raad
renderer/   → رابط کاربری (JS خالص + CSS، بدون فریمورک) + پنجره شناور دانلود
extension/  → افزونه Chrome (MV3) و Firefox (MV2) + راهنما
native/     → (اختیاری) هاست Native Messaging
scripts/    → ساخت آیکون، تست پارسر IDM، بسته‌بندی
```

- **صفر وابستگی runtime** — فقط Electron؛ موتور دانلود روی `electron.net`
- ذخیره‌سازی JSON اتمیک (بدون SQLite، بدون native module)
- پل افزونه‌ها: HTTP لوکال `127.0.0.1` با توکن امنیتی قابل بازیابی

## 📄 مجوز

MIT — رایگان برای استفاده شخصی و تجاری. ساخته‌شده با ⚡ برای کاربران فارسی‌زبان و همه جای دنیا.

</div>
