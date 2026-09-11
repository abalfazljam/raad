# Raad Browser Extension (کروم + فایرفاکس)

| پوشه | مرورگر | نسخه مانیفست |
|---|---|---|
| `chrome/` | Chrome / Edge / Brave / Opera | MV3 (service worker) |
| `firefox/` | Firefox 91+ | MV2 (event page) |

## نصب سریع
- **کروم:** `chrome://extensions` → Developer mode → **Load unpacked** → همین پوشه `chrome`
- **فایرفاکس:** `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → `firefox/manifest.json`
- برای انتشار دائمی فایرفاکس: محتویات پوشه `firefox` را zip کن و در AMO آپلود کن

## اتصال
1. در برنامه رعد: تنظیمات → افزونه مرورگر → **کپی کانفیگ JSON**
2. آیکون افزونه → Paste در کادر → **Save config** → باید «connected» ببینی

## رفتار
- کلیک روی لینک فایل (zip/mp4/exe/pdf/…) → ارسال به رعد → پنجره شناور باز می‌شود
- راست‌کلیک → **Raad → Download with Raad**
- اگر رعد باز نباشد، لینک به‌صورت عادی در مرورگر باز/دانلود می‌شود
- در popup افزونه: خاموش/روشن کردن interception، ارسال کوکی برای سایت‌های لوگین‌دار، غیرفعال‌سازی برای سایت خاص
