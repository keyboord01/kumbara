# Speaker notes · Kumbara by Sembol

Read aloud; at most 60 words per slide. TR first, then EN. Everything shown is Stellar TESTNET.

Two variants share these notes. **SCF** (`kumbara-deck-scf.pdf`): slides 1 to 10 in order. **Hackathon** (`kumbara-deck-hackathon.pdf`): slides 1, 2, 3, then **3b · Try it now**, then 4 to 10, then **A · Appendix** (the sequence diagram, which in the SCF deck sits on slide 4).

## 1 · Title

**TR.** Merhaba, ben Ahmed. Kumbara, Türkiye için Face ID ile açılan, anahtarı yalnızca sende olan bir dolar kumbarası. Lira gönderirsin, USDC olarak birikir, istediğinde liraya geri çekersin. Bugün göstereceğim her şey Stellar test ağında; gerçek lira hareket etmiyor.

**EN.** Hi, I'm Ahmed. Kumbara is a self-custodial dollar piggy bank for Türkiye that opens with Face ID. You send lira, it is held as USDC, and you take lira back whenever you like. Everything you will see today runs on Stellar testnet; no real lira moves.

## 2 · Problem

**TR.** TÜİK'e göre Ağustos'ta yıllık enflasyon yüzde 31,5. İnsanlar dolarda birikmek istiyor. Kripto yolu var ama önünde bir duvar: eklenti kur, on iki kelime yaz, gaz için XLM al, telefonu kaybetme. Her adımda kullanıcı kaybediyoruz; en çok ihtiyacı olan en az hizmet alıyor.

**EN.** Per TÜİK, annual inflation was 31.5 percent in August. People want to save in dollars. The crypto route exists, but a wall stands in front of it: install an extension, write twelve words, buy XLM for gas, never lose the phone. Every step sheds users; the people who need it most are served least.

## 3 · Product

**TR.** Dört ekran. Tek tuş, Face ID, on saniyede hesap; tohum kelime yok, XLM yok, kurulum yok. Kumbaram ekranı kasadaki USDC'yi ve lira karşılığını gösterir. Yükleme, bildiğin havale ekranı: IBAN ve açıklama. Çekim, liraya satış kuru ve kendi IBAN'ına ödeme.

**EN.** Four screens. One button, Face ID, an account in about ten seconds; no seed phrase, no XLM, no install. Savings shows USDC in the vault and its lira value. Deposit is the bank-transfer screen everyone knows: IBAN and a reference. Withdraw is a sell quote and a payout to your own IBAN.

## 3b · Try it now (hackathon variant)

**TR.** Şimdi deneyin: kodu okutun, Kumbaranı aç'a dokunun, Face ID. Hesabınız açıldı. Yükle deyin, yüz yazın; bankayı ben oynatıyorum, bir dakikaya USDC kasada. Çek deyin, lira IBAN'a döner. Kurulum yok, kelime yok, XLM yok. Test ağı, gerçek para değil. Sayaç arkamda.

**EN.** Try it now: scan, tap Kumbaranı aç, Face ID. Your account exists. Tap Yükle, enter one hundred; I play the bank, and in about a minute the USDC is in the vault. Tap Çek and the lira comes back to the IBAN. No install, no words, no XLM. Testnet, not real money. The counter is behind me.

## 4 · How it works

**TR.** Yedi adım. Face ID ile bir OpenZeppelin akıllı hesabı açılır, ücreti relay öder. Harcama limiti zincire yazılır. Anchor IBAN verir, lira gelir, USDC'ye çevrilir ve köprü hesabına ödenir. Köprü USDC'yi kumbaraya iletir, kendini kapatır. Bir Face ID ile USDC DeFindex kasasına girer. Çekim aynı yolu tersten yürür.

**EN.** Seven steps. Face ID opens an OpenZeppelin smart account; the relay pays the fees. A spending limit is written on-chain. The anchor issues an IBAN, lira arrives, becomes USDC, and is paid to a bridge account. The bridge forwards it to the kumbara and closes itself. One Face ID puts the USDC in the DeFindex vault. Withdrawal runs backwards.

## 5 · The bridge

**TR.** Bulgumuz: anchor'lar klasik hesaplara öder, akıllı hesaplar ise sözleşme. Çözüm: sahipsiz, önceden yetkilendirilmiş köprü hesabı. Sıra artı bir aktarım, sıra artı iki temizlik; başka hiçbir işlem imzalanamaz. On denemede on tam tutar eşleşmesi, yükleme başına 900 stroop. Anchor ekibine raporladık.

