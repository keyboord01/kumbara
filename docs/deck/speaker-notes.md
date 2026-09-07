# Speaker notes · Kumbara by Sembol

Read aloud; at most 60 words per slide. TR first, then EN. Everything shown is Stellar TESTNET.

Two variants share these notes. **SCF** (`kumbara-deck-scf.pdf`, 12 slides): slides 1 to 9, then **10 · Roadmap**, **11 · Budget and metric**, and **B · Appendix · hours**. **Hackathon** (`kumbara-deck-hackathon.pdf`, 8 slides, judges only, no SCF material): slides 1, 2, 3, then **3b · Try it now**, then 4, 5, 6, 7.

## 1 · Title

**TR.** Merhaba, ben Ahmed: Instaward hibesi aldım, passkey-react kütüphanesini yazdım, smart-account-kit'e katkı verdim. Kumbara, Türkiye için Face ID ile açılan, anahtarı yalnızca sende olan bir dolar kumbarası. Lira gönderirsin, USDC olarak birikir, istediğinde liraya geri çekersin. Bugün göstereceğim her şey Stellar test ağında; gerçek lira hareket etmiyor.

**EN.** Hi, I'm Ahmed: Instaward grantee, author of passkey-react, contributor to smart-account-kit. Kumbara is a self-custodial dollar piggy bank for Türkiye that opens with Face ID. You send lira, it is held as USDC, and you take lira back whenever you like. Everything you will see today runs on Stellar testnet; no real lira moves.

## 2 · Problem

**TR.** TÜİK'e göre Ağustos'ta yıllık enflasyon yüzde 31,5. İnsanlar dolarda birikmek istiyor ama kripto yolunun önünde bir duvar var: eklenti, on iki kelime, gaz için XLM. Her adımda kullanıcı kaybediyoruz. Türkiye ilk pazar; ürün, banka havalesi alışkanlığı ve Stellar anchor'ı olan tüm yüksek enflasyonlu ekonomiler için yapıldı.

**EN.** Per TÜİK, annual inflation was 31.5 percent in August. People want to save in dollars, but a wall stands in front of the crypto route: an extension, twelve words, XLM for gas. Every step sheds users. Türkiye is market one; the product is built for every high-inflation economy with a bank-transfer habit and a Stellar anchor.

## 3 · Product

**TR.** Dört ekran. Tek tuş, Face ID ya da Touch ID, on saniyede hesap; tohum kelime yok, XLM yok, kurulum yok. Kumbaram ekranı kasadaki USDC'yi ve lira karşılığını gösterir. Yükleme, bildiğin havale ekranı: IBAN ve açıklama. Çekim, liraya satış kuru ve kendi IBAN'ına ödeme.

**EN.** Four screens. One button, Face ID or Touch ID, an account in about ten seconds; no seed phrase, no XLM, no install. Savings shows USDC in the vault and its lira value. Deposit is the bank-transfer screen everyone knows: IBAN and a reference. Withdraw is a sell quote and a payout to your own IBAN.

## 3b · Try it now (hackathon variant)

**TR.** Şimdi deneyin: kodu okutun, Kumbaranı aç'a dokunun, Face ID ya da Touch ID. Hesabınız açıldı. Yükle deyin, yüz yazın; bankayı ben oynatıyorum, bir dakikaya USDC kasada. Çek deyin, lira IBAN'a döner. Kurulum yok, kelime yok, XLM yok. Test ağı, gerçek para değil. Sayaç arkamda.

**EN.** Try it now: scan, tap Kumbaranı aç, Face ID or Touch ID. Your account exists. Tap Yükle, enter one hundred; I play the bank, and in about a minute the USDC is in the vault. Tap Çek and the lira comes back to the IBAN. No install, no words, no XLM. Testnet, not real money. The counter is behind me.

## 4 · How it works

