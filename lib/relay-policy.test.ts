import { Address, Keypair, StrKey, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { accountWasmHashes, judgeHostFunction } = await import("./relay-policy.server");

const contract = () => StrKey.encodeContract(Keypair.random().rawPublicKey());
const KUMBARA = contract();
const USDC = contract();
const VAULT = contract();
const STRANGER = contract();
const ctx = { accountWasm: accountWasmHashes(), isAccount: (c: string) => c === KUMBARA, usdc: USDC, vault: VAULT };

const invoke = (target: string) =>
  xdr.HostFunction.hostFunctionTypeInvokeContract(new xdr.InvokeContractArgs({ contractAddress: Address.fromString(target).toScAddress(), functionName: "transfer", args: [] }));

const deploy = (wasmHex: string) =>
  xdr.HostFunction.hostFunctionTypeCreateContractV2(new xdr.CreateContractArgsV2({
    contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(new xdr.ContractIdPreimageFromAddress({ address: Address.fromString(Keypair.random().publicKey()).toScAddress(), salt: Buffer.alloc(32) })),
    executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.from(wasmHex, "hex")),
    constructorArgs: [],
  }));

describe("relay policy (KB-04)", () => {
  it("relays a Kumbara account deployment and nothing else", () => {
    expect(judgeHostFunction(deploy([...ctx.accountWasm][0]!), [], ctx).allowed).toBe(true);
    expect(judgeHostFunction(deploy("00".repeat(32)), [], ctx).allowed).toBe(false);
  });

  it("relays calls on the account itself", () => {
    expect(judgeHostFunction(invoke(KUMBARA), [], ctx).allowed).toBe(true);
  });

  it("relays USDC and vault calls only when a Kumbara account authorises them", () => {
    expect(judgeHostFunction(invoke(USDC), [KUMBARA], ctx).allowed).toBe(true);
    expect(judgeHostFunction(invoke(VAULT), [KUMBARA], ctx).allowed).toBe(true);
    expect(judgeHostFunction(invoke(USDC), [Keypair.random().publicKey()], ctx).allowed).toBe(false);
    expect(judgeHostFunction(invoke(VAULT), [], ctx).allowed).toBe(false);
  });

  it("refuses any other contract, even with a Kumbara account's authorisation", () => {
    expect(judgeHostFunction(invoke(STRANGER), [KUMBARA], ctx)).toMatchObject({ allowed: false });
  });
});
