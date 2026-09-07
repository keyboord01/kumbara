# Speaker notes · Kumbara by Sembol · SCF deck v6

Read aloud. TR first, then EN. The slides carry one idea each; these notes carry everything that was cut. Everything shown is Stellar TESTNET.

## 1 · Title

**TR.** Kumbara, lirayla maaş alan insanlar için dolar birikimi. Tek dokunuş: passkey anahtarı üretir, tohum kelime yok, XLM yok, kurulacak uygulama yok. Havale ile yüklersin, USDC olarak DeFindex kasasında durur, istediğinde kendi IBAN'ına lira olarak döner. Bu destede gördüğünüz her bakiye ve bağlantı Stellar test ağında; ana ağ iddiası yok, getiri iddiası yok.

**EN.** Kumbara is dollar savings for people paid in lira. One tap: a passkey makes the key, no seed phrase, no XLM, nothing to install. You transfer lira, it is held as USDC in a DeFindex vault, and it comes back as lira to your own IBAN. Every balance and link in this deck is Stellar testnet; no mainnet claim, no yield claim.

## 2 · Problem

**TR.** Merkez bankası kuru: 2019 sonunda bir dolar 5,94 lira, 4 Eylül 2026'da 48,23. Sekiz kat. TÜİK'e göre yıllık enflasyon Ağustos'ta yüzde 31,5. 2019'da bankada bırakılan yüz bin lira bugün iki bin dolar; dolar olarak tutulsaydı on yedi bin. Bugünkü dolar yolu: borsa uygulaması, tohum kelime, gaz için XLM. İnsanların çoğu orada duruyor.

**EN.** Central bank rate: a dollar was 5.94 lira at the end of 2019 and 48.23 on 4 September 2026. Eight times. TÜİK puts annual inflation at 31.5 percent in August. A hundred thousand lira left in the bank since 2019 is two thousand dollars today; kept as dollars it would be seventeen thousand. The dollar route today is an exchange app, a seed phrase and XLM for gas. Most people stop there.

## 3 · Solution

**TR.** Dört ekran. Tek dokunuşla passkey anahtarı üretir ve relay akıllı hesabı açar; ölçülen süre sekiz ile on altı saniye. Lirayı her zamanki gibi IBAN'a gönderirsin; anchor lirayı USDC'ye çevirir. USDC, DeFindex kasasında durur ve anahtar sende. İstediğinde kendi IBAN'ına lira olarak geri döner. Ekran görüntüleri üretim ortamından, test ağı tutarlarıyla.

**EN.** Four screens. One tap makes a passkey and the relay deploys the smart account; measured at eight to sixteen seconds. You send lira to an IBAN as you always do; the anchor turns it into USDC. The USDC sits in a DeFindex vault and you hold the key. Lira comes back to your own IBAN whenever you like. Screens are from production, with testnet amounts.

## 4 · Why it is better

**TR.** Banka ve borsa dolarınızı tutar. Tohum kelimeli cüzdan anahtarı size verir ama on iki kelime, gaz için XLM ve bir kurulum ister; lira giriş çıkışı anchor'a göre değişir. Kumbara anahtarı size verir ve ödevi kaldırır: passkey imzalar, relay ücreti öder, lisanslı anchor lirayı taşır, kurulacak bir şey yok.

**EN.** The bank and the exchange hold your dollars. A seed-phrase wallet gives you the key but demands twelve words, XLM for gas and an install; lira in and out depends on the anchor. Kumbara gives you the key and removes the homework: a passkey signs, a relay pays the fees, a licensed anchor moves the lira, nothing to install.

## 5 · How it works

**TR.** Beş hamle: passkey OpenZeppelin akıllı hesabını açar, relay ücreti öder; işlem başına bin USDC limit zincire yazılır; anchor IBAN verir, lira USDC olur; köprü hesabı USDC'yi kumbaraya iletir ve kendini kapatır; bir onayla DeFindex kasasına girer, çekim aynı yolu tersten yürür. Bulgumuz: anchor'lar klasik hesaplara öder, akıllı hesaplar sözleşmedir, bu yüzden ödeme cüzdana ulaşamıyordu. Çözüm: sahipsiz, önceden yetkilendirilmiş köprü hesabı; sıra artı bir aktarım, sıra artı iki temizlik, başka hiçbir işlem imzalanamaz. On denemede on tam eşleşme, yükleme başına 900 stroop. Anchor ekibine raporlandı.

