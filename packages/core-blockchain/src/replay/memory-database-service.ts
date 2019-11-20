import { DatabaseService } from "@arkecosystem/core-database";
import { Contracts } from "@arkecosystem/core-kernel";
import { Interfaces } from "@arkecosystem/crypto";

// todo: review the implementation
// @ts-ignore
export class MemoryDatabaseService extends DatabaseService {
    public constructor(public walletRepository: Contracts.State.WalletRepository) {
        // @ts-ignore
        super(undefined, undefined, undefined, undefined, undefined, undefined);

        this.blocksInCurrentRound = [];
    }

    public async saveBlocks(blocks: Interfaces.IBlock[]): Promise<void> {
        return;
    }

    public async saveRound(activeDelegates: Contracts.State.Wallet[]): Promise<void> {
        // this.logger.info(`Saving round ${activeDelegates[0].getAttribute("delegate.round").toLocaleString()}`);
    }

    public async deleteRound(round: number): Promise<void> {
        return;
    }

    public async getForgedTransactionsIds(ids: string[]): Promise<any[]> {
        return [];
    }

    public async getBlock(id: string): Promise<Interfaces.IBlock> {
        // @ts-ignore
        return undefined;
    }
}
