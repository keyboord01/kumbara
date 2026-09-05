# Speaker notes · Kumbara by Sembol

Read aloud; at most 60 words per slide. TR first, then EN. Everything shown is Stellar TESTNET.

## 1 · Title

**TR.** Merhaba, ben Ahmed. Kumbara, Türkiye için Face ID ile açılan, anahtarı yalnızca sende olan bir dolar kumbarası. Lira gönderirsin, USDC olarak birikir, istediğinde liraya geri çekersin. Bugün göstereceğim her şey Stellar test ağında; gerçek lira hareket etmiyor.

**EN.** Hi, I'm Ahmed. Kumbara is a self-custodial dollar piggy bank for Türkiye that opens with Face ID. You send lira, it is held as USDC, and you take lira back whenever you like. Everything you will see today runs on Stellar testnet; no real lira moves.

## 2 · Problem

**TR.** Ağustos'ta yıllık enflasyon yüzde 31,5. İnsanlar dolarda birikmek istiyor. Kripto yolu var ama önünde bir duvar: eklenti kur, on iki kelime yaz, gaz için XLM al, telefonu kaybetme. Her adımda kullanıcı kaybediyoruz; en çok ihtiyacı olan en az hizmet alıyor.

**EN.** Annual inflation was 31.5 percent in August. People want to save in dollars. The crypto route exists, but a wall stands in front of it: install an extension, write twelve words, buy XLM for gas, never lose the phone. Every step sheds users; the people who need it most are served least.

## 3 · Product

**TR.** Dört ekran. Tek tuş, Face ID, on saniyede hesap; tohum kelime yok, XLM yok, kurulum yok. Kumbaram ekranı kasadaki USDC'yi ve lira karşılığını gösterir. Yükleme, bildiğin havale ekranı: IBAN ve açıklama. Çekim, liraya satış kuru ve kendi IBAN'ına ödeme.

**EN.** Four screens. One button, Face ID, an account in about ten seconds; no seed phrase, no XLM, no install. Savings shows USDC in the vault and its lira value. Deposit is the bank-transfer screen everyone knows: IBAN and a reference. Withdraw is a sell quote and a payout to your own IBAN.

## 4 · How it works

**TR.** Yedi adım. Face ID ile bir OpenZeppelin akıllı hesabı açılır, ücreti relay öder. Harcama limiti zincire yazılır. Anchor IBAN verir, lira gelir, USDC'ye çevrilir ve köprü hesabına ödenir. Köprü USDC'yi kumbaraya iletir, kendini kapatır. Bir Face ID ile USDC DeFindex kasasına girer. Çekim aynı yolu tersten yürür.

**EN.** Seven steps. Face ID opens an OpenZeppelin smart account; the relay pays the fees. A spending limit is written on-chain. The anchor issues an IBAN, lira arrives, becomes USDC, and is paid to a bridge account. The bridge forwards it to the kumbara and closes itself. One Face ID puts the USDC in the DeFindex vault. Withdrawal runs backwards.

## 5 · The bridge

**TR.** Bulgumuz: anchor'lar klasik hesaplara öder, akıllı hesaplar ise sözleşme. Çözüm: sahipsiz, önceden yetkilendirilmiş köprü hesabı. Sıra artı bir aktarım, sıra artı iki temizlik; başka hiçbir işlem imzalanamaz. On denemede on tam tutar eşleşmesi, yükleme başına 900 stroop. Anchor ekibine raporladık.

**EN.** Our finding: anchors pay classic accounts, and smart accounts are contracts. Our fix: an ownerless, pre-authorized bridge account. Forward at sequence plus one, cleanup at sequence plus two; no key can sign anything else. Ten exact amount matches in ten runs, 900 stroops per deposit. Reported to the anchor team.

## 6 · Integrations and contracts

**TR.** Kumbara kendi cüzdan, kasa veya strateji kodu yazmaz. OpenZeppelin akıllı hesap ve harcama limiti, DeFindex kasası ve hodl stratejisi, SEP tabanlı anchor, ücret sponsoru relay, Reflector kuru. Soroswap değerlendirildi, bağlanmadı. Passkey imzası için gereken düzeltme smart-account-kit'e üst akımda birleşti.

**EN.** Kumbara writes no wallet, vault or strategy code. OpenZeppelin smart account and spending limit, DeFindex vault and hodl strategy, the SEP-based anchor, a fee-sponsoring relay, Reflector for the rate. Soroswap evaluated, not wired. The fix passkey signing needed was merged upstream into smart-account-kit.

## 7 · Traction and evidence

**TR.** Her şey herkese açık ve tekrar çalıştırılabilir. Altı gerçek tarayıcı turu CI'da, her gönderimde ve altı saatte bir üretime karşı. Yirmi beş hata durumu, her biri bir ekran. Lighthouse 94 ve üç kez 100. Kasa kurulumu, yatırma ve çekme işlem karmaları test ağında. Etkinlik sayıları 20 Eylül'den sonra gelecek.

**EN.** Everything here is public and re-runnable. Six real-browser round trips in CI, on every push and every six hours against production. Twenty-five failure states, each a screen. Lighthouse 94 and three hundreds. Vault deploy, invest and divest hashes on testnet. The event numbers arrive after 20 September.

## 8 · Regulatory positioning

**TR.** Kumbara emanet almayan bir yazılım: lira, USDC ya da anahtar tutmaz. Lisanslı anchor düzenlemeye tabi taraf; parayı o tutar, KYC'yi o yapar, kişinin kendi IBAN'ına öder. Türkiye'de ödeme özelliği yok. MASAK kuralları arayüzü şekillendirir. Türkiye hukuki görüşü birinci dilimde bütçelendi.

**EN.** Kumbara is non-custodial software: it never holds lira, USDC or keys. The licensed anchor is the regulated party; it holds the fiat, does KYC, and pays out to the person's own IBAN. No payments feature in Türkiye. MASAK rules shape the interface. A Turkish legal opinion is budgeted in Tranche one.

## 9 · Team

**TR.** Ekip küçük ve üretiyor. Ben Instaward hibesi aldım, passkey-react kütüphanesinin yazarıyım, smart-account-kit'e katkı verdim. Ibo mühendis; aynı altyapı üzerinde ikinci kiracıyı yapıyor. Atahan, katılımı kesinleşirse, sunum ve stant tarafında.

**EN.** The team is small and shipping. I hold an Instaward grant, wrote the passkey-react library, and contributed to smart-account-kit. Ibo is our engineer, building the second tenant on the same infrastructure. Atahan, if confirmed, covers the deck and the booth.

## 10 · Roadmap and the ask

**TR.** Dört dilim, her biri en çok doksan gün. Hukuki görüş ve anchor anlaşması; ana ağ denetimi; lisanslı anchor ile açık pilot ve zincir üstü metrik olarak kasadaki NAV; yerel mobil SDK. Genişleme filtresi: yüksek enflasyon ve lisanslı bir Stellar anchor'ı. Entegrasyon parkurunda tam bu için başvuruyoruz.

**EN.** Four tranches, ninety days each at most. Legal opinion and the anchor agreement; the mainnet audit; a public pilot with the licensed anchor, with vault NAV as the on-chain metric; a native mobile SDK. The expansion filter: high inflation plus a licensed Stellar anchor. We are applying on the Integration Track for exactly this.