**EN.** Five moves: a passkey opens an OpenZeppelin smart account and the relay pays the fees; a thousand-USDC per-transaction limit is written on-chain; the anchor issues an IBAN and lira becomes USDC; a bridge account forwards the USDC to the kumbara and closes itself; one approval puts it in the DeFindex vault, and withdrawal runs backwards. Our finding: anchors pay classic accounts and smart accounts are contracts, so the payout could not reach the wallet. The fix: an ownerless, pre-authorized bridge account, forward at sequence plus one, cleanup at sequence plus two, nothing else can ever be signed. Ten exact matches in ten runs, 900 stroops per deposit. Reported to the anchor team.

## 6 · Where it works

**TR.** Aynı uygulama, sıradaki anchor. Yeni bir pazar bir anchor yapılandırması, bir çeviri dosyası ve bir kur çifti; kasa, cüzdan katmanı ve köprü hesapları değişmez. Tablodaki entegrasyon süreleri bizim tahminimiz değil, SCF entegrasyon listesinde ortakların yayımladığı süreler: Koywe widget bir günden az, API bir iki hafta; BlindPay ve Mercuryo bir iki hafta; Bridge bir beş gün. Türkiye bugün sandbox anchor'la çalışıyor; listede TRY anchor'ı yok, birinci dilimde git/gitme kararı bu. Arjantin ve Bolivya aynı listede güçlü aday.

**EN.** Same app, next anchor. A new market is one anchor config, one translation file and one rate pair; the vault, wallet layer and bridge accounts do not change. The integration times in the table are not our estimate but what the partners publish on the SCF Integration List: Koywe widget under a day, API one to two weeks; BlindPay and Mercuryo one to two weeks; Bridge one to five days. Türkiye runs on a sandbox anchor today; no TRY anchor is on the list, which is the Tranche 1 go/no-go. Argentina and Bolivia are strong candidates on the same list.

## 7 · Evidence

**TR.** Altı gerçek tarayıcı turu CI'da, her gönderimde ve altı saatte bir üretime karşı: açılış, yükleme, çekme, stant, istatistik, hata ekranları. Yirmi beş hata durumu, her biri tek eylemli TR/EN ekran. Lighthouse mobil: 94 ve üç kez 100. Üretim kayıtlarında 378 test ağı işlemi, her birinin karması var; 7 Eylül itibarıyla, tohum ve test hesapları dahil. Kasa kurulum, yatırma ve çekme karmaları ekranda. Canlı sayaç Rise In × Stellar Pro'da 19–20 Eylül'de dolacak; etkinlik sonrası bu kart gerçek eğriyle değişecek.

**EN.** Six real-browser round trips in CI, on every push and every six hours against production: onboarding, deposit, withdrawal, booth, stats, failure screens. Twenty-five failure states, each a one-action TR/EN screen. Lighthouse mobile: 94 and three hundreds. 378 testnet transactions in the production records, each with a hash, as of 7 September, seed and test accounts included. Vault deploy, invest and divest hashes are on the slide. The live counter fills at Rise In × Stellar Pro on 19–20 September; this card is swapped for the real curve after the event.

## 8 · Regulation

**TR.** Kumbara emanet almayan bir yazılım: lira, USDC ya da anahtar tutmaz. Lisanslı anchor düzenlemeye tabi taraf: fiat parayı tutar, KYC yapar, yalnızca kişinin kendi IBAN'ına öder. Ödeme özelliği yok: gönderme yok, P2P yok, işyeri akışı yok; 2021 kripto ile ödeme yasağı gözetilir. İşlem başına limit zincirde, MASAK limitleri anchor'da. Okumamız: emanet, alım satım ya da transfer hizmeti vermediğimiz ve kullanıcı kendi anahtarıyla imzaladığı için emanet almayan bir ön yüz Türkiye'nin kripto varlık hizmet sağlayıcısı tanımlarının dışında kalır; bunu anchor'ın uyum ekibiyle teyit edeceğiz. Ana ağ öncesi kapı: anchor'ın yazılı görüşü. Yedek: SCF listesindeki en üst pazar, aynı uygulama.

