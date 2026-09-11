# Raad Native Messaging Host (اختیاری)

روش دوم ارتباط افزونه ↔ برنامه (روش پیش‌فرض HTTP روی `127.0.0.1` است و برای اکثر کاربران کافی است).
مزیت NM: مستقل از پورت و CORS، مثل خود IDM.

## نصب (ویندوز)

```bat
:: 1) extension ID افزونه کروم را از chrome://extensions بردار
python raad-native-host.py --install-chrome EXTENSION_ID

:: 2) فایرفاکس
python raad-native-host.py --install-firefox raad-dm@raad.dev
```

اسکریپت، مانیفست NM را در `HKCU` ثبت می‌کند و `run-host.bat` می‌سازد.

## تنظیم توکن
فایل `native-host.json` کنار همین اسکریپت بساز:

```json
{ "port": 27500, "token": "توکن از تنظیمات برنامه" }
```

نیازمندی: Python 3.8+ بدون هیچ کتابخانه اضافه.
