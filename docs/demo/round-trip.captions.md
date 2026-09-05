# Fallback demo recording

Recorded 2026-09-05T23:05:19.537Z against https://kumbara.sembol.xyz (Stellar TESTNET) by `pnpm demo:record`: Playwright, Chrome, virtual passkey, 390×844. Duration 02:39 (160 s), 0.6 MB, no audio. The real backup video is the one recorded on a phone at the booth; this file is the fallback to that fallback.

| Time | What happens |
| --- | --- |
| 00:01 | Landing page on Stellar TESTNET: one button, no password, no app, no XLM. |
| 00:03 | Tap 'Kumbaranı aç': the passkey (Face ID) creates the key; the relay deploys the smart account. |
| 00:13 | Savings screen: the kumbara exists on-chain, TESTNET address with a stellar.expert link. |
| 00:27 | Spending limit (1,000 USDC per transaction) installed in the background; Deposit unlocks. |
| 00:29 | Deposit: 100 TRY, indicative USDC quote from the anchor. |
| 00:32 | IBAN screen: bank details and the reference TRMA-FZ8N-JFR3 the visitor puts in the transfer description. |
| 00:37 | Presenter plays the bank on /booth/admin (sandbox transfer); the app detects the lira. |
| 00:37 | Status: Transferin bekleniyor |
| 00:39 | Status: Liran alındı, USDC gönderiliyor |
| 00:51 | Status: Anchor USDC'yi gönderiyor |
| 00:57 | Status: USDC kumbarana taşınıyor |
| 01:09 | Status: Neredeyse bitti |
| 01:17 | Status: USDC kumbarana ulaştı; kasaya konuyor |
| 01:29 | Status: Tamam. USDC kasada. |
| 01:29 | USDC went anchor → bridge account → kumbara → DeFindex vault; three TESTNET transaction links. |
| 01:35 | Savings shows the vault balance and its lira equivalent (Reflector rate). |
| 01:41 | Withdraw: 1 USDC, sell quote in lira; the payout goes to the visitor's IBAN. |
| 01:44 | Status: Hazırlanıyor |
| 02:00 | Status: Kasadan çekiliyor ve gönderiliyor (iki Face ID onayı) |
| 02:16 | Status: USDC anchor'a gönderiliyor |
| 02:26 | Status: Anchor liraya çeviriyor |
| 02:34 | Status: Tamam. Lira IBAN'ına gönderildi. |
| 02:34 | Payout po_mh1q2bt1jopbxazo5kka: vault withdrawal, transfer through the reverse bridge account, anchor FAST payout (simulated). |
| 02:37 | Back on Savings: the remaining USDC stays in the vault. End of the round trip. |
