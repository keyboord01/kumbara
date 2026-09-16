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

**TR.** Paranızı kim tutuyor? Bankada banka, borsada borsa. Tohum kelimeli cüzdanda ve Kumbara'da siz. Fark ödevde: cüzdan on iki kelime, gaz için XLM ve kurulum ister; lira giriş çıkışı cüzdanın anchor desteğine bağlıdır. Kumbara'da passkey imzalar, relay ücreti öder, lisanslı anchor lirayı taşır; kurulacak bir şey yok.

**EN.** Who holds your money? At the bank, the bank; at the exchange, the exchange. With a seed-phrase wallet and with Kumbara, you. The difference is the homework: a wallet demands twelve words, XLM for gas and an install, and lira in and out depends on its anchor support. With Kumbara a passkey signs, a relay pays the fees, a licensed anchor moves the lira; nothing to install.

## 5 · How it works

**TR.** Beş hamle: passkey akıllı hesabı açar, relay ücreti öder; ilk çekimde limit zincire yazılır; anchor IBAN verir; geçici hesap USDC'yi iletir; bir onayla kasa. Köprü: anchor yalnızca normal bir Stellar hesabına ödeyebilir, akıllı hesaba değil. Bu yüzden para gelmeden önce yalnızca iki işlemi imzalanmış geçici bir hesap yaratırız: USDC'yi kumbarana ilet, sonra kendini kapat. Biz dahil kimse yönünü değiştiremez. Emanet yok, bize güven gerekmiyor. Üç karma ekranda; on denemede on tam eşleşme.

**EN.** Five moves: a passkey opens the smart account and the relay pays the fees; the limit is written on-chain at the first withdrawal; the anchor issues an IBAN; a temporary account forwards the USDC; one approval into the vault. The bridge: the anchor can only pay a normal Stellar account, not a smart account. So we create a temporary account whose only two possible transactions are signed before any money arrives: forward the USDC to your kumbara, then close itself. Nobody, including us, can ever redirect it. No custody, no trust in us. Three hashes on the slide; ten exact matches in ten runs.

## 6 · Where it works

**TR.** Aynı uygulama, sıradaki anchor. Türkiye bugün sandbox anchor'la çalışıyor; listede TRY anchor'ı yok. Arjantin ve Bolivya Koywe ile listede; Koywe'nin yayımladığı entegrasyon süresi API için bir iki hafta. Ana ağdan önce anchor'ı seçeriz: lisanslı, kendi banka hesabına ödeyen, emanet almayan bir uygulamanın entegre olabileceğini yazılı teyit eden. TRY anchor'ı uyarsa Türkiye; yoksa Koywe ile Arjantin. İki durumda da aynı uygulama; yeni pazar bir anchor yapılandırması ve bir çeviridir.

**EN.** Same app, next anchor. Türkiye runs on a sandbox anchor today; no TRY anchor is on the list. Argentina and Bolivia are on the list through Koywe, whose published integration time is one to two weeks for the API. Before mainnet we pick the anchor: licensed, pays your own bank account, confirms in writing that a non-custodial app can integrate. Türkiye if a TRY anchor qualifies; otherwise Argentina on Koywe. Same app either way; a new market is one anchor config and one translation.

## 7 · Evidence

**TR.** Kullanıcılar ve işlemler, hepsi zincirde. Bugün itibarıyla üç kumbara açıldı, iki yükleme tamamlandı, çekim yok, kasada 208 USDC; tohum ve test hesapları sayılmadı, kasa toplamı tüm hesapları kapsar. Her sayının bağlantısı ekranda: istatistik sayfası ve stellar.expert'te kasa sözleşmesi. Rise In × Stellar Pro'da 19–20 Eylül'de bunlar stant sayıları olacak. CI turları, hata ekranları ve Lighthouse notlar için: altı tur, yirmi beş ekran, 94 ve üç kez 100.

**EN.** Users and transactions, all on chain. As of today: three kumbaras opened, two deposits completed, no withdrawals, 208 USDC in the vault; seed and test accounts excluded, the vault total covers every account. Every number links: the stats page and the vault contract on stellar.expert. At Rise In × Stellar Pro on 19–20 September these become the booth numbers. For the record, off the slide: six CI round trips, twenty-five failure screens, Lighthouse 94 and three hundreds.