**TR.** Yedi adım. Passkey ile bir OpenZeppelin akıllı hesabı açılır, ücreti relay öder. Harcama limiti zincire yazılır. Anchor IBAN verir, lira gelir, USDC'ye çevrilir ve köprü hesabına ödenir. Köprü USDC'yi kumbaraya iletir, kendini kapatır. Bir Face ID ile USDC DeFindex kasasına girer. Çekim aynı yolu tersten yürür.

**EN.** Seven steps. A passkey opens an OpenZeppelin smart account; the relay pays the fees. A spending limit is written on-chain. The anchor issues an IBAN, lira arrives, becomes USDC, and is paid to a bridge account. The bridge forwards it to the kumbara and closes itself. One Face ID puts the USDC in the DeFindex vault. Withdrawal runs backwards.

## 5 · The bridge

**TR.** Bulgumuz: anchor'lar klasik hesaplara öder, akıllı hesaplar ise sözleşme. Çözüm: sahipsiz, önceden yetkilendirilmiş köprü hesabı. Sıra artı bir aktarım, sıra artı iki temizlik; başka hiçbir işlem imzalanamaz. On denemede on tam tutar eşleşmesi, yükleme başına 900 stroop. Anchor ekibine raporladık.

**EN.** Our finding: anchors pay classic accounts, and smart accounts are contracts. Our fix: an ownerless, pre-authorized bridge account. Forward at sequence plus one, cleanup at sequence plus two; no key can sign anything else. Ten exact amount matches in ten runs, 900 stroops per deposit. Reported to the anchor team.

## 6 · Integrations and contracts

**TR.** Kumbara kendi cüzdan, kasa veya strateji kodu yazmaz: OpenZeppelin akıllı hesap ve limit, DeFindex kasası ve stratejisi, SEP tabanlı anchor, ücret sponsoru relay, Reflector kuru. Depo MIT lisanslı, sözleşmelerin hepsi denetlenmiş üst akım kod. Cüzdan açılışı düzeltmemiz smart-account-kit'e birleşti, 0.6.2 ile yayınlandı.

**EN.** Kumbara writes no wallet, vault or strategy code: OpenZeppelin smart account and limit, DeFindex vault and strategy, the SEP-based anchor, a fee-sponsoring relay, Reflector for the rate. The repo is MIT, every contract is audited upstream code. Our wallet-creation fix was merged into smart-account-kit and shipped in 0.6.2.

## 7 · Traction and evidence

**TR.** Her şey herkese açık ve tekrar çalıştırılabilir: altı gerçek tarayıcı turu CI'da, yirmi beş hata ekranı, Lighthouse 94 ve üç kez 100, kasa kurulum, yatırma ve çekme karmaları test ağında. Sırada: Sembol Cloud v0 ana ağda, Instaward üçüncü ay; anchor ortaklık görüşmeleri sürüyor; etkinlikten sonra SCF Integration Track başvurusu.

**EN.** Everything here is public and re-runnable: six real-browser round trips in CI, twenty-five failure screens, Lighthouse 94 and three hundreds, the vault deploy, invest and divest hashes on testnet. Next: Sembol Cloud v0 on mainnet in Instaward Month 3, anchor partnership conversations underway, and the SCF Integration Track after the event.

## 8 · Regulatory positioning

**TR.** Kumbara emanet almayan bir yazılım: lira, USDC ya da anahtar tutmaz; lisanslı anchor düzenlemeye tabi taraf. Anchor bir yapılandırma seçimi: stellar.toml, SEP rayları, anchor'dan bağımsız köprü hesapları. Türkiye uyumdan ötürü ilk pazar; birinci dilim SCF listesindeki anchor'ları sıralar. Türkiye geçemezse pilot en üstteki pazarda açılır. İkinci pazar, ölçüt tutunca sonraki ödülün işi.

**EN.** Kumbara is non-custodial software: it never holds lira, USDC or keys; the licensed anchor is the regulated party. The anchor is a config choice: stellar.toml, SEP rails, anchor-agnostic bridge accounts. Türkiye is market one by fit; Tranche 1 ranks the anchors on the SCF list. If Türkiye fails, the pilot launches in the top-ranked market; market two is the follow-on.

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
