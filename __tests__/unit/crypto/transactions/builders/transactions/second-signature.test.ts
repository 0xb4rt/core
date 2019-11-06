import "jest-extended";

import { configManager } from "@packages/crypto/src/managers";
import { Utils } from "@arkecosystem/crypto";
import { TransactionType } from "@packages/crypto/src/enums";
import { Keys } from "@packages/crypto/src/identities";
import { BuilderFactory, SecondSignatureRegistrationTransaction } from "@packages/crypto/src/transactions";
import { SecondSignatureBuilder } from "@packages/crypto/src/transactions/builders/transactions/second-signature";

import { Generators } from "@packages/core-test-framework";

let builder: SecondSignatureBuilder;
let identity;

beforeEach(() => {
    // todo: completely wrap this into a function to hide the generation and setting of the config?
    const config = new Generators.GenerateNetwork().generateCrypto();
    configManager.setConfig(config);

    identity = Generators.generateIdentity("this is a top secret passphrase", config.network);

    builder = BuilderFactory.secondSignature();
});

describe("Second Signature Transaction", () => {
    describe("verify", () => {
        it("should be valid with a signature", () => {
            const actual = builder.signatureAsset("signature").sign("dummy passphrase");

            expect(actual.build().verified).toBeTrue();
            expect(actual.verify()).toBeTrue();
        });
    });

    it("should have its specific properties", () => {
        expect(builder).toHaveProperty("data.type", TransactionType.SecondSignature);
        expect(builder).toHaveProperty("data.fee", SecondSignatureRegistrationTransaction.staticFee());
        expect(builder).toHaveProperty("data.amount", Utils.BigNumber.make(0));
        expect(builder).toHaveProperty("data.recipientId", undefined);
        expect(builder).toHaveProperty("data.senderPublicKey", undefined);
        expect(builder).toHaveProperty("data.asset");
        expect(builder).toHaveProperty("data.asset.signature", {});
    });

    describe("signatureAsset", () => {
        it("establishes the signature on the asset", () => {
            jest.spyOn(Keys, "fromWIF").mockReturnValueOnce(identity.keys);

            builder.signatureAsset(identity.bip39);

            expect(builder.data.asset.signature.publicKey).toBe(identity.publicKey);
        });
    });
});
