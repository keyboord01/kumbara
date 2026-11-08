# Recovery drill: a backup passkey restores access

SOW 1, Deliverable 1. The claim: if the phone that holds a kumbara's passkey is lost, a **backup passkey** enrolled earlier opens the same kumbara on another device, with nobody's help and no seed phrase.

## How recovery works

1. On the Security page (`/kumbara/guvenlik`), "Recovery passkey" creates a second passkey, on another device or in a password manager. One approval with the current passkey adds it to the kumbara's signers **on chain**.
2. The browser reports the new passkey to the registry (`POST /api/registry`). The registry stores it only after reading the kumbara's signers from the chain and finding that passkey among them (SECURITY.md, KB-02).
3. On a new device, "I can't find my passkey" opens `/kurtar` → **Find my kumbara**. The device's passkey prompt picks the backup passkey. The address cannot be derived from a backup passkey, so the app asks the registry, which answers with the kumbara. The kumbara opens.
4. From then on the backup passkey signs like the original: transactions on chain, and the few off-chain changes (renaming a kumbara, cancelling a deposit) through a signed challenge (KB-06).

## Part 1: automated drill (done)

`pnpm drill:recovery` (`scripts/drill-recovery.mjs`) runs the whole path on live testnet in Chrome, with a virtual passkey authenticator:

- **Device A** creates a kumbara, then enrols a recovery passkey on the Security page. Pass condition: the registry answers `201 { kind: "backup", verified: true }` for this kumbara.
- **Device B** is a fresh browser profile holding **only** the backup passkey. It opens `/kurtar` and taps Find my kumbara. Pass condition: it lands on the same kumbara address.
- **Device B** renames the kumbara. Pass condition: the server accepts a signature from the backup passkey.

Results of the latest run are in [`docs/evidence/sow1/d1/recovery-drill.json`](../evidence/sow1/d1/recovery-drill.json), with screenshots and a screen recording of device B (`recovery-with-backup-passkey.webm`) in the same folder.

**What this proves, and what it does not.** It proves the software path end to end on testnet: enrolment, the on-chain signer, the registry's chain check, recovery from a browser that never saw the original passkey, and signing with the backup. It does **not** prove that real platform authenticators (iCloud Keychain, Google Password Manager, Windows Hello, a hardware key) behave the same way. That is Part 2.

## Part 2: three real device/browser pairs (to be run by the builder)

Run this on three pairs. Suggested set: one Apple, one Android, one desktop, with the backup on a *different* ecosystem from the primary each time.

| # | Primary passkey on | Backup passkey on | Recovered on (fresh browser, primary absent) | Result | Time to reopen | Recording |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | iPhone, Safari (iCloud Keychain) | Android phone, Chrome (Google Password Manager), via the QR / hybrid prompt | Android phone, Chrome | ☐ pending | | |
| 2 | Android phone, Chrome | Hardware security key (YubiKey) or 1Password | Laptop, Chrome or Firefox | ☐ pending | | |
| 3 | Laptop, Chrome on macOS or Windows (platform passkey) | iPhone, Safari (iCloud Keychain) | iPhone, Safari, private browsing off | ☐ pending | | |

### Steps for each row

1. Open `https://kumbara.sembol.xyz` on the **primary** device and tap **Get started**. Approve the passkey. Write down the kumbara address (Savings → Kumbara address → Copy).
2. Optional: tap **Get 10 test USDC**, so the recovered kumbara visibly holds money.
3. Go to **Security → Recovery passkey → Create recovery passkey**. When the prompt opens, choose the **backup** device or authenticator (on phones: "use another device" / QR code). Approve with the current passkey when asked. Expect "✓ Recovery credential added."
4. Check the chain: **Proof** (`/kumbara/kanit`) lists two passkey signers. Save a screenshot.
5. On the **recovery** device, in a browser profile that has never opened Kumbara, open `https://kumbara.sembol.xyz/kurtar` and tap **Find my kumbara**. In the passkey prompt, pick the **backup** passkey.
6. Expect the Savings screen with the **same address** as in step 1. Note the time from the tap to the Savings screen.
7. Rename the kumbara (Name and goal → Edit → Save) to confirm the backup passkey can sign.
8. Fill in the row above. Record the screen for at least one row (steps 5–7), and attach the recording to the evidence.

If a step fails, note the screen's title and open **Details** to copy the code. Then use **Report a problem** on that screen (one tap). The report then shows up on `/booth/admin/monitor`.

### Known limits to watch for

- **Same-ecosystem sync is not a backup.** A passkey synced through iCloud Keychain to a Mac is the same credential, so it is not a second signer. The drill needs a *different* credential.
- **A brand-new device may need the address.** If the registry is unreachable, the recovery screen falls back to asking for the kumbara address (step 1 note). This is why the Security page shows "save your wallet address".
- **Private browsing on iPhone blocks passkeys**, and the app shows "This browser cannot use passkeys." Use a normal tab.
