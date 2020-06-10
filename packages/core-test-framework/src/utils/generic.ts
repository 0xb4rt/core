import { CryptoSuite } from "@arkecosystem/core-crypto";
import { Container, Contracts, Utils as AppUtils } from "@arkecosystem/core-kernel";
import { Types } from "@arkecosystem/crypto";
import cloneDeep from "lodash.clonedeep";

const defaultblockTimestampLookup = (height: number): number => {
    if (height === 1) return 0;
    throw new Error(`Attemped to lookup block with height ${height}, but no lookup implementation was provided`);
};

export const snoozeForBlock = async (
    cryptoManager: CryptoSuite.CryptoManager,
    sleep: number = 0,
    height: number = 1,
    blockTimestampLookupByHeight = defaultblockTimestampLookup,
): Promise<void> => {
    const blockTime: number = cryptoManager.MilestoneManager.getMilestone(height).blocktime * 1000;
    const remainingTimeInSlot: number = cryptoManager.LibraryManager.Crypto.Slots.getTimeInMsUntilNextSlot(
        blockTimestampLookupByHeight,
    );
    const sleepTime: number = sleep * 1000;

    return AppUtils.sleep(blockTime + remainingTimeInSlot + sleepTime);
};

export const injectMilestone = (cryptoManager: CryptoSuite.CryptoManager, milestone: Record<string, any>): void => {
    const milestones = cryptoManager.MilestoneManager.getMilestones() as any[];
    const nextMilestoneIndex = milestones.findIndex((existingMilestone) => {
        return existingMilestone.height > milestone.height;
    });
    const newMilestone =
        nextMilestoneIndex === 0
            ? { ...cloneDeep(milestones[0]), ...milestone }
            : { ...cloneDeep(milestones[nextMilestoneIndex - 1]), ...milestone };
    milestones.splice(nextMilestoneIndex, 0, newMilestone);
};

export const getLastHeight = (app: Contracts.Kernel.Application): number =>
    app.get<Contracts.State.StateStore>(Container.Identifiers.StateStore).getLastHeight();

export const getSenderNonce = (app: Contracts.Kernel.Application, senderPublicKey: string): Types.BigNumber => {
    return app
        .getTagged<Contracts.State.WalletRepository>(Container.Identifiers.WalletRepository, "state", "blockchain")
        .getNonce(senderPublicKey);
};

export const resetBlockchain = async (app: Contracts.Kernel.Application) => {
    // Resets everything so that it can be used in beforeAll to start clean a test suite
    // Now resets: blocks (remove blocks other than genesis), transaction pool
    // TODO: reset rounds, transactions in db...

    // reset to block height 1
    const blockchain = app.get<Contracts.Blockchain.Blockchain>(Container.Identifiers.BlockchainService);
    const height: number = blockchain.getLastBlock().data.height;

    if (height) {
        await blockchain.removeBlocks(height - 1);
    }

    // app.get<Contracts.TransactionPool.Connection>(Container.Identifiers.TransactionPoolService).flush();
};

export const getWalletNonce = (
    app: Contracts.Kernel.Application,
    cryptoManager: CryptoSuite.CryptoManager,
    publicKey: string,
): Types.BigNumber => {
    try {
        return app
            .getTagged<Contracts.State.WalletRepository>(Container.Identifiers.WalletRepository, "state", "blockchain")
            .getNonce(publicKey);
    } catch {
        return cryptoManager.LibraryManager.Libraries.BigNumber.ZERO;
    }
};
