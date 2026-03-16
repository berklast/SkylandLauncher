# SKYLAND 3

SKYLAND 3, Electron tabanli bir Minecraft launcher prototipidir. Bu surumde giris ve kayit akisinda sadece Firebase Authentication + Realtime Database kullanilir.

## Ozellikler

- Yenilenmis SkyLand arayuzu
- Kullanici adi ile kayit ol / giris yap
- Realtime Database uzerinden profil ve username esleme kaydi
- 30 gun oturum saklama
- Minecraft nicki ile canli skin onizleme
- Mojang surum listesi ve yerel kurulu surumleri gorme
- RAM, dil, fullscreen, cozuunurluk, Java yolu ve oyun klasoru ayarlari

## Kurulum

```bash
npm install
npm start
```

Paket almak istersen:

```bash
npm run build
```

## Firebase Hazirlama

1. Firebase Console icinde `Email/Password` sign-in method'unu ac.
2. `Realtime Database` olustur.
3. `firebase/database.rules.json` icindeki kurallari Realtime Database Rules ekranina yapistirip publish et.
4. Bu surumde kullanici adi aramasi `usernames` yolu uzerinden, profil verisi ise `launcherUsers/{uid}` uzerinden tutulur.
5. Firestore bu akista zorunlu degildir.

## Notlar

- Kayit sirasinda Firebase'in yerlesik e-posta dogrulamasi kullanilir.
- Minecraft baslatma kismi `minecraft-launcher-core` ile calisir.
- OptiFine, Fabric, Forge gibi yerel kurulu custom surumler oyun klasorunde varsa listede gorunur.
