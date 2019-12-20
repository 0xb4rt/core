import ByteBuffer from "bytebuffer";

import { TransactionType, TransactionTypeGroup } from "../../../enums";
import { ISerializeOptions } from "../../../interfaces";
import { configManager } from "../../../managers";
import { BigNumber } from "../../../utils/bignum";
import * as schemas from "../schemas";
import { Transaction } from "../transaction";

export abstract class HtlcClaimTransaction extends Transaction {
    public static typeGroup: number = TransactionTypeGroup.Core;
    public static type: number = TransactionType.HtlcClaim;
    public static key = "htlcClaim";
    public static version: number = 2;

    protected static defaultStaticFee: BigNumber = BigNumber.ZERO;

    public static getSchema(): schemas.TransactionSchema {
        return schemas.htlcClaim;
    }

    public verify(): boolean {
        return configManager.getMilestone().aip11 && super.verify();
    }

    public serialize(options?: ISerializeOptions): ByteBuffer | undefined {
        const { data } = this;

        const buffer: ByteBuffer = new ByteBuffer(32 + 32, true);

        if (data.asset && data.asset.claim) {
            buffer.append(Buffer.from(data.asset.claim.lockTransactionId, "hex"));
            buffer.writeString(data.asset.claim.unlockSecret);
        }

        return buffer;
    }

    public deserialize(buf: ByteBuffer): void {
        const { data } = this;

        const lockTransactionId: string = buf.readBytes(32).toString("hex");
        const unlockSecret: string = buf.readString(32);

        data.asset = {
            claim: {
                lockTransactionId,
                unlockSecret,
            },
        };
    }
}