## 8 · Regulation

**TR.** Emanet almayan yazılım; düzenlemeye tabi taraf anchor. Lira, USDC ya da anahtar tutmayız. Anchor fiat parayı tutar ve KYC yapar; biz anchor'ın KYC'si üzerine kurarız, kendimiz KYC yürütmeyiz. Gönderme yok, P2P yok, işyeri akışı yok. İşlem başına limit zincirde, ek limitler anchor tarafında. Ana ağdan önce anchor, emanet almayan bir uygulamaya hizmet verebileceğini yazılı olarak teyit eder. Teyit yoksa açılış yok.

**EN.** Non-custodial software; the anchor is the regulated party. We never hold lira, USDC or keys. The anchor holds fiat and does KYC; we build on the anchor's KYC and run none ourselves. No send, no P2P, no merchant flow. Per-transaction cap on-chain, anchor-side limits. Before mainnet the anchor confirms in writing it can serve a non-custodial app. No confirmation, no launch.

## 9 · Team

**TR.** Üç mühendis, hepsi Stellar üzerinde üretiyor. Ahmed Murshed, kurucu ve baş mühendis: Synchronicity'de full-stack, özel bir perpetuals DEX'inin işlem istemcisi, Go/Rust yürütme işleri; passkey-react'in yazarı, smart-account-kit katkıcısı, Instaward hibesi; YTÜ Blockchain Kulübü eski geliştirme lideri. Kutay Sarı: Bundle'da React/TypeScript geliştirici, eski Akbank mikro ön yüzleri, Chainify kurucu ortağı, YTÜ Blockchain. Ben Luelo: beş yıllık yazılım mühendisi, Union Labs kurucu ortağı.

**EN.** Three engineers, all shipping on Stellar. Ahmed Murshed, founder and lead engineer: full-stack at Synchronicity, trading client of a private perpetuals DEX with Go/Rust execution work; author of passkey-react, contributor to smart-account-kit, Instaward grantee; ex development lead of the YTU Blockchain Club. Kutay Sarı: software developer at Bundle in React and TypeScript, ex Akbank micro-frontends, co-founder of Chainify, YTÜ Blockchain. Ben Luelo: software engineer for five years, co-founder of Union Labs.

## 10 · Roadmap · ask · metric

**TR.** Üç dilim, beş ay, entegrasyon önde. Birincisi altmış gün: seçilen anchor sandbox ya da API üzerinden bağlanır (SEP-6/24/38), tek işlemle açılış, o anchor için sertleştirilmiş köprü adaptörü, Audit Bank kapsamı. İkincisi kırk beş gün, denetlenmiş ve izlenen: akıllı hesap ve köprü kodunun Audit Bank üzerinden güvenlik incelemesi, tehdit modeli ve her sözleşme ile hesapta 7/24 uyarılar, kapalı bayrak arkasında ana ağ. Üçüncüsü kırk beş gün: pilot pazarda ana ağ, elli ile yüz kullanıcı, otuz günlük NAV penceresi. Toplam 96.840 dolar: 38.760, 29.260, 28.820; 10/20/30/40 bölüşümü. Ölçüt: otuz günde ortalama günlük 2.500 USDC NAV. Sembol Cloud v0 ve 0.4.0 Instaward üçüncü ayın işi; çakışma yok.

**EN.** Three tranches, five months, integration first. Tranche 1, sixty days: the selected anchor wired in through its sandbox or API (SEP-6/24/38), single-transaction onboarding, the bridge adapter hardened for that anchor, the Audit Bank scope. Tranche 2, forty-five days, audited and monitored: security review of the smart-account and bridge code via Audit Bank, a threat model and 24/7 alerts on every contract and account, mainnet behind a capped flag. Tranche 3, forty-five days: mainnet launch in the pilot market, fifty to a hundred users, the thirty-day NAV window. Total $96,840: $38,760, $29,260, $28,820, on the 10/20/30/40 split. Metric: 2,500 USDC average daily NAV over thirty days. Sembol Cloud v0 and 0.4.0 are Instaward Month 3 work; nothing overlaps.

