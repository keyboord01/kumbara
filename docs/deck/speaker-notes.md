# Speaker notes · Kumbara by Sembol

Read aloud; at most 60 words per slide. TR first, then EN. Everything shown is Stellar TESTNET.

Two variants share these notes. **SCF** (`kumbara-deck-scf.pdf`, 12 slides): 1 to 8, then **9 · Team**, **10 · Roadmap**, **11 · Budget and metric**, **B · Appendix · hours**. **Hackathon** (`kumbara-deck-hackathon.pdf`, 8 slides, judges only, no SCF material): 1, 2, 3, **3b · Try it now**, 4, 5, 6, 7.

## 1 · Title

**TR.** Merhaba, ben Ahmed. Kumbara, lirayla maaş alanlar için dolar birikimi: havale ile yükle, USDC olarak kasada dursun, istediğinde liraya çek. Tek anahtar bir passkey. Her şey Stellar test ağında.

**EN.** Hi, I'm Ahmed. Kumbara is dollar savings for people paid in lira: bank transfer in, USDC in a vault, lira back out. A passkey is the only key. Everything here runs on Stellar testnet.

## 2 · Problem

**TR.** Merkez bankası kuru: 2019 sonunda bir dolar 5,94 lira, bugün 48,23. Sekiz kat. Enflasyon yüzde 31,5. 2019'da bankada bırakılan yüz bin lira bugün iki bin dolar; dolar olarak tutulsaydı on yedi bin. Dolar yolu ise borsa uygulaması, tohum kelime, gaz için XLM.

**EN.** Central bank rate: a dollar was 5.94 lira at the end of 2019, 48.23 today. Eight times. Inflation is 31.5 percent. A hundred thousand lira left in the bank since 2019 is two thousand dollars now; kept as dollars, seventeen thousand. The dollar route means an exchange app, a seed phrase, XLM for gas.

## 3 · How we solve it

**TR.** Dört ekran. Bir dokunuş, passkey anahtarı üretir. Lirayı her zamanki gibi IBAN'a gönderirsin. USDC olarak DeFindex kasasında durur; anahtar sende. İstediğinde kendi IBAN'ına lira olarak geri döner.

**EN.** Four screens. One tap, a passkey makes the key. You send lira to an IBAN as you always do. It sits as USDC in a DeFindex vault; you hold the key. Lira comes back to your own IBAN whenever you want.

## 3b · Try it now (hackathon variant)

**TR.** Şimdi deneyin: kodu okutun, Kumbaranı aç'a dokunun, Face ID ya da Touch ID. Hesabınız açıldı. Yükle deyin, yüz yazın; bankayı ben oynatıyorum, bir dakikaya USDC kasada. Çek deyin, lira IBAN'a döner. Kurulum yok, kelime yok, XLM yok. Test ağı, gerçek para değil. Sayaç arkamda.

**EN.** Try it now: scan, tap Kumbaranı aç, Face ID or Touch ID. Your account exists. Tap Yükle, enter one hundred; I play the bank, and in about a minute the USDC is in the vault. Tap Çek and the lira comes back to the IBAN. No install, no words, no XLM. Testnet, not real money. The counter is behind me.

## 4 · Why it is better

**TR.** Banka ve borsa dolarını tutar. Cüzdan anahtarı verir ama tohum kelime ve XLM ister. Kumbara anahtarı sana verir: passkey imzalar, relay ücreti öder, lisanslı anchor lirayı taşır. Kurulacak bir şey yok.

**EN.** The bank and the exchange hold your dollars. A wallet gives you the key but demands a seed phrase and XLM. Kumbara gives you the key: a passkey signs, a relay pays the fees, a licensed anchor moves the lira. Nothing to install.

## 5 · How it works

**TR.** Beş hamle: passkey ile akıllı hesap, zincirde harcama limiti, anchor'dan IBAN, köprü hesabı USDC'yi kumbaraya iletir ve kendini kapatır, bir onayla kasaya. Bulgumuz: anchor'lar klasik hesaba öder, akıllı hesap sözleşmedir; köprü hesabı bunu çözer. Onda on eşleşme.

**EN.** Five moves: passkey to smart account, a spending limit on-chain, an IBAN from the anchor, a bridge account that forwards the USDC and closes itself, one approval into the vault. Our finding: anchors pay classic accounts, smart accounts are contracts; the bridge account fixes that. Ten of ten matches.

## 6 · Where else it works

**TR.** Aynı uygulama, sıradaki anchor. Yeni pazar bir anchor yapılandırması, bir çeviri, bir kur çifti; kasa, cüzdan ve köprü hesapları değişmez. Yüksek enflasyon, havale alışkanlığı, Stellar anchor'ı olan yerler: Türkiye önce, Arjantin ve Bolivya aynı listede.

