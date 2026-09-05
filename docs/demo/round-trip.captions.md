# Fallback demo recording

Recorded 2026-09-05T22:12:52.763Z against https://kumbara.vercel.app (Stellar TESTNET) by `pnpm demo:record`: Playwright, Chrome, virtual passkey, 390×844. Duration 02:31 (152 s), 0.6 MB, no audio. The real backup video is the one recorded on a phone at the booth; this file is the fallback to that fallback.

| Time | What happens |
| --- | --- |
| 00:02 | Landing page on Stellar TESTNET: one button, no password, no app, no XLM. |
| 00:05 | Tap 'Kumbaranı aç': the passkey (Face ID) creates the key; the relay deploys the smart account. |
| 00:19 | Savings screen: the kumbara exists on-chain, TESTNET address with a stellar.expert link. |
| 00:33 | Spending limit (1,000 USDC per transaction) installed in the background; Deposit unlocks. |
| 00:36 | Deposit: 100 TRY, indicative USDC quote from the anchor. |
| 00:38 | IBAN screen: bank details and the reference TRMA-EEBS-NYSG the visitor puts in the transfer description. |
| 00:43 | Presenter plays the bank on /booth/admin (sandbox transfer); the app detects the lira. |
| 00:43 | Status: Transferin bekleniyor |
| 00:45 | Status: Liran alındı, USDC gönderiliyor |
| 00:55 | Status: Anchor USDC'yi gönderiyor |
| 01:01 | Status: USDC kumbarana taşınıyor |
| 01:09 | Status: Neredeyse bitti |
| 01:17 | Status: USDC kumbarana ulaştı; kasaya konuyor |
| 01:29 | Status: Tamam. USDC kasada. |
| 01:29 | USDC went anchor → bridge account → kumbara → DeFindex vault; three TESTNET transaction links. |
| 01:35 | Savings shows the vault balance and its lira equivalent (Reflector rate). |
| 01:39 | Withdraw: 1 USDC, sell quote in lira; the payout goes to the visitor's IBAN. |
| 01:42 | Status: Hazırlanıyor |
| 01:54 | Status: Kasadan çekiliyor ve gönderiliyor (iki Face ID onayı) |
| 02:06 | Status: USDC anchor'a gönderiliyor |
| 02:16 | Status: Anchor liraya çeviriyor |
| 02:26 | Status: Tamam. Lira IBAN'ına gönderildi. |
| 02:26 | Payout po_pjdusulc7d1jc3yimw9a: vault withdrawal, transfer through the reverse bridge account, anchor FAST payout (simulated). |
| 02:29 | Back on Savings: the remaining USDC stays in the vault. End of the round trip. |
