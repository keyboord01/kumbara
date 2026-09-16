# Speaker notes · Kumbara by Sembol

Read aloud; at most 60 words per slide. TR first, then EN. Everything shown is Stellar TESTNET.

Two variants share these notes. **SCF** (`kumbara-deck-scf.pdf`, 12 slides): 1 to 8, then **9 · Team**, **10 · Roadmap**, **11 · Budget and metric**, **B · Appendix · hours**. **Hackathon** (`kumbara-deck-hackathon.pdf`, 8 slides, judges only, no SCF material): 1, 2, 3, **3b · Try it now**, 4, 5, 6, 7.

## 1 · Title

**TR.** Merhaba, biz Kumbara ekibiyiz: Ahmed Murshed, Kutay Sarı, Ben Luelo; üç mühendis, hepsi Stellar üzerinde üretiyor. Kumbara, lirayla maaş alanlar için dolar birikimi: havale ile yükle, USDC olarak kasada dursun, istediğinde liraya çek. Tek anahtar bir passkey. Her şey Stellar test ağında.

**EN.** Hi, we are the Kumbara team: Ahmed Murshed, Kutay Sarı and Ben Luelo, three engineers, all shipping on Stellar. Kumbara is dollar savings for people paid in lira: bank transfer in, USDC in a vault, lira back out. A passkey is the only key. Everything here runs on Stellar testnet.

## 2 · Problem

**TR.** Merkez bankası kuru: 2019 sonunda bir dolar 5,94 lira, bugün 48,23. Sekiz kat. Enflasyon yüzde 31,5. 2019'da bankada bırakılan yüz bin lira bugün iki bin dolar; dolar olarak tutulsaydı on yedi bin. Dolar yolu ise borsa uygulaması, tohum kelime, gaz için XLM.

**EN.** Central bank rate: a dollar was 5.94 lira at the end of 2019, 48.23 today. Eight times. Inflation is 31.5 percent. A hundred thousand lira left in the bank since 2019 is two thousand dollars now; kept as dollars, seventeen thousand. The dollar route means an exchange app, a seed phrase, XLM for gas.

## 3 · How we solve it

**TR.** Dört ekran. Bir dokunuş, passkey anahtarı üretir. Lirayı her zamanki gibi IBAN'a gönderirsin. USDC olarak DeFindex kasasında durur; anahtar sende. İstediğinde kendi IBAN'ına lira olarak geri döner.

**EN.** Four screens. One tap, a passkey makes the key. You send lira to an IBAN as you always do. It sits as USDC in a DeFindex vault; you hold the key. Lira comes back to your own IBAN whenever you want.

## 3b · Try it now (hackathon variant)

**TR.** Şimdi deneyin: kodu okutun, Open your kumbara'ya dokunun (uygulama İngilizce açılır; üstten Türkçe'ye geçilir), Face ID ya da Touch ID. Hesabınız açıldı. Deposit deyin, yüz yazın; bankayı ben oynatıyorum, bir dakikaya USDC kasada. Withdraw deyin, lira IBAN'a döner. Kurulum yok, kelime yok, XLM yok. Test ağı, gerçek para değil. Sayaç arkamda.

**EN.** Try it now: scan, tap Open your kumbara, Face ID or Touch ID. Your account exists. Tap Deposit, enter one hundred; I play the bank, and in about a minute the USDC is in the vault. Tap Withdraw and the lira comes back to the IBAN. The app opens in English; Türkçe is one tap away at the top. No install, no words, no XLM. Testnet, not real money. The counter is behind me.

## 4 · Why it is better

**TR.** Paranızı kim tutuyor? Bankada banka, borsada borsa; tohum kelimeli cüzdanda ve Kumbara'da siz. Fark ödevde: cüzdan on iki kelime, gaz için XLM ve kurulum ister; lira giriş çıkışı anchor desteğine bağlıdır. Kumbara'da passkey imzalar, relay ücreti öder, lisanslı anchor lirayı taşır; kurulacak bir şey yok.

**EN.** Who holds your money? At the bank, the bank; at the exchange, the exchange; with a seed-phrase wallet and with Kumbara, you. The difference is the homework: a wallet demands twelve words, XLM for gas and an install, and lira in and out depends on its anchor support. With Kumbara a passkey signs, a relay pays the fees, a licensed anchor moves the lira; nothing to install.

## 5 · How it works

**TR.** Beş hamle: passkey akıllı hesabı açar, limit zincire yazılır, anchor IBAN verir, geçici hesap USDC'yi iletir, bir onayla kasa. Köprü: anchor yalnızca normal bir Stellar hesabına ödeyebilir. Para gelmeden önce yalnızca iki işlemi imzalanmış geçici bir hesap yaratırız: ilet, sonra kapan. Biz dahil kimse yönünü değiştiremez. Emanet yok, bize güven gerekmiyor.

**EN.** Five moves: a passkey opens the smart account, the limit is written on-chain, the anchor issues an IBAN, a temporary account forwards the USDC, one approval into the vault. The bridge: the anchor can only pay a normal Stellar account. We create a temporary account whose only two transactions are signed before any money arrives: forward, then close. Nobody, including us, can redirect it. No custody, no trust in us.

## 6 · Where else it works

**TR.** Aynı uygulama, sıradaki anchor. Türkiye bugün sandbox anchor'la; Arjantin ve Bolivya Koywe ile listede, API bir iki hafta. Ana ağdan önce anchor'ı seçeriz: lisanslı, kendi banka hesabına ödeyen, emanet almayan uygulamaya yazılı teyit veren. TRY anchor'ı uyarsa Türkiye; yoksa Koywe ile Arjantin. İki durumda da aynı uygulama.

**EN.** Same app, next anchor. Türkiye runs on a sandbox anchor today; Argentina and Bolivia are on the list through Koywe, API in one to two weeks. Before mainnet we pick the anchor: licensed, pays your own bank account, confirms in writing that a non-custodial app can integrate. Türkiye if a TRY anchor qualifies; otherwise Argentina on Koywe. Same app either way.

## 7 · Evidence

**TR.** Kullanıcılar ve işlemler, hepsi zincirde: 17 Eylül itibarıyla altı kumbara açıldı, sekiz yükleme, iki çekim, kasada 1.055 USDC; test hesapları sayılmadı. Desteden bu yana eklenenler: yalnızca passkey ile kurtarma, zincirin ne dediğini gösteren kanıt ekranı, isimli kumbara ve hedef, davet bağlantısı, /stats'ta huni, sayfa kapalıyken yüklemeyi taşıyan stant sürücüsü; CI'da on iki tur, yirmi yedi hata ekranı; depo herkese açık. Her sayının bağlantısı ekranda. 19–20 Eylül'de bunlar stant sayıları olacak. Sırada: Sembol Cloud v0 ana ağda, anchor görüşmeleri, etkinlikten sonra SCF Integration Track.

**EN.** Users and transactions, all on chain: as of 17 September, six kumbaras opened, eight deposits, two withdrawals, 1,055 USDC in the vault; test accounts excluded. Added since the deck: recovery with the passkey alone, a proof screen that shows what the chain says, a named kumbara with a goal, an invite link, a funnel on /stats, a booth driver that carries a deposit while the page is closed; twelve CI round trips, twenty-seven failure screens; the repository is public. Every number links. On 19–20 September these become the booth numbers. Next: Sembol Cloud v0 on mainnet, anchor conversations, the SCF Integration Track after the event.

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