**EN.** Same app, next anchor. A new market is one anchor config, one translation, one rate pair; vault, wallet and bridge accounts do not change. High inflation, a bank-transfer habit, a Stellar anchor: Türkiye first, Argentina and Bolivia on the same list.

## 7 · Evidence

**TR.** Altı gerçek tarayıcı turu CI'da, her gönderimde ve altı saatte bir üretime karşı. Yirmi beş hata ekranı. Lighthouse 94 ve üç kez 100. Kasa kurulum, yatırma ve çekme karmaları test ağında. Sırada: Sembol Cloud ana ağda, anchor görüşmeleri, etkinlikten sonra SCF.

**EN.** Six real-browser round trips in CI, every push and every six hours against production. Twenty-five failure screens. Lighthouse 94 and three hundreds. Vault deploy, invest and divest hashes on testnet. Next: Sembol Cloud on mainnet, anchor conversations, SCF after the event.

## 8 · Regulatory posture

**TR.** Kumbara emanet almaz: lira, USDC ya da anahtar tutmaz. Lisanslı anchor parayı tutar, KYC yapar, kendi IBAN'ına öder. Ödeme özelliği yok. Kapı: anchor'ın yazılı görüşü, birinci dilimde. Türkiye geçemezse pilot listedeki en üst pazarda açılır.

**EN.** Kumbara is non-custodial: it never holds lira, USDC or keys. The licensed anchor holds the fiat, does KYC, pays your own IBAN. No payments feature. The gate: the anchor's written position, in Tranche 1. If Türkiye fails, the pilot launches in the top-ranked market.

## 9 · Team

**TR.** Tek kişilik bir ekip, ama üreten bir ekip. Instaward hibesi aldım, passkey-react kütüphanesini yazdım ve smart-account-kit'e birleşen bir düzeltme gönderdim. Kumbara'yı uçtan uca ben kurdum: uygulama, köprü hesapları, CI turları. Bağlantılar ekranda.

**EN.** A team of one, but one that ships. I hold an Instaward grant, wrote the passkey-react library, and landed a fix in smart-account-kit. I built Kumbara end to end: the app, the bridge accounts, the CI round trips. Links are on the slide.

## 10 · Roadmap

**TR.** Üç dilim, altmışar gün. Birincisi cüzdan katmanı ve relay sertleştirme, hepsi benim elimde: tek işlemle açılış, passkey-react 0.4, relay ana ağ sertleştirmesi, anchor kısa listesi ve git/gitme. İkincisi seçilen anchor bağlı, STRIDE tehdit modeli, izleme, denetim ve düzeltmeler, kapalı ana ağ yolu. Üçüncüsü pilot pazarda ana ağ, elli ile yüz kişilik pilot, nöbet, otuz günlük ölçüt penceresi.

**EN.** Three tranches of sixty days. First, wallet layer and relay hardening, all in my control: single-transaction onboarding, passkey-react 0.4, relay mainnet hardening, the anchor shortlist and go/no-go. Second, the selected anchor wired in, STRIDE threat model, monitoring, audit and fixes, a capped mainnet path. Third, mainnet in the pilot market, fifty to a hundred pilot users, the thirty-day window.

## 11 · Budget and metric

**TR.** Yüz yedi bin üç yüz dolar; her dolar saat. Tam zamanlı çalışıyorum, saatte doksan beş dolar, dilim başına üç yüz kırk saat. Yüklenici kapasitesi yüz altmış saat, saatte altmış beş dolar; hiçbir kapı işe alıma bağlı değil. Ölçüt: açılıştan sonraki otuz günde ortalama iki bin beş yüz USDC NAV; yüz kullanıcı, elli USDC, yüzde elli kalış.

**EN.** One hundred seven thousand three hundred dollars, every dollar hours. I work full-time at ninety-five an hour, three hundred forty hours per tranche. Hired capacity is one hundred sixty hours at sixty-five; no gate depends on a hire. Metric: average NAV of two thousand five hundred USDC over the thirty days after launch; a hundred users, fifty USDC, half retained.

## B · Appendix · line-by-line hours

**TR.** Referans için satır satır saatler: yirmi satır, bin yüz seksen saat. Her satırda kimin yaptığı, kaç saat, kaç dolar ve gözden geçirenlerin nasıl doğrulayacağı yazıyor. Yüklenici satırları ayrı işaretli; işe alım gelmezse satır faturalanmaz ve dilim benim satırlarımla kapanır.

**EN.** Line-by-line hours for reference: twenty lines, one thousand one hundred eighty hours. Each line says who does it, how many hours, how many dollars and how reviewers verify it. Hired lines are marked separately; if a hire does not land, the line is unbilled and the tranche closes on my own lines.