**EN.** Our finding: anchors pay classic accounts, and smart accounts are contracts. Our fix: an ownerless, pre-authorized bridge account. Forward at sequence plus one, cleanup at sequence plus two; no key can sign anything else. Ten exact amount matches in ten runs, 900 stroops per deposit. Reported to the anchor team.

## 6 · Integrations and contracts

**TR.** Kumbara kendi cüzdan, kasa veya strateji kodu yazmaz: OpenZeppelin akıllı hesap ve limit, DeFindex kasası ve stratejisi, SEP tabanlı anchor, ücret sponsoru relay, Reflector kuru. Depo MIT lisanslı, sözleşmelerin hepsi denetlenmiş üst akım kod. Cüzdan açılışı düzeltmemiz smart-account-kit'e birleşti, 0.6.2 ile yayınlandı.

**EN.** Kumbara writes no wallet, vault or strategy code: OpenZeppelin smart account and limit, DeFindex vault and strategy, the SEP-based anchor, a fee-sponsoring relay, Reflector for the rate. The repo is MIT, every contract is audited upstream code. Our wallet-creation fix was merged into smart-account-kit and shipped in 0.6.2.

## 7 · Traction and evidence

**TR.** Her şey herkese açık ve tekrar çalıştırılabilir. Altı gerçek tarayıcı turu CI'da, her gönderimde ve altı saatte bir üretime karşı. Yirmi beş hata durumu, her biri bir ekran. Lighthouse 94 ve üç kez 100. Kasa kurulumu, yatırma ve çekme işlem karmaları test ağında. Etkinlik sayıları 20 Eylül'den sonra.

**EN.** Everything here is public and re-runnable. Six real-browser round trips in CI, on every push and every six hours against production. Twenty-five failure states, each a screen. Lighthouse 94 and three hundreds. Vault deploy, invest and divest hashes on testnet. The event numbers come after 20 September.

## 8 · Regulatory positioning

**TR.** Kumbara emanet almayan bir yazılım: lira, USDC ya da anahtar tutmaz. Lisanslı anchor düzenlemeye tabi taraf; parayı o tutar, KYC'yi o yapar, kişinin kendi IBAN'ına öder. Türkiye'de ödeme özelliği yok. MASAK kuralları arayüzü şekillendirir. Türkiye hukuki görüşü kendi bütçemizden; ana ağ onu bekler.

**EN.** Kumbara is non-custodial software: it never holds lira, USDC or keys. The licensed anchor is the regulated party; it holds the fiat, does KYC, and pays out to the person's own IBAN. No payments feature in Türkiye. MASAK rules shape the interface. The Turkish legal opinion is self-funded; mainnet waits for it.

## 9 · Team

**TR.** Tek kişilik bir ekip, ama üreten bir ekip. Instaward hibesi aldım, passkey-react kütüphanesini yazdım ve smart-account-kit'e birleşen bir düzeltme gönderdim. Kumbara'yı uçtan uca ben kurdum: uygulama, köprü hesapları, CI turları. Bağlantılar ekranda.

**EN.** A team of one, but one that ships. I hold an Instaward grant, wrote the passkey-react library, and landed a fix in smart-account-kit. I built Kumbara end to end: the app, the bridge accounts, the CI round trips. Links are on the slide.

## 10 · Roadmap and the ask

**TR.** Üç dilim, toplam altı ay. Birincisi zemin: SEP'e hazır anchor seçimi, Audit Bank başvurusu, relay bütçeleri, dağıtım belgeleri. İkincisi test ağı tam ve güvenli: STRIDE tehdit modeli, izleme planı, denetim ve düzeltmeler. Üçüncüsü ana ağ ve açık pilot; ölçüt kasadaki NAV, otuz gün. Her satırın maliyeti ve doğrulaması ekranda.

**EN.** Three tranches, six months in total. First, groundwork: a SEP-ready anchor chosen, the Audit Bank application, relay budgets, deployment docs. Second, testnet-complete and secured: STRIDE threat model, monitoring plan, audit and fixes. Third, mainnet launch and public pilot; the metric is vault NAV over thirty days. Every line has a cost and a way to verify it.

## A · Appendix · sequence diagram (hackathon variant)

**TR.** Referans için tam sıra diyagramı: passkey'den ödemeye kadar her mesaj. Kumbara ile relay arasındaki her ok imzalı bir yetki; anchor'a giden her ok klasik bir ödeme; kasaya giden tek ok kullanıcının Face ID'si. Sorusu olan için sunum sonunda buradayım.

**EN.** The full sequence diagram for reference: every message from the passkey to the payout. Each arrow between Kumbara and the relay is a signed authorization; each arrow to the anchor is a classic payment; the single arrow into the vault is the user's Face ID. I'm here after the session for questions.