**EN.** Kumbara is non-custodial software: it never holds lira, USDC or keys. The licensed anchor is the regulated party: it holds the fiat, does KYC, pays only the person's own IBAN. No payments feature: no send, no P2P, no merchant flow; the 2021 ban on paying with crypto assets is respected. Per-transaction cap on-chain, MASAK limits at the anchor. Our reading: a non-custodial front end sits outside Türkiye's crypto-asset service provider definitions because we perform no custody, trading or transfer service and the user signs with their own key; we will confirm that with the anchor's compliance team. Gate before mainnet: the anchor's written position. Fallback: the top-ranked market on the SCF list, same app.

## 9 · Team

**TR.** Kurucu liderliğinde ve Stellar üzerinde üreten bir ekip. Üç kanıt: smart-account-kit'e 19 Ağustos'ta birleşen ve 0.6.2 ile yayımlanan düzeltme; npm'de passkey-react kütüphanesi, passkey oluşturma ve imzalama, kurtarma, harcama limiti arayüzü; Stellar Türkiye Instaward hibesi. Ödülle birlikte iki mühendis planlanıyor; hiçbir teslimat bir işe alıma bağlı değil. Bağlantılar ekranda.

**EN.** Founder-led and already shipping on Stellar. Three proof points: the fix merged into smart-account-kit on 19 August and shipped in 0.6.2; the passkey-react library on npm, passkey creation and signing, recovery, spending-limit UI; the Stellar Türkiye Instaward. Two engineers planned on award; no deliverable depends on a hire. Links on the slide.

## 10 · Roadmap · ask · metric

**TR.** Üç dilim, beş ay, entegrasyon önde. Birincisi altmış gün: seçilen anchor sandbox ya da API üzerinden mock yerine bağlanır (SEP-6/24/38), tek işlemle açılış, o anchor için sertleştirilmiş köprü hesabı adaptörü, Audit Bank kapsamı. İkincisi kırk beş gün: SDF şablonlarıyla tehdit modeli ve izleme planı, Audit Bank denetimi ve düzeltmeler, kapalı bayrak arkasında ana ağ. Üçüncüsü kırk beş gün: pilot pazarda ana ağ, elli ile yüz kullanıcılı pilot, otuz günlük NAV penceresi. Toplam 88.740 dolar: 32.300, 29.520, 26.920; el kitabındaki 10/20/30/40 bölüşümüyle. Ölçüt: açılıştan sonraki otuz günde ortalama günlük 2.500 USDC NAV; yüz kullanıcı, elli USDC, yüzde elli kalış; panel onaylar ya da düzeltir. Sembol Cloud v0 ve 0.4.0 sürümü Instaward üçüncü ayın işi; burada çakışan kalem yok.

**EN.** Three tranches, five months, integration first. Tranche 1, sixty days: the selected anchor wired in through its sandbox or API in place of the mock (SEP-6/24/38), single-transaction onboarding, the bridge-account adapter hardened for that anchor, the Audit Bank scope. Tranche 2, forty-five days: threat model and monitoring plan on SDF templates, the Audit Bank audit and remediation, mainnet behind a capped flag. Tranche 3, forty-five days: mainnet launch in the pilot market, a fifty-to-hundred user pilot, the thirty-day NAV window. Total $88,740: $32,300, $29,520, $26,920, paid on the handbook's 10/20/30/40 split. Metric: 2,500 USDC average daily NAV over the thirty days after launch, from a hundred users at fifty USDC with half retained; the panel ratifies or adjusts it. Sembol Cloud v0 and the 0.4.0 release are Instaward Month 3 work; nothing here overlaps.

## A · Appendix · hours

**TR.** Referans için satır satır saatler ve doğrulama yöntemleri: on yedi satır, toplam 972 saat. Gri satırlar QA ve kullanıcı testi desteği; isteğe bağlı gösterge panosu satırı işe alım gelmezse faturalanmaz. Her satırda gözden geçirenin neye bakacağı yazıyor.

**EN.** Line-by-line hours and verification for reference: seventeen lines, 972 hours in all. Grey rows are QA and user-testing support; the optional dashboards row is unbilled if no hire lands. Each row says what a reviewer looks at.
